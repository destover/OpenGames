import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { hostname, loadavg, platform, release, totalmem, freemem, cpus, uptime } from 'node:os';
import { statfs } from 'node:fs/promises';

export type MetricStatus='ok'|'warn'|'crit'|'unknown';
export type Check={key:string;label:string;value:string;status:MetricStatus;detail:string;fix?:string};
export type ServiceState={unit:string;state:string;status:MetricStatus};
export type InfraReport={
  host:{hostname:string;platform:string;release:string;node:string;cores:number;uptimeSeconds:number;load:[number,number,number];memory:{totalMb:number;availableMb:number;usedPercent:number;swapTotalMb:number};process:{pid:number;rssMb:number;uptimeSeconds:number}};
  disk:{path:string;totalMb:number;usedMb:number;freeMb:number;usedPercent:number};
  services:ServiceState[];
  endpoints:{name:string;host:string;port:number;status:MetricStatus}[];
  app:{games:number;donorConnected:boolean;donorStatus:MetricStatus;legalTerms:boolean;legalPrivacy:boolean};
  storage:{releases:number;releasesMb:number;current:string;dataMb:number;dataFiles:number};
  checks:Check[];
  blocked:{operation:string;reason:string}[];
  limitations:string[];
  collectedAt:string;
};

const percent=(used:number,total:number)=>total>0?Math.round((used/total)*1000)/10:0;
const mb=(bytes:number)=>Math.round(bytes/(1024*1024));
const status=(value:number,warn:number,crit:number):MetricStatus=>value>=crit?'crit':value>=warn?'warn':'ok';

type InfraContextInput={releasesDir:string;dataDir:string;port?:number;publicUrl?:string;units?:string[];games?:number;donor:()=>Promise<{connected:boolean;devices?:number}>;legal?:()=>{terms:boolean;privacy:boolean};journalLines?:number};
export type InfraContext=Required<Omit<InfraContextInput,'publicUrl'|'donor'|'legal'>>&Pick<InfraContextInput,'publicUrl'|'donor'|'legal'>;

function meminfo(){const out:Record<string,number>={};let text='';try{text=readFileSync('/proc/meminfo','utf8')}catch{return out}
  for(const line of text.split('\n')){const match=/^(\w+):\s+(\d+) kB/.exec(line);if(match)out[match[1]]=Number(match[2])}return out}

function procRssMb(){try{const statusLine=readFileSync('/proc/self/status','utf8');const match=/VmRSS:\s+(\d+) kB/.exec(statusLine);return match?Math.round(Number(match[1])/1024):0}catch{return 0}}

function dirStats(path:string){let files=0,bytes=0;const walk=(dir:string,depth:number)=>{if(depth>3)return;let entries:string[];try{entries=readdirSync(dir)}catch{return}
  for(const name of entries){if(name==='downloads'||name==='assets')continue;const full=dir+'/'+name;let info;try{info=statSync(full)}catch{continue}
    if(info.isDirectory())walk(full,depth+1);else{files++;bytes+=info.size}}};walk(path,0);return {files,bytes}}

function tcpProbe(host:string,port:number,timeout=1500){return new Promise<boolean>(resolve=>{const socket=connect({host,port});const done=(ok:boolean)=>{socket.destroy();resolve(ok)};
  socket.setTimeout(timeout);socket.once('connect',()=>done(true));socket.once('timeout',()=>done(false));socket.once('error',()=>done(false))})}

function unitState(unit:string){return new Promise<string>(resolve=>{execFile('systemctl',['is-active',unit],{timeout:4000},(error,stdout)=>{const text=String(stdout||'').trim();resolve(error&&!text?'unknown':text||'unknown')})})}

export class InfrastructureMonitor {
  private last:{at:number;report:InfraReport}|null=null;
  private context:InfraContext;
  constructor(context:InfraContextInput){this.context={port:3000,units:['opengames','nginx'],games:0,journalLines:200,
    ...context,donor:context.donor||(async()=>({connected:false}))}}
  async report(options:{fresh?:boolean}={}){if(!options.fresh&&this.last&&Date.now()-this.last.at<15_000)return this.last.report;
    const limitations:string[]=[],checks:Check[]=[];
    const memory=meminfo(),hasMeminfo=memory.MemTotal>0,totalMb=hasMeminfo?mb(memory.MemTotal*1024):mb(totalmem());
    const availableMb=hasMeminfo&&memory.MemAvailable>0?mb(memory.MemAvailable*1024):Math.round(freemem()/(1024*1024));
    const usedPercent=percent(totalMb-availableMb,totalMb),load=loadavg(),cores=cpus().length||1;
    const fs=await statfs('/',{bigint:true});
    const diskTotalMb=Number(fs.bsize*fs.blocks)/(1024*1024),diskFreeMb=Number(fs.bsize*fs.bavail)/(1024*1024);
    const diskUsedMb=diskTotalMb-diskFreeMb,diskPercent=percent(diskUsedMb,diskTotalMb);

    const host={
      hostname:hostname(),platform:platform(),release:release(),node:process.version,cores,
      uptimeSeconds:Math.round(uptime()),load:[Math.round(load[0]*100)/100,Math.round(load[1]*100)/100,Math.round(load[2]*100)/100] as [number,number,number],
      memory:{totalMb,availableMb,usedPercent,swapTotalMb:memory.SwapTotal?mb(memory.SwapTotal*1024):0},
      process:{pid:process.pid,rssMb:procRssMb(),uptimeSeconds:Math.round(process.uptime())}
    };

    checks.push({key:'disk',label:'Диск',value:diskPercent+'%',detail:`${diskFreeMb} МБ свободно из ${Math.round(diskTotalMb)} МБ`,status:status(diskPercent,80,90),fix:'Удалите старые релизы в /opt/opengames/releases и архивы в /opt/opengames/backups'});
    checks.push({key:'memory',label:'Память',value:usedPercent+'%',detail:`${availableMb} МБ доступно из ${totalMb} МБ${hasMeminfo?'':' · оценка по freemem без учёта кеша'}`,status:status(usedPercent,85,95)});
    if(!hasMeminfo)limitations.push('Память оценена без /proc/meminfo: значение доступной памяти занижено, пороги строгие');
    checks.push({key:'load',label:'Нагрузка',value:String(host.load[0]),detail:`${cores} ядра, нагрузка за 5 и 15 минут: ${host.load[1]} / ${host.load[2]}`,status:load[0]>cores*1.5?'crit':load[0]>cores?'warn':'ok'});
    checks.push({key:'uptime',label:'Аптайм',value:Math.round(host.uptimeSeconds/86400)+' дн.',detail:`процесс работает ${Math.round(host.process.uptimeSeconds/60)} мин., RSS ${host.process.rssMb} МБ`,status:'ok'});

    const services:ServiceState[]=[];
    for(const unit of this.context.units){const state=await unitState(unit);
      services.push({unit,state,status:state==='active'?'ok':state==='unknown'?'unknown':'crit'});
      checks.push({key:'service:'+unit,label:'Сервис '+unit,value:state,status:state==='active'?'ok':state==='unknown'?'unknown':'crit' as MetricStatus,
        detail:state==='active'?'отвечает':state==='unknown'?'systemctl недоступен для пользователя '+process.env.USER:'не активен',
        fix:state==='unknown'?'Добавьте пользователя в группу systemd-journal или разрешите чтение статуса':state==='active'?undefined:`systemctl restart ${unit}`})}
    if(services.some(item=>item.status==='unknown'))limitations.push('Состояние сервисов получено через systemctl; при отсутствии прав отмечено как неизвестное');

    const endpoints=[] as {name:string;host:string;port:number;status:MetricStatus}[];
    const self=await tcpProbe('127.0.0.1',this.context.port);
    endpoints.push({name:'Приложение',host:'127.0.0.1',port:this.context.port,status:self?'ok':'crit'});
    checks.push({key:'endpoint:app',label:'Приложение слушает порт',value:String(this.context.port),status:self?'ok':'crit',detail:self?'соединение установлено':'порт не отвечает'});
    if(this.context.publicUrl){const url=new URL(this.context.publicUrl);const reachable=await tcpProbe(url.hostname,Number(url.port||443));
      endpoints.push({name:'Публичный адрес',host:url.hostname,port:Number(url.port||443),status:reachable?'ok':'warn'});
      checks.push({key:'endpoint:public',label:'Публичный адрес',value:url.hostname,status:reachable?'ok':'warn',detail:reachable?'отвечает':'не отвечает с сервера',fix:reachable?undefined:'Проверьте nginx и DNS'})}

    const donor=await this.context.donor();
    checks.push({key:'donor',label:'Пул соавторов',value:donor.connected?'подключён':'нет соавторов',status:donor.connected?'ok':'warn',
      detail:donor.connected?'сценарист доступен':'ходы через соавторов невозможны, /api/health отдаёт 503',fix:donor.connected?undefined:'Запустите клиент соавтора или переключите режим на личный ключ'});

    const legal=this.context.legal?this.context.legal():{terms:false,privacy:false};
    checks.push({key:'legal:terms',label:'Оферта опубликована',value:legal.terms?'да':'нет',status:legal.terms?'ok':'warn',detail:legal.terms?'страница отдаётся':'посетитель получает 503 до заполнения реквизитов',fix:legal.terms?undefined:'Заполните реквизиты во вкладке «Правовые документы»'});
    checks.push({key:'legal:privacy',label:'Политика опубликована',value:legal.privacy?'да':'нет',status:legal.privacy?'ok':'warn',detail:legal.privacy?'страница отдаётся':'посетитель получает 503 до заполнения реквизитов',fix:legal.privacy?undefined:'Заполните реквизиты во вкладке «Правовые документы»'});

    let releases=0,releasesMb=0,current='—';const releaseNames:string[]=[];
    try{current=readdirSync(this.context.releasesDir).length?String(readdirSync(this.context.releasesDir)[0]):'—'}catch{}
    try{releaseNames.push(...readdirSync(this.context.releasesDir).filter(name=>!name.startsWith('.')));for(const name of releaseNames){const info=statSync(this.context.releasesDir+'/'+name);if(info.isDirectory()){releases++;releasesMb+=mb(info.size)}}}catch{limitations.push('Каталог релизов недоступен для чтения')}
    const data=dirStats(this.context.dataDir);

    limitations.push('Журнал systemd недоступен пользователю приложения: операция «журнал» вернёт ошибку доступа');
    limitations.push('Срок действия сертификата не проверяется: сертификат не читается пользователем приложения');

    const report:InfraReport={host,disk:{path:'/',totalMb:Math.round(diskTotalMb),usedMb:Math.round(diskUsedMb),freeMb:Math.round(diskFreeMb),usedPercent:diskPercent},
      services,endpoints,app:{games:this.context.games,donorConnected:donor.connected,donorStatus:donor.connected?'ok':'warn',legalTerms:legal.terms,legalPrivacy:legal.privacy},
      storage:{releases,releasesMb,current,dataMb:mb(data.bytes),dataFiles:data.files},checks,
      blocked:[{operation:'restart',reason:'Перезапуск изнутри обслуживающего процесса оборвёт соединение. Выполняйте вручную: systemctl restart opengames'},
        {operation:'rollback',reason:'Переключение current во время работы процесса опасно. Выполняйте вручную: ln -sfnT <релиз> /opt/opengames/current && systemctl restart opengames'}],
      limitations,collectedAt:new Date().toISOString()};
    this.last={at:Date.now(),report};return report}
  async journal(lines=this.context.journalLines){return new Promise<{ok:boolean;output:string}>((resolve)=>{execFile('journalctl',['-u','opengames','-n',String(lines),'--no-pager'],{timeout:6000,maxBuffer:1024*256},(error,stdout,stderr)=>
    resolve({ok:!error,output:String(stdout||stderr||error?.message||'пусто')}))})}
  async operation(name:string){if(name==='health'){const report=await this.report({fresh:true});const bad=report.checks.filter(item=>item.status==='crit'||item.status==='warn');return {ok:bad.length===0,alerts:bad.map(item=>({key:item.key,status:item.status,value:item.value})),checkedAt:report.collectedAt}}
    if(name==='logs')return this.journal();
    throw Object.assign(new Error('Операция «'+name+'» недоступна из приложения'),{status:400})}
}