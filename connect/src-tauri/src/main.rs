#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs::{self,File,OpenOptions}, net::TcpListener, path::PathBuf, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, SystemTime, UNIX_EPOCH}};
use fs2::FileExt;
use futures_util::{SinkExt, StreamExt};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::{process::CommandChild, ShellExt};
use tokio::{io::AsyncWriteExt, sync::mpsc, task::{AbortHandle, JoinHandle}};
use tokio_tungstenite::{connect_async, tungstenite::{client::IntoClientRequest, http::header::AUTHORIZATION, Message}};

const PORTAL:&str="https://opengames.duckdns.org";
const MODEL_NAME:&str="opengames-qwen3-8b";
const MODEL_SHA:&str="d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785";
const MODEL_URL:&str="https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/6a56986/Qwen3-8B-Q4_K_M.gguf";
const MODEL_BYTES:u64=5_030_000_000;

#[derive(Default,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
struct Config { device_id:Option<String>, device_name:Option<String>, consent:bool }

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
struct Status { linked:bool, device_name:Option<String>, computer_name:String, model_ready:bool, donating:bool, starting:bool, busy:bool, model_size_gb:f32, model_license:&'static str, model_source:&'static str }

struct State { config:Mutex<Config>, pairing:Mutex<Option<String>>, verification_url:Mutex<Option<String>>, computer_name:String, worker:Mutex<Option<JoinHandle<()>>>, job:Arc<Mutex<Option<(String,String,AbortHandle)>>>, child:Mutex<Option<CommandChild>>, process_lock:Mutex<Option<File>>, busy:Arc<AtomicBool>, starting:AtomicBool, cancel_start:AtomicBool, port:Mutex<Option<u16>>, local_key:Mutex<Option<String>>, data_dir:PathBuf }
struct StartGuard<'a>(&'a AtomicBool);
impl Drop for StartGuard<'_>{fn drop(&mut self){self.0.store(false,Ordering::SeqCst)}}

fn entry()->Result<keyring::Entry,String>{keyring::Entry::new("org.opengames.connect","device-token").map_err(|e|e.to_string())}
fn token()->Result<String,String>{entry()?.get_password().map_err(|e|e.to_string())}
fn config_path(state:&State)->PathBuf{state.data_dir.join("connect.json")}
fn model_path(state:&State)->PathBuf{state.data_dir.join("models").join("Qwen3-8B-Q4_K_M.gguf")}
fn save_config(state:&State)->Result<(),String>{let data=serde_json::to_vec(&*state.config.lock().unwrap()).map_err(|e|e.to_string())?;let tmp=config_path(state).with_extension("tmp");fs::write(&tmp,data).map_err(|e|e.to_string())?;fs::rename(tmp,config_path(state)).map_err(|e|e.to_string())}
fn digest(path:&PathBuf)->Result<String,String>{let mut file=fs::File::open(path).map_err(|e|e.to_string())?;let mut hash=Sha256::new();std::io::copy(&mut file,&mut hash).map_err(|e|e.to_string())?;Ok(hex::encode(hash.finalize()))}
fn verified_model(state:&State)->bool{let path=model_path(state);path.is_file()&&path.metadata().map(|m|m.len()>4_000_000_000).unwrap_or(false)&&digest(&path).map(|s|s==MODEL_SHA).unwrap_or(false)}
fn http()->Result<reqwest::Client,String>{reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e|e.to_string())}
fn random_key()->String{let mut bytes=[0u8;32];rand::rng().fill_bytes(&mut bytes);hex::encode(bytes)}
fn computer_name()->String{
    #[cfg(target_os="windows")]
    if let Ok(name)=std::env::var("COMPUTERNAME"){let name=name.trim().chars().take(48).collect::<String>();if name.chars().count()>=2{return name}}
    #[cfg(target_os="macos")]
    if let Ok(output)=std::process::Command::new("/usr/sbin/scutil").args(["--get","ComputerName"]).output(){if output.status.success(){let name=String::from_utf8_lossy(&output.stdout).trim().chars().filter(|c|!c.is_control()).take(48).collect::<String>();if name.chars().count()>=2{return name}}}
    if let Ok(output)=std::process::Command::new("hostname").output(){if output.status.success(){let name=String::from_utf8_lossy(&output.stdout).trim().chars().filter(|c|!c.is_control()).take(48).collect::<String>();if name.chars().count()>=2{return name}}}
    "Computer".into()
}

#[tauri::command]
fn status(state:tauri::State<State>)->Status{if state.worker.lock().unwrap().as_ref().is_some_and(|w|w.is_finished()){stop_inner(&state)}let config=state.config.lock().unwrap();Status{linked:config.device_id.is_some()&&token().is_ok(),device_name:config.device_name.clone(),computer_name:state.computer_name.clone(),model_ready:model_path(&state).is_file(),donating:state.worker.lock().unwrap().as_ref().is_some_and(|w|!w.is_finished()),starting:state.starting.load(Ordering::SeqCst),busy:state.busy.load(Ordering::Relaxed),model_size_gb:5.03,model_license:"Apache-2.0",model_source:"Qwen/Qwen3-8B-GGUF"}}

#[tauri::command]
async fn begin_pairing(state:tauri::State<'_,State>)->Result<Value,String>{
    let response=http()?.post(format!("{PORTAL}/api/donor/pairings")).json(&json!({"name":state.computer_name})).send().await.map_err(|e|e.to_string())?;
    if !response.status().is_success(){return Err("Сервер не начал привязку".into())}
    let value:Value=response.json().await.map_err(|e|e.to_string())?;
    let code=value["deviceCode"].as_str().ok_or("Сервер не выдал код")?;
    let user_code=value["userCode"].as_str().ok_or("Сервер не выдал код активации")?;
    let url=format!("{PORTAL}/#/profile/donors?code={user_code}");
    *state.pairing.lock().unwrap()=Some(code.to_string());
    *state.verification_url.lock().unwrap()=Some(url.clone());
    state.config.lock().unwrap().device_name=Some(state.computer_name.clone());save_config(&state)?;
    Ok(json!({"userCode":user_code,"expiresAt":value["expiresAt"],"verificationUrl":url}))
}

#[tauri::command]
fn open_verification(state:tauri::State<State>)->Result<(),String>{
    let url=state.verification_url.lock().unwrap().clone().ok_or("Сначала получите код привязки")?;
    #[cfg(target_os="macos")]
    let status=std::process::Command::new("/usr/bin/open").arg(&url).status().map_err(|e|e.to_string())?;
    #[cfg(target_os="linux")]
    let status=std::process::Command::new("xdg-open").arg(&url).status().map_err(|e|e.to_string())?;
    #[cfg(target_os="windows")]
    let status=std::process::Command::new("cmd").args(["/C","start","",&url]).status().map_err(|e|e.to_string())?;
    if status.success(){Ok(())}else{Err("Не удалось открыть браузер".into())}
}

#[tauri::command]
async fn poll_pairing(state:tauri::State<'_,State>)->Result<String,String>{
    let code=state.pairing.lock().unwrap().clone().ok_or("Сначала начните привязку")?;
    let response=http()?.post(format!("{PORTAL}/api/donor/token")).json(&json!({"deviceCode":code})).send().await.map_err(|e|e.to_string())?;
    if !response.status().is_success(){return Err("Срок привязки истёк".into())}
    let value:Value=response.json().await.map_err(|e|e.to_string())?;
    if value["status"]!="approved"{return Ok(value["status"].as_str().unwrap_or("pending").to_string())}
    let access=value["accessToken"].as_str().ok_or("Токен устройства отсутствует")?;
    let id=value["deviceId"].as_str().ok_or("ID устройства отсутствует")?;
    entry()?.set_password(access).map_err(|e|e.to_string())?;
    let mut config=state.config.lock().unwrap();config.device_id=Some(id.to_string());drop(config);
    save_config(&state)?;*state.pairing.lock().unwrap()=None;*state.verification_url.lock().unwrap()=None;Ok("approved".into())
}

#[tauri::command]
async fn download_model(app:tauri::AppHandle,state:tauri::State<'_,State>)->Result<(),String>{
    if state.worker.lock().unwrap().is_some(){return Err("Остановите донорство перед обновлением модели".into())}
    if verified_model(&state){return Ok(())}
    let path=model_path(&state);let dir=path.parent().ok_or("Каталог модели не найден")?;
    fs::create_dir_all(dir).map_err(|e|e.to_string())?;
    if fs2::available_space(dir).map_err(|e|e.to_string())?<MODEL_BYTES+1_000_000_000{return Err("Недостаточно свободного места для модели".into())}
    let part=path.with_extension("part");let response=reqwest::Client::new().get(MODEL_URL).send().await.map_err(|e|e.to_string())?;
    if !response.status().is_success(){return Err("Не удалось скачать модель".into())}
    let mut output=tokio::fs::File::create(&part).await.map_err(|e|e.to_string())?;let mut stream=response.bytes_stream();let mut hash=Sha256::new();let mut size=0u64;
    while let Some(chunk)=stream.next().await{let chunk=chunk.map_err(|e|e.to_string())?;size+=chunk.len() as u64;if size>6_000_000_000{return Err("Размер модели превышен".into())}hash.update(&chunk);output.write_all(&chunk).await.map_err(|e|e.to_string())?;if size%50_000_000<chunk.len() as u64{let _=app.emit("model-progress",size);}}
    output.flush().await.map_err(|e|e.to_string())?;drop(output);
    if hex::encode(hash.finalize())!=MODEL_SHA{let _=fs::remove_file(&part);return Err("SHA-256 модели не совпадает".into())}
    fs::rename(part,path).map_err(|e|e.to_string())?;Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Job {version:u8,#[serde(rename="type")] kind:String,job_id:String,request_id:String,attempt:u32,lease_until:u64,model:String,request:Value}
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Cancel {version:u8,#[serde(rename="type")] kind:String,job_id:String,request_id:String}
fn now_ms()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64}

async fn inference(port:u16,local_key:String,job:&Job)->Result<Value,String>{
    let remaining=job.lease_until.saturating_sub(now_ms());if remaining<1000{return Err("timeout".into())}
    let client=reqwest::Client::builder().timeout(Duration::from_millis(remaining.min(300_000))).build().map_err(|_|"model")?;
    let response=client.post(format!("http://127.0.0.1:{port}/v1/chat/completions")).bearer_auth(local_key).json(&job.request).send().await.map_err(|_|"timeout")?;
    if !response.status().is_success(){return Err("model".into())}
    let bytes=response.bytes().await.map_err(|_|"model")?;if bytes.len()>65_536{return Err("model".into())}
    let data:Value=serde_json::from_slice(&bytes).map_err(|_|"model")?;
    let content=data["choices"][0]["message"]["content"].as_str().ok_or("model")?;
    serde_json::from_str(content).map_err(|_|"model".into())
}

async fn run_worker(device_token:String,port:u16,local_key:String,busy:Arc<AtomicBool>,active_job:Arc<Mutex<Option<(String,String,AbortHandle)>>>) ->Result<(),String>{
    let mut request=format!("{}/api/donor/connect",PORTAL.replace("https://","wss://")).into_client_request().map_err(|e|e.to_string())?;
    request.headers_mut().insert(AUTHORIZATION,format!("Bearer {device_token}").parse().map_err(|_|"Неверный токен")?);
    let (socket,_)=connect_async(request).await.map_err(|e|match e{tokio_tungstenite::tungstenite::Error::Http(response) if response.status()==401=>"revoked".to_string(),other=>other.to_string()})?;
    let (mut writer,mut reader)=socket.split();let (tx,mut rx)=mpsc::channel::<Message>(16);
    let send=tokio::spawn(async move{while let Some(message)=rx.recv().await{if writer.send(message).await.is_err(){break}}});
    let heart_tx=tx.clone();let heart_busy=busy.clone();let heartbeat=tokio::spawn(async move{let mut interval=tokio::time::interval(Duration::from_secs(15));loop{interval.tick().await;let message=json!({"version":1,"type":"heartbeat","model":MODEL_NAME,"quantization":"Q4_K_M","slots":1,"busy":if heart_busy.load(Ordering::Relaxed){1}else{0},"available":true});if heart_tx.send(Message::Text(message.to_string().into())).await.is_err(){break}}});
    let mut job_task:Option<JoinHandle<()>>=None;
    while let Some(Ok(message))=reader.next().await{
        if let Message::Text(text)=message{
            if text.len()>262_144{break}
            let Ok(value)=serde_json::from_str::<Value>(&text) else{continue};
            if value["type"]=="cancel"{
                if let Ok(cancel)=serde_json::from_value::<Cancel>(value){
                    if cancel.version==1&&cancel.kind=="cancel"{
                        let active=active_job.lock().unwrap();
                        if active.as_ref().is_some_and(|(job_id,request_id,_)|job_id==&cancel.job_id&&request_id==&cancel.request_id){
                            if let Some((_,_,task))=active.as_ref(){task.abort();busy.store(false,Ordering::SeqCst)}
                        }
                    }
                }
                continue
            }
            let Ok(job)=serde_json::from_value::<Job>(value) else{continue};
            if job.version!=1||job.kind!="job"||job.model!=MODEL_NAME||job.lease_until<=now_ms()||job.request_id.len()>80||job.job_id.len()!=36{continue}
            if busy.swap(true,Ordering::SeqCst){let _=tx.send(Message::Text(json!({"version":1,"type":"failed","jobId":job.job_id,"requestId":job.request_id,"attempt":job.attempt,"reason":"resource"}).to_string().into())).await;continue}
            let accepted=json!({"version":1,"type":"accepted","jobId":job.job_id,"requestId":job.request_id,"attempt":job.attempt});
            if tx.send(Message::Text(accepted.to_string().into())).await.is_err(){busy.store(false,Ordering::SeqCst);break}
            let job_tx=tx.clone();let job_busy=busy.clone();let key=local_key.clone();let job_slot=active_job.clone();let job_id_for_task=job.job_id.clone();let request_id_for_task=job.request_id.clone();
            let job_id=job.job_id.clone();let request_id=job.request_id.clone();
            let task=tokio::spawn(async move{let result=inference(port,key,&job).await;let event=match result{Ok(value)=>json!({"version":1,"type":"completed","jobId":job.job_id,"requestId":job.request_id,"attempt":job.attempt,"result":value}),Err(reason)=>json!({"version":1,"type":"failed","jobId":job.job_id,"requestId":job.request_id,"attempt":job.attempt,"reason":reason})};let _=job_tx.send(Message::Text(event.to_string().into())).await;let mut active=job_slot.lock().unwrap();if active.as_ref().is_some_and(|(id,request,_)|id==&job_id_for_task&&request==&request_id_for_task){*active=None;job_busy.store(false,Ordering::SeqCst)}});
            *active_job.lock().unwrap()=Some((job_id,request_id,task.abort_handle()));job_task=Some(task);
        }
    }
    if let Some(task)=job_task{task.abort()}*active_job.lock().unwrap()=None;heartbeat.abort();send.abort();busy.store(false,Ordering::SeqCst);Ok(())
}

#[tauri::command]
async fn start_donating(app:tauri::AppHandle,state:tauri::State<'_,State>,consent:bool)->Result<(),String>{
    if !consent{return Err("Требуется согласие владельца".into())}
    if state.starting.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err(){return Err("Модель уже запускается".into())}
    let _guard=StartGuard(&state.starting);
    if state.worker.lock().unwrap().as_ref().is_some_and(|w|w.is_finished()){stop_inner(&state)}
    if state.worker.lock().unwrap().is_some(){return Ok(())}
    state.cancel_start.store(false,Ordering::SeqCst);
    let device_token=token()?;if state.config.lock().unwrap().device_id.is_none(){return Err("Сначала привяжите устройство".into())}
    if state.config.lock().unwrap().device_name.as_deref()!=Some(state.computer_name.as_str()){
        let response=http()?.post(format!("{PORTAL}/api/donor/rename-self")).bearer_auth(&device_token).json(&json!({"name":state.computer_name})).send().await.map_err(|e|e.to_string())?;
        if !response.status().is_success(){return Err(format!("Не удалось обновить имя устройства: HTTP {}",response.status()))}
        state.config.lock().unwrap().device_name=Some(state.computer_name.clone());save_config(&state)?;
    }
    if !verified_model(&state){return Err("Модель отсутствует или не прошла проверку SHA-256".into())}
    let listener=TcpListener::bind("127.0.0.1:0").map_err(|e|e.to_string())?;let port=listener.local_addr().map_err(|e|e.to_string())?.port();drop(listener);
    let lock=OpenOptions::new().create(true).write(true).open(state.data_dir.join("donor.lock")).map_err(|e|e.to_string())?;
    if lock.try_lock_exclusive().is_err(){return Err("Донорство уже запущено в другом процессе".into())}
    *state.process_lock.lock().unwrap()=Some(lock);
    let local_key=random_key();let key_file=state.data_dir.join("local-api-key");if let Err(error)=fs::write(&key_file,&local_key){stop_inner(&state);return Err(error.to_string())}
    #[cfg(unix)]{use std::os::unix::fs::PermissionsExt;if let Err(error)=fs::set_permissions(&key_file,fs::Permissions::from_mode(0o600)){stop_inner(&state);return Err(error.to_string())}}
    let model=model_path(&state);let port_text=port.to_string();let args=["--model",model.to_str().ok_or("Путь модели недопустим")?,"--alias",MODEL_NAME,"--host","127.0.0.1","--port",&port_text,"--api-key-file",key_file.to_str().ok_or("Путь ключа недопустим")?,"--ctx-size","8192","--parallel","1","--n-gpu-layers",if cfg!(target_os="macos"){"99"}else{"0"}];
    let launch=app.shell().sidecar("llama-server").map_err(|e|e.to_string()).and_then(|command|command.args(args).spawn().map_err(|e|e.to_string()));
    let (mut events,child)=match launch{Ok(value)=>value,Err(error)=>{stop_inner(&state);return Err(error)}};
    tauri::async_runtime::spawn(async move{while events.recv().await.is_some(){}});
    *state.child.lock().unwrap()=Some(child);*state.port.lock().unwrap()=Some(port);*state.local_key.lock().unwrap()=Some(local_key.clone());
    let client=match http(){Ok(value)=>value,Err(error)=>{stop_inner(&state);return Err(error)}};let mut ready=false;for _ in 0..120{if state.cancel_start.load(Ordering::SeqCst){return Err("Запуск прерван".into())}if client.get(format!("http://127.0.0.1:{port}/health")).send().await.map(|r|r.status().is_success()).unwrap_or(false){ready=true;break}tokio::time::sleep(Duration::from_secs(1)).await}
    if !ready{stop_inner(&state);return Err("Локальная модель не запустилась".into())}
    state.config.lock().unwrap().consent=true;if let Err(error)=save_config(&state){stop_inner(&state);return Err(error)}
    let busy=state.busy.clone();let jobs=state.job.clone();let handle=tokio::spawn(async move{loop{if let Err(error)=run_worker(device_token.clone(),port,local_key.clone(),busy.clone(),jobs.clone()).await{if error=="revoked"{break}}tokio::time::sleep(Duration::from_secs(5)).await}});*state.worker.lock().unwrap()=Some(handle);Ok(())
}

fn stop_inner(state:&State){state.cancel_start.store(true,Ordering::SeqCst);if let Some((_,_,job))=state.job.lock().unwrap().take(){job.abort()}if let Some(handle)=state.worker.lock().unwrap().take(){handle.abort()}if let Some(child)=state.child.lock().unwrap().take(){let _=child.kill();}*state.port.lock().unwrap()=None;*state.local_key.lock().unwrap()=None;state.busy.store(false,Ordering::SeqCst);if let Some(lock)=state.process_lock.lock().unwrap().take(){let _=fs::remove_file(state.data_dir.join("local-api-key"));drop(lock)}}
#[tauri::command]
fn pause(state:tauri::State<State>){stop_inner(&state)}
#[tauri::command]
async fn unlink(state:tauri::State<'_,State>)->Result<(),String>{stop_inner(&state);if let Ok(access)=token(){let _=http()?.post(format!("{PORTAL}/api/donor/revoke-self")).bearer_auth(access).send().await;}let _=entry()?.delete_credential();let mut config=state.config.lock().unwrap();config.device_id=None;config.device_name=None;config.consent=false;drop(config);save_config(&state)}
#[tauri::command]
fn delete_model(state:tauri::State<State>)->Result<(),String>{if state.worker.lock().unwrap().is_some(){return Err("Сначала остановите донорство".into())}let path=model_path(&state);if path.exists(){fs::remove_file(path).map_err(|e|e.to_string())?}Ok(())}

fn main(){
    tauri::Builder::default().plugin(tauri_plugin_shell::init()).setup(|app|{
        let dir=app.path().app_data_dir()?;fs::create_dir_all(&dir)?;
        let config=fs::read(dir.join("connect.json")).ok().and_then(|x|serde_json::from_slice(&x).ok()).unwrap_or_default();
        if let Ok(lock)=OpenOptions::new().create(true).write(true).open(dir.join("donor.lock")){if lock.try_lock_exclusive().is_ok(){let _=fs::remove_file(dir.join("local-api-key"));let _=FileExt::unlock(&lock);}}
        app.manage(State{config:Mutex::new(config),pairing:Mutex::new(None),verification_url:Mutex::new(None),computer_name:computer_name(),worker:Mutex::new(None),job:Arc::new(Mutex::new(None)),child:Mutex::new(None),process_lock:Mutex::new(None),busy:Arc::new(AtomicBool::new(false)),starting:AtomicBool::new(false),cancel_start:AtomicBool::new(false),port:Mutex::new(None),local_key:Mutex::new(None),data_dir:dir});Ok(())
    }).on_window_event(|window,event|{if let tauri::WindowEvent::Destroyed=event{let state=window.state::<State>();stop_inner(&state)}})
      .invoke_handler(tauri::generate_handler![status,begin_pairing,open_verification,poll_pairing,download_model,start_donating,pause,unlink,delete_model])
      .run(tauri::generate_context!()).expect("OpenGames Connect failed");
}
