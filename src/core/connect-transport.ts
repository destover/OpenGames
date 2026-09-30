import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import { parseResult } from './ai.ts';
import type { AIProvider, AIRequestOptions } from './ai.ts';
import { DonorUnavailableError } from './donor.ts';
import { donorRequest, DONOR_HEARTBEAT_MS, DONOR_LEASE_MS, DONOR_MAX_MESSAGE_BYTES, parseDonorEvent, type DonorJob } from './donor-protocol.ts';
import type { DeviceRegistry } from './device-registry.ts';
import type { DonorPool } from './donor-pool.ts';
import type { Action, GamePackage, Session } from './types.ts';

type Pending={requestId:string;attempt:number;accepted:boolean;timer:ReturnType<typeof setTimeout>;ackTimer:ReturnType<typeof setTimeout>;signal?:AbortSignal;abort?:()=>void;resolve:(result:unknown)=>void;reject:(error:Error)=>void};
type Peer={socket:WebSocket;lastSeen:number;lastHeartbeat:number;windowStart:number;messages:number;pending:Map<string,Pending>;active:boolean};

export class ConnectTransport {
  private peers=new Map<string,Peer>();
  private server=new WebSocketServer({noServer:true,maxPayload:DONOR_MAX_MESSAGE_BYTES,perMessageDeflate:false});
  private registry:DeviceRegistry;
  private pool:DonorPool;
  constructor(http:Server,registry:DeviceRegistry,pool:DonorPool){
    this.registry=registry;this.pool=pool;
    http.on('upgrade',(req,socket,head)=>{
      if(req.url?.split('?')[0]!=='/api/donor/connect'){socket.destroy();return}
      const localProxy=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'');
      if(process.env.OPENGAME_PUBLIC_URL?.startsWith('https://')&&!((req.socket as typeof req.socket & {encrypted?:boolean}).encrypted||(localProxy&&req.headers['x-forwarded-proto']==='https'))){socket.destroy();return}
      const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,64})$/)?.[1];
      const device=this.registry.authenticate(token);
      if(!device){socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return}
      this.server.handleUpgrade(req,socket as Duplex,head,ws=>this.accept(device.id,ws));
    });
    setInterval(()=>this.sweep(),DONOR_HEARTBEAT_MS).unref();
  }
  private accept(id:string,socket:WebSocket){
    this.disconnect(id);
    const peer:Peer={socket,lastSeen:Date.now(),lastHeartbeat:0,windowStart:Date.now(),messages:0,pending:new Map(),active:false};this.peers.set(id,peer);
    socket.on('message',raw=>{
      try{
        const now=Date.now();if(now-peer.windowStart>1000){peer.windowStart=now;peer.messages=0}if(++peer.messages>30)throw new Error('Слишком много сообщений');
        const event=parseDonorEvent(raw.toString());peer.lastSeen=Date.now();
        if(event.type==='heartbeat'){
          if(now-peer.lastHeartbeat<5000)throw new Error('Слишком частый heartbeat');peer.lastHeartbeat=now;
          if(event.model!==this.pool.first.model||!event.available){peer.active=false;this.pool.disconnect('connect-'+id);return}
          peer.active=true;this.registry.heartbeat(id,event.model,event.busy,event.slots);
          this.pool.connect('connect-'+id,event.model,event.slots,event.busy);return;
        }
        if(event.type==='accepted'||event.type==='completed'||event.type==='failed'){
          const pending=peer.pending.get(event.jobId);
          if(!pending||pending.requestId!==event.requestId||pending.attempt!==event.attempt)return;
          if(event.type==='accepted'){pending.accepted=true;clearTimeout(pending.ackTimer);return}
          if(!pending.accepted)return;
          clearTimeout(pending.timer);clearTimeout(pending.ackTimer);peer.pending.delete(event.jobId);
          if(event.type==='completed')pending.resolve(event.result);
          else pending.reject(new DonorUnavailableError('Устройство не выполнило задание'));
        }
      }catch{socket.close(1008,'Invalid donor message')}
    });
    socket.on('close',()=>{if(this.peers.get(id)===peer)this.disconnect(id)});
    socket.on('error',()=>this.disconnect(id));
  }
  disconnect(id:string){
    const peer=this.peers.get(id);if(!peer)return;
    this.peers.delete(id);this.pool.disconnect('connect-'+id);
    for(const pending of peer.pending.values()){clearTimeout(pending.timer);clearTimeout(pending.ackTimer);if(pending.abort&&pending.signal)pending.signal.removeEventListener('abort',pending.abort);pending.reject(new DonorUnavailableError('Соавтор отключился'))}
    peer.pending.clear();peer.socket.terminate();
  }
  connected(id:string){const peer=this.peers.get(id);return Boolean(peer?.active&&peer.socket.readyState===WebSocket.OPEN)}
  close(){for(const id of [...this.peers.keys()])this.disconnect(id)}
  private sweep(){for(const [id,peer] of this.peers)if(Date.now()-peer.lastSeen>DONOR_HEARTBEAT_MS*3)this.disconnect(id)}
  request(id:string,requestId:string,attempt:number,request:ReturnType<typeof donorRequest>,deadline:number,signal?:AbortSignal){
    const peer=this.peers.get(id);if(!peer||!peer.active||peer.socket.readyState!==WebSocket.OPEN)throw new DonorUnavailableError('Соавтор не подключён');
    const remaining=deadline-Date.now();if(remaining<=0)throw new DonorUnavailableError('Время ответа сценариста истекло');
    const jobId=randomUUID(),message:DonorJob={version:1,type:'job',jobId,requestId,attempt,leaseUntil:deadline,model:this.pool.first.model,request};
    return new Promise<unknown>((resolve,reject)=>{
      if(signal?.aborted){reject(new DonorUnavailableError('Задание донора отменено'));return}
      const cleanup=(pending:Pending)=>{clearTimeout(pending.timer);clearTimeout(pending.ackTimer);if(pending.abort&&pending.signal)pending.signal.removeEventListener('abort',pending.abort);peer.pending.delete(jobId)};
      const timer=setTimeout(()=>{const pending=peer.pending.get(jobId);if(!pending)return;cleanup(pending);peer.socket.send(JSON.stringify({version:1,type:'cancel',jobId,requestId}));reject(new DonorUnavailableError('Соавтор не ответил в установленный срок'))},remaining);
      const ackTimer=setTimeout(()=>{const pending=peer.pending.get(jobId);if(!pending)return;cleanup(pending);peer.socket.send(JSON.stringify({version:1,type:'cancel',jobId,requestId}));reject(new DonorUnavailableError('Соавтор не принял задание'))},Math.min(10_000,remaining));
      const pending:Pending={requestId,attempt,accepted:false,timer,ackTimer,signal,resolve:value=>{cleanup(pending);resolve(value)},reject:error=>{cleanup(pending);reject(error)}};
      if(signal){pending.abort=()=>{if(!peer.pending.has(jobId))return;cleanup(pending);if(peer.socket.readyState===WebSocket.OPEN)peer.socket.send(JSON.stringify({version:1,type:'cancel',jobId,requestId}));reject(new DonorUnavailableError('Задание донора отменено'))};signal.addEventListener('abort',pending.abort,{once:true})}
      peer.pending.set(jobId,pending);
      peer.socket.send(JSON.stringify(message),error=>{if(error&&peer.pending.has(jobId))pending.reject(new DonorUnavailableError('Не удалось отправить задание'))});
    });
  }
}

export class ConnectAIProvider implements AIProvider {
  private transport:ConnectTransport;
  private deviceId:string;
  private model:string;
  private requestId:string;
  private attempt:number;
  constructor(transport:ConnectTransport,deviceId:string,model:string,requestId:string,attempt:number){this.transport=transport;this.deviceId=deviceId;this.model=model;this.requestId=requestId;this.attempt=attempt}
  async generate(game:GamePackage,session:Session,action:Action,correction?:string,options?:AIRequestOptions){
    const deadline=options?.deadline||Date.now()+DONOR_LEASE_MS;if(deadline<=Date.now())throw new DonorUnavailableError('Время ответа сценариста истекло');
    const request=donorRequest(game,session,action,this.model,correction);
    const result=await this.transport.request(this.deviceId,this.requestId,this.attempt++,request,deadline,options?.signal);
    return parseResult(result,game,action,'donor',session);
  }
}
