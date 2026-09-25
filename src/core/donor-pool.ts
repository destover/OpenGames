import { readFileSync } from 'node:fs';

export type StaticDonorNode = { id:string; url:string; model:string; keyFile:string; capacity:number; kind?:'static' };
export type DonorNode = StaticDonorNode | {id:string;model:string;capacity:number;kind:'connect'};
type NodeState = DonorNode & { busy:number; reportedBusy:number; cooldownUntil:number; connected:boolean; checkedAt:number };
export type DonorLease = { node:DonorNode; release:()=>void };

export class DonorPool {
  private nodes:NodeState[];
  private cursor=0;
  private listeners=new Set<()=>void>();
  onFree?:()=>void;
  constructor(){
    const file=process.env.OPENGAME_DONORS_FILE;
    const raw:any[]=file?JSON.parse(readFileSync(file,'utf8')):[{id:'primary',url:process.env.OPENGAME_DONOR_URL,model:process.env.OPENGAME_DONOR_MODEL||'opengames-qwen3-8b',keyFile:process.env.OPENGAME_DONOR_KEY_FILE,capacity:1}];
    if(!Array.isArray(raw)||!raw.length||raw.length>32)throw new Error('Неверная конфигурация соавторов');
    const ids=new Set<string>();
    this.nodes=raw.map((entry:any)=>{
      if(!entry||typeof entry.id!=='string'||!/^[a-z0-9_-]{1,40}$/.test(entry.id)||ids.has(entry.id))throw new Error('Неверный идентификатор соавтора');
      ids.add(entry.id);
      const url=new URL(String(entry.url||''));
      if(url.protocol!=='http:'||!['127.0.0.1','[::1]','localhost'].includes(url.hostname)||url.username||url.password||!url.port)throw new Error('Адрес соавтора должен быть локальным туннелем');
      const keyFile=String(entry.keyFile||'');if(!keyFile.startsWith('/'))throw new Error('Требуется файл ключа донора');
      const capacity=Number(entry.capacity??1);if(!Number.isInteger(capacity)||capacity<1||capacity>8)throw new Error('Неверная ёмкость соавтора');
      readFileSync(keyFile,'utf8');
      return {id:entry.id,url:url.toString().replace(/\/$/,''),model:String(entry.model||'opengames-qwen3-8b'),keyFile,capacity,busy:0,reportedBusy:0,cooldownUntil:0,connected:false,checkedAt:0};
    });
  }
  get size(){return this.nodes.length}
  get first():StaticDonorNode{return this.nodes[0] as StaticDonorNode}
  get capacity(){return this.nodes.reduce((sum,node)=>sum+node.capacity,0)}
  get model(){return this.nodes.length===1?this.nodes[0].model:`${this.nodes.length} AI-узла`}
  connect(id:string,model:string,capacity:number,reportedBusy=0){
    if(!/^connect-[0-9a-f-]{36}$/.test(id)||!Number.isInteger(capacity)||capacity<1||capacity>8||!Number.isInteger(reportedBusy)||reportedBusy<0||reportedBusy>capacity)throw new Error('Неверный соавтор');
    const existing=this.nodes.find(node=>node.id===id);
    if(existing){existing.model=model;existing.capacity=capacity;existing.reportedBusy=reportedBusy;existing.connected=true;existing.checkedAt=Date.now();existing.cooldownUntil=0}
    else this.nodes.push({id,model,capacity,kind:'connect',busy:0,reportedBusy,cooldownUntil:0,connected:true,checkedAt:Date.now()});
    this.notify();
  }
  disconnect(id:string){const node=this.nodes.find(item=>item.id===id&&item.kind==='connect');if(node){node.connected=false;node.checkedAt=Date.now();this.notify()}}
  acquire(excluded=new Set<string>()):DonorLease|undefined{
    const now=Date.now(),available=this.nodes.filter(node=>!excluded.has(node.id)&&Math.max(node.busy,node.reportedBusy)<node.capacity&&node.cooldownUntil<=now&&(node.kind!=='connect'||node.connected));
    if(!available.length)return;
    available.sort((a,b)=>Math.max(a.busy,a.reportedBusy)/a.capacity-Math.max(b.busy,b.reportedBusy)/b.capacity||((this.nodes.indexOf(a)-this.cursor+this.nodes.length)%this.nodes.length)-((this.nodes.indexOf(b)-this.cursor+this.nodes.length)%this.nodes.length));
    const state=available[0];state.busy++;this.cursor=(this.nodes.indexOf(state)+1)%this.nodes.length;
    let released=false;
    return {node:state,release:()=>{if(released)return;released=true;state.busy--;this.notify()}};
  }
  failed(id:string){const state=this.nodes.find(node=>node.id===id);if(!state)return;state.connected=false;state.checkedAt=Date.now();state.cooldownUntil=Date.now()+20_000;this.notify()}
  succeeded(id:string){const state=this.nodes.find(node=>node.id===id);if(!state)return;if(state.kind!=='connect')state.connected=true;state.checkedAt=Date.now();state.cooldownUntil=0}
  private notify(){for(const listener of this.listeners)listener();this.onFree?.()}
  async acquireNext(excluded:Set<string>,timeoutMs=180_000,signal?:AbortSignal):Promise<DonorLease|undefined>{
    if(excluded.size>=this.nodes.length)return;
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline&&!signal?.aborted){const lease=this.acquire(excluded);if(lease)return lease;await new Promise<void>(resolve=>{let settled=false;const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);this.listeners.delete(wake);signal?.removeEventListener('abort',finish);resolve()};const wake=()=>finish();const timer=setTimeout(finish,Math.min(2000,deadline-Date.now()));this.listeners.add(wake);signal?.addEventListener('abort',finish,{once:true});if(signal?.aborted)finish()})}
  }
  nextRetryDelay(){const now=Date.now(),times=this.nodes.filter(node=>node.busy<node.capacity).map(node=>node.cooldownUntil-now).filter(time=>time>0);return Math.max(1000,Math.min(20_000,...times))}
  async health(){
    await Promise.all(this.nodes.filter(node=>node.kind!=='connect').map(async node=>{
      if(Date.now()-node.checkedAt<5000)return;
      try{const url=new URL(node.url);url.pathname='/health';const response=await fetch(url,{signal:AbortSignal.timeout(2000)});node.connected=response.ok}
      catch{node.connected=false}node.checkedAt=Date.now();
    }));
    return {connected:this.nodes.some(node=>node.connected),donors:this.nodes.map(node=>({id:node.id,model:node.model,connected:node.connected,busy:Math.max(node.busy,node.reportedBusy),capacity:node.capacity}))};
  }
}
