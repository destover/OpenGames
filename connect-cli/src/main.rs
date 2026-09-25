use std::{fs::{self,File,OpenOptions},net::TcpListener,path::{Path,PathBuf},process::{Child,Command,Stdio},sync::{Arc,atomic::{AtomicBool,Ordering}},time::{Duration,SystemTime,UNIX_EPOCH}};
use fs2::FileExt;
use futures_util::{SinkExt,StreamExt};
use rand::RngCore;
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use tokio::{io::AsyncWriteExt,sync::mpsc};
use tokio_tungstenite::{connect_async,tungstenite::{client::IntoClientRequest,http::header::AUTHORIZATION,Message}};

const PORTAL:&str=match option_env!("OPENGAMES_PORTAL"){Some(url)=>url,None=>"https://opengames.duckdns.org"};
fn portal_ws()->String{if let Some(host)=PORTAL.strip_prefix("https://"){format!("wss://{host}")}else if let Some(host)=PORTAL.strip_prefix("http://"){format!("ws://{host}")}else{format!("wss://{PORTAL}")}}
const MODEL:&str="opengames-qwen3-8b";
const MODEL_URL:&str="https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/6a56986/Qwen3-8B-Q4_K_M.gguf";
const MODEL_SHA:&str="d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785";
const MODEL_BYTES:u64=5_030_000_000;

#[derive(Default,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
struct Config{device_id:Option<String>,device_name:Option<String>,consent:bool}

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Job{version:u8,#[serde(rename="type")] kind:String,job_id:String,request_id:String,attempt:u32,lease_until:u64,model:String,request:Value}

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Cancel{version:u8,#[serde(rename="type")] kind:String,job_id:String,request_id:String}

fn data_dir()->Result<PathBuf,String>{let path=dirs::data_dir().ok_or("Каталог данных не найден")?.join("org.opengames.connect");fs::create_dir_all(&path).map_err(|e|e.to_string())?;Ok(path)}
fn model_path(dir:&Path)->PathBuf{dir.join("models/Qwen3-8B-Q4_K_M.gguf")}
fn config(dir:&Path)->Config{fs::read(dir.join("connect.json")).ok().and_then(|data|serde_json::from_slice(&data).ok()).unwrap_or_default()}
fn save_config(dir:&Path,value:&Config)->Result<(),String>{let path=dir.join("connect.tmp");fs::write(&path,serde_json::to_vec(value).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;fs::rename(path,dir.join("connect.json")).map_err(|e|e.to_string())}
fn entry()->Result<keyring::Entry,String>{keyring::Entry::new("org.opengames.connect","device-token").map_err(|e|e.to_string())}
fn token()->Result<String,String>{entry()?.get_password().map_err(|e|e.to_string())}
fn http()->Result<reqwest::Client,String>{reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e|e.to_string())}
fn now_ms()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64}
fn random_key()->String{let mut bytes=[0u8;32];rand::rng().fill_bytes(&mut bytes);hex::encode(bytes)}
fn computer_name()->String{
    #[cfg(target_os="windows")]
    if let Ok(name)=std::env::var("COMPUTERNAME"){let name=name.trim().chars().take(48).collect::<String>();if name.len()>=2{return name}}
    #[cfg(target_os="macos")]
    if let Ok(output)=Command::new("/usr/sbin/scutil").args(["--get","ComputerName"]).output(){if output.status.success(){let name=String::from_utf8_lossy(&output.stdout).trim().chars().take(48).collect::<String>();if name.chars().count()>=2{return name}}}
    if let Ok(output)=Command::new("hostname").output(){if output.status.success(){let name=String::from_utf8_lossy(&output.stdout).trim().chars().take(48).collect::<String>();if name.chars().count()>=2{return name}}}
    "Computer".into()
}
fn digest(path:&Path)->Result<String,String>{let mut file=File::open(path).map_err(|e|e.to_string())?;let mut hash=Sha256::new();std::io::copy(&mut file,&mut hash).map_err(|e|e.to_string())?;Ok(hex::encode(hash.finalize()))}

async fn pair(dir:&Path)->Result<(),String>{
    let name=computer_name();let client=http()?;
    let response=client.post(format!("{PORTAL}/api/donor/pairings")).json(&json!({"name":name})).send().await.map_err(|e|e.to_string())?;
    if !response.status().is_success(){return Err(format!("Сервер не начал привязку: HTTP {}",response.status()))}
    let value:Value=response.json().await.map_err(|e|e.to_string())?;
    let device_code=value["deviceCode"].as_str().ok_or("Сервер не выдал код устройства")?;
    let user_code=value["userCode"].as_str().ok_or("Сервер не выдал код активации")?;
    println!("Устройство: {name}\nКод: {user_code}\nПодтвердите: {PORTAL}/#/profile/donors?code={user_code}");
    let expires=value["expiresAt"].as_u64().unwrap_or(now_ms()+600_000);
    while now_ms()<expires{
        tokio::time::sleep(Duration::from_secs(5)).await;
        let response=client.post(format!("{PORTAL}/api/donor/token")).json(&json!({"deviceCode":device_code})).send().await.map_err(|e|e.to_string())?;
        if !response.status().is_success(){return Err(format!("Привязка завершилась: HTTP {}",response.status()))}
        let value:Value=response.json().await.map_err(|e|e.to_string())?;
        if value["status"]=="approved"{
            entry()?.set_password(value["accessToken"].as_str().ok_or("Токен отсутствует")?).map_err(|e|e.to_string())?;
            let mut settings=config(dir);settings.device_id=Some(value["deviceId"].as_str().ok_or("ID устройства отсутствует")?.into());settings.device_name=Some(name);save_config(dir,&settings)?;
            println!("Устройство привязано");return Ok(())
        }
    }
    Err("Срок привязки истёк".into())
}

async fn download(dir:&Path)->Result<(),String>{
    let path=model_path(dir);if path.is_file()&&digest(&path)?==MODEL_SHA{println!("Модель уже загружена");return Ok(())}
    let parent=path.parent().ok_or("Каталог модели не найден")?;fs::create_dir_all(parent).map_err(|e|e.to_string())?;
    if fs2::available_space(parent).map_err(|e|e.to_string())?<MODEL_BYTES+1_000_000_000{return Err("Недостаточно свободного места для модели".into())}
    let response=reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).build().map_err(|e|e.to_string())?.get(MODEL_URL).send().await.map_err(|e|e.to_string())?;
    if !response.status().is_success(){return Err(format!("Загрузка модели: HTTP {}",response.status()))}
    let part=path.with_extension("part");let mut file=tokio::fs::File::create(&part).await.map_err(|e|e.to_string())?;let mut stream=response.bytes_stream();let mut hash=Sha256::new();let mut size=0u64;let mut last=0;
    while let Some(chunk)=stream.next().await{let chunk=chunk.map_err(|e|e.to_string())?;size+=chunk.len() as u64;if size>6_000_000_000{return Err("Размер модели превышен".into())}hash.update(&chunk);file.write_all(&chunk).await.map_err(|e|e.to_string())?;if size-last>=250_000_000{eprintln!("Загружено {:.2} ГБ",size as f64/1e9);last=size}}
    file.flush().await.map_err(|e|e.to_string())?;drop(file);
    if hex::encode(hash.finalize())!=MODEL_SHA{let _=fs::remove_file(part);return Err("SHA-256 модели не совпадает".into())}
    fs::rename(part,path).map_err(|e|e.to_string())?;println!("Модель загружена");Ok(())
}

fn server_binary(value:Option<&str>)->PathBuf{
    let env=std::env::var("OPENGAMES_LLAMA_SERVER").ok();if let Some(path)=value.or(env.as_deref()){return PathBuf::from(path)}
    if let Ok(exe)=std::env::current_exe(){let sibling=exe.with_file_name(if cfg!(windows){"llama-server.exe"}else{"llama-server"});if sibling.is_file(){return sibling}}
    PathBuf::from(if cfg!(windows){"llama-server.exe"}else{"llama-server"})
}
fn launch(dir:&Path,binary:&Path)->Result<(Child,u16,String,PathBuf),String>{
    let listener=TcpListener::bind("127.0.0.1:0").map_err(|e|e.to_string())?;let port=listener.local_addr().map_err(|e|e.to_string())?.port();drop(listener);
    let key=random_key();let key_file=dir.join("local-api-key");fs::write(&key_file,&key).map_err(|e|e.to_string())?;
    #[cfg(unix)]{use std::os::unix::fs::PermissionsExt;fs::set_permissions(&key_file,fs::Permissions::from_mode(0o600)).map_err(|e|e.to_string())?}
    let mut command=Command::new(binary);command.args(["--model",model_path(dir).to_str().ok_or("Путь модели недопустим")?,"--alias",MODEL,"--host","127.0.0.1","--port",&port.to_string(),"--api-key-file",key_file.to_str().ok_or("Путь ключа недопустим")?,"--ctx-size","8192","--parallel","1","--n-gpu-layers",if cfg!(target_os="macos"){"99"}else{"0"}]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let child=command.spawn().map_err(|e|{let _=fs::remove_file(&key_file);format!("Не запущен llama-server ({}): {e}",binary.display())})?;
    Ok((child,port,key,key_file))
}
async fn ready(child:&mut Child,port:u16)->Result<(),String>{
    let client=http()?;
    for _ in 0..120{if child.try_wait().map_err(|e|e.to_string())?.is_some(){return Err("llama-server завершился при запуске".into())}if client.get(format!("http://127.0.0.1:{port}/health")).send().await.map(|r|r.status().is_success()).unwrap_or(false){return Ok(())}tokio::time::sleep(Duration::from_secs(1)).await}
    Err("Локальная модель не запустилась".into())
}

async fn inference(port:u16,key:String,job:&Job)->Result<Value,&'static str>{
    let remaining=job.lease_until.saturating_sub(now_ms());if remaining<1000{return Err("timeout")}
    let client=reqwest::Client::builder().timeout(Duration::from_millis(remaining.min(300_000))).build().map_err(|_|"model")?;
    let response=client.post(format!("http://127.0.0.1:{port}/v1/chat/completions")).bearer_auth(key).json(&job.request).send().await.map_err(|_|"timeout")?;
    if !response.status().is_success(){return Err("model")}
    let bytes=response.bytes().await.map_err(|_|"model")?;if bytes.len()>65_536{return Err("model")}
    let value:Value=serde_json::from_slice(&bytes).map_err(|_|"model")?;
    serde_json::from_str(value["choices"][0]["message"]["content"].as_str().ok_or("model")?).map_err(|_|"model")
}
async fn connection(access:&str,port:u16,key:&str,busy:Arc<AtomicBool>)->Result<(),String>{
    let mut request=format!("{}/api/donor/connect",portal_ws()).into_client_request().map_err(|e|e.to_string())?;
    request.headers_mut().insert(AUTHORIZATION,format!("Bearer {access}").parse().map_err(|_|"Неверный токен")?);
    let (socket,_)=connect_async(request).await.map_err(|e|match e{tokio_tungstenite::tungstenite::Error::Http(response) if response.status()==401=>"Доступ устройства отозван".to_string(),other=>other.to_string()})?;
    println!("В сети");let (mut writer,mut reader)=socket.split();let (tx,mut rx)=mpsc::channel::<Message>(16);
    let send=tokio::spawn(async move{while let Some(message)=rx.recv().await{if writer.send(message).await.is_err(){break}}});
    let heart_tx=tx.clone();let heart_busy=busy.clone();let heartbeat=tokio::spawn(async move{let mut interval=tokio::time::interval(Duration::from_secs(15));loop{interval.tick().await;let event=json!({"version":1,"type":"heartbeat","model":MODEL,"quantization":"Q4_K_M","slots":1,"busy":if heart_busy.load(Ordering::SeqCst){1}else{0},"available":true});if heart_tx.send(Message::Text(event.to_string().into())).await.is_err(){break}}});
    let mut job_task:Option<(String,String,tokio::task::JoinHandle<()>)>=None;
    while let Some(Ok(message))=reader.next().await{
        if let Message::Text(text)=message{
            if text.len()>262_144{break}
            let Ok(value)=serde_json::from_str::<Value>(&text) else{continue};
            if value["type"]=="cancel"{
                if let Ok(cancel)=serde_json::from_value::<Cancel>(value){
                    if cancel.version==1&&cancel.kind=="cancel"{
                        if let Some((job_id,request_id,_))=job_task.as_ref(){
                            if job_id==&cancel.job_id&&request_id==&cancel.request_id{
                                if let Some((_,_,task))=job_task.take(){task.abort();busy.store(false,Ordering::SeqCst)}
                            }
                        }
                    }
                }
                continue
            }
            let Ok(job)=serde_json::from_value::<Job>(value) else{continue};
            if job.version!=1||job.kind!="job"||job.model!=MODEL||job.lease_until<=now_ms()||job.job_id.len()!=36||job.request_id.len()>80{continue}
            if busy.swap(true,Ordering::SeqCst){let _=tx.send(Message::Text(json!({"version":1,"type":"failed","jobId":job.job_id,"requestId":job.request_id,"attempt":job.attempt,"reason":"resource"}).to_string().into())).await;continue}
            let accepted=json!({"version":1,"type":"accepted","jobId":job.job_id,"requestId":job.request_id,"attempt":job.attempt});
            if tx.send(Message::Text(accepted.to_string().into())).await.is_err(){busy.store(false,Ordering::SeqCst);break}
            let reply=tx.clone();let local_key=key.to_owned();let flag=busy.clone();
            let job_id=job.job_id.clone();let request_id=job.request_id.clone();
            let task=tokio::spawn(async move{let event=match inference(port,local_key,&job).await{Ok(result)=>json!({"version":1,"type":"completed","jobId":job.job_id,"requestId":job.request_id,"attempt":job.attempt,"result":result}),Err(reason)=>json!({"version":1,"type":"failed","jobId":job.job_id,"requestId":job.request_id,"attempt":job.attempt,"reason":reason})};let _=reply.send(Message::Text(event.to_string().into())).await;flag.store(false,Ordering::SeqCst)});
            job_task=Some((job_id,request_id,task));
        }
    }
    if let Some((_,_,task))=job_task{task.abort()}heartbeat.abort();send.abort();busy.store(false,Ordering::SeqCst);eprintln!("Соединение прервано");Ok(())
}
async fn run(dir:&Path,binary:Option<&str>)->Result<(),String>{
    let mut settings=config(dir);if settings.device_id.is_none(){return Err("Сначала привяжите устройство".into())}
    let access=token()?;if !model_path(dir).is_file()||digest(&model_path(dir))?!=MODEL_SHA{return Err("Модель отсутствует или не прошла SHA-256".into())}
    let name=computer_name();if settings.device_name.as_deref()!=Some(name.as_str()){let response=http()?.post(format!("{PORTAL}/api/donor/rename-self")).bearer_auth(&access).json(&json!({"name":name})).send().await.map_err(|e|e.to_string())?;if !response.status().is_success(){return Err(format!("Не удалось обновить имя устройства: HTTP {}",response.status()))}settings.device_name=Some(name);save_config(dir,&settings)?}
    let lock=OpenOptions::new().create(true).write(true).open(dir.join("donor.lock")).map_err(|e|e.to_string())?;
    lock.try_lock_exclusive().map_err(|_|"Соавторство уже запущено в другом процессе")?;
    let (mut child,port,key,key_file)=launch(dir,&server_binary(binary))?;
    let result=async{
        tokio::select!{result=ready(&mut child,port)=>result?,_=tokio::signal::ctrl_c()=>return Ok(())};println!("Локальная модель готова");let busy=Arc::new(AtomicBool::new(false));
        loop{tokio::select!{
            _=tokio::signal::ctrl_c()=>return Ok(()),
            result=connection(&access,port,&key,busy.clone())=>{if let Err(error)=result{if error=="Доступ устройства отозван"{return Err(error)}eprintln!("Ошибка подключения: {error}")}tokio::time::sleep(Duration::from_secs(5)).await}
        }}
    }.await;
    let _=child.kill();let _=child.wait();let _=fs::remove_file(key_file);let _=FileExt::unlock(&lock);result
}
async fn unlink(dir:&Path)->Result<(),String>{
    if let Ok(access)=token(){let response=http()?.post(format!("{PORTAL}/api/donor/revoke-self")).bearer_auth(access).send().await.map_err(|e|e.to_string())?;if !response.status().is_success(){return Err(format!("Отзыв не выполнен: HTTP {}",response.status()))}}
    let _=entry()?.delete_credential();let mut settings=config(dir);settings.device_id=None;settings.device_name=None;settings.consent=false;save_config(dir,&settings)?;println!("Доступ отозван");Ok(())
}
#[tokio::main]
async fn main(){
    let result=async{
        let dir=data_dir()?;let args=std::env::args().skip(1).collect::<Vec<_>>();
        match args.first().map(String::as_str){
            Some("pair")=>pair(&dir).await,
            Some("download")=>download(&dir).await,
            Some("run") if args.get(1).map(String::as_str)==Some("--consent")=>run(&dir,args.get(2).map(String::as_str)).await,
            Some("status")=>{let settings=config(&dir);println!("Устройство: {}\nПривязано: {}\nМодель: {}",settings.device_name.unwrap_or_else(computer_name),settings.device_id.is_some()&&token().is_ok(),model_path(&dir).is_file()&&digest(&model_path(&dir)).map(|hash|hash==MODEL_SHA).unwrap_or(false));Ok(())},
            Some("unlink")=>unlink(&dir).await,
            _=>Err("Команды: pair | download | run --consent [путь-к-llama-server] | status | unlink".into()),
        }
    }.await;
    if let Err(error)=result{eprintln!("{error}");std::process::exit(1)}
}
