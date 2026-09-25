import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Action } from './types.ts';
import type { GameRuntime } from './runtime.ts';
import type { AccountStore } from './accounts.ts';
import { DonorAIProvider, DonorUnavailableError } from './donor.ts';
import { DONOR_LEASE_MS } from './donor-protocol.ts';
import { DonorPool, type DonorLease } from './donor-pool.ts';
import { ConnectAIProvider, type ConnectTransport } from './connect-transport.ts';
import type { AIProvider } from './ai.ts';
import type { CoauthorUsageStore } from './coauthor-usage.ts';

type Job = {id:string;ownerId:string;sessionId:string;action:Action;status:'waiting_in_queue'|'generating'|'completed'|'failed'|'cancelled';createdAt:number;chargedDay?:number;finishedAt?:number;error?:string};
export class TurnQueue {
  private jobs: Job[] = [];
  private scheduled?:ReturnType<typeof setTimeout>;
  private pumping=false;
  private runtime: GameRuntime;
  private accounts: AccountStore;
  private pool:DonorPool;
  private transport?:ConnectTransport;
  private usage?:CoauthorUsageStore;
  private file: string;
  constructor(runtime: GameRuntime, accounts:AccountStore, pool:DonorPool, file: string,transport?:ConnectTransport,usage?:CoauthorUsageStore) {
    this.runtime=runtime;this.accounts=accounts;this.pool=pool;this.file=file;this.transport=transport;this.usage=usage;mkdirSync(dirname(file),{recursive:true,mode:0o700});
    if(existsSync(file)) this.jobs=JSON.parse(readFileSync(file,'utf8'));
    for(const job of this.jobs) if(this.active(job)) {
      const done=this.completedTurn(job);
      job.status=done?'completed':'failed';job.finishedAt=Date.now();
      if(!done){job.error='Сервер перезапущен. Ход не выполнен; повторите действие.';this.refund(job)}
      this.forgetAction(job);
    }
    for(const job of this.jobs)if(!this.active(job))this.forgetAction(job);
    this.prune();this.persist();this.pool.onFree=()=>this.schedule();
  }
  private active(j:Job){return j.status==='waiting_in_queue'||j.status==='generating'}
  private completedTurn(j:Job){try{return this.runtime.get(j.sessionId,j.ownerId).turns.find(t=>t.action.requestId===j.action.requestId)}catch{return undefined}}
  private refund(j:Job){if(j.chargedDay!==undefined){this.accounts.refundTurn(j.ownerId,j.chargedDay,j.id);delete j.chargedDay}}
  private forgetAction(j:Job){j.action={type:j.action.type,requestId:j.action.requestId}}
  private persist(){writeFileSync(this.file+'.tmp',JSON.stringify(this.jobs),{mode:0o600});renameSync(this.file+'.tmp',this.file)}
  private prune(){this.jobs=this.jobs.filter(j=>this.active(j)||Date.now()-(j.finishedAt||j.createdAt)<3600_000).slice(-500)}
  pending(sessionId:string,ownerId:string){return this.jobs.find(j=>j.sessionId===sessionId&&j.ownerId===ownerId&&this.active(j))}
  view(id:string,ownerId:string){
    const j=this.jobs.find(j=>j.id===id&&j.ownerId===ownerId);if(!j)throw new Error('Задание не найдено');
    const waiting=this.jobs.filter(x=>x.status==='waiting_in_queue');
    const done=j.status==='completed'?this.completedTurn(j):undefined;
    return {jobId:j.id,status:j.status,position:j.status==='waiting_in_queue'?waiting.indexOf(j)+1:0,error:j.error,...(done?{result:{session:this.runtime.get(j.sessionId,ownerId),narrative:done.narrative,source:done.source}}:{})};
  }
  enqueue(sessionId:string,ownerId:string,action:Action){
    if(!action||typeof action.requestId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(action.requestId))throw new Error('Неверный идентификатор хода');
    const session=this.runtime.get(sessionId,ownerId);
    const previous=this.jobs.find(j=>j.ownerId===ownerId&&j.sessionId===sessionId&&j.action.requestId===action.requestId);
    if(previous)return this.view(previous.id,ownerId);
    if(session.state.ended)throw new Error('Игра уже завершена');
    if(typeof action.type!=='string'||action.type.length>80||typeof action.text!=='undefined'&&(typeof action.text!=='string'||action.text.length>1000))throw new Error('Неверное действие');
    const done=session.turns.find(t=>t.action.requestId===action.requestId);
    if(!done&&this.jobs.some(j=>j.ownerId===ownerId&&this.active(j)))throw new Error('Ваш предыдущий ход ещё обрабатывается');
    this.prune();
    if(!done&&this.jobs.filter(j=>this.active(j)).length>=10)throw new Error('Очередь заполнена. Повторите позже.');
    const chargedDay=done?undefined:this.accounts.reserveTurn(ownerId);
    const job:Job={id:randomUUID(),ownerId,sessionId,action:structuredClone(action),status:done?'completed':'waiting_in_queue',createdAt:Date.now(),chargedDay};
    if(done)this.forgetAction(job);
    try{this.jobs.push(job);this.persist()}catch(error){this.jobs.pop();this.refund(job);throw error}this.schedule();return this.view(job.id,ownerId);
  }
  cancel(id:string,ownerId:string){const j=this.jobs.find(j=>j.id===id&&j.ownerId===ownerId);if(!j)throw new Error('Задание не найдено');if(j.status!=='waiting_in_queue')throw new Error('Генерация уже началась');j.status='cancelled';j.finishedAt=Date.now();this.refund(j);this.forgetAction(j);this.persist();return this.view(id,ownerId)}
  private schedule(delay=0){if(this.scheduled){if(delay)return;clearTimeout(this.scheduled)}this.scheduled=setTimeout(()=>{this.scheduled=undefined;this.pump()},delay)}
  private pump(){
    if(this.pumping)return;this.pumping=true;
    try{for(const job of this.jobs.filter(j=>j.status==='waiting_in_queue')){
      if(Date.now()-job.createdAt>20*60_000){job.status='failed';job.error='Время ожидания истекло. Повторите ход.';job.finishedAt=Date.now();this.refund(job);this.forgetAction(job);this.persist();continue}
      const lease=this.pool.acquire();if(!lease){this.schedule(this.pool.nextRetryDelay());break}
      job.status='generating';this.persist();void this.execute(job,lease);
    }}finally{this.pumping=false}
  }
  private async execute(job:Job,first:DonorLease){
    let lease=first;const tried=new Set<string>(),deadline=Date.now()+DONOR_LEASE_MS,controller=new AbortController();
    const deadlineTimer=setTimeout(()=>controller.abort(new DonorUnavailableError('Истёк общий срок генерации хода')),DONOR_LEASE_MS);
    try{while(true){
      let usageCall:string|undefined,usageFinished=false;
      const finishUsage=(status:'responded'|'failed',reason?:string)=>{if(!usageCall||usageFinished)return;usageFinished=true;try{this.usage!.finish(usageCall,status,reason)}catch{}};
      try{
        const provider=lease.node.kind==='connect'?new ConnectAIProvider(this.transport!,lease.node.id.slice(8),lease.node.model,job.action.requestId!,tried.size+1):new DonorAIProvider(lease.node);
        const coauthorId=lease.node.kind==='connect'?lease.node.id.slice(8):lease.node.id,name=lease.node.kind==='connect'?'OpenGames Connect':'Соавтор OpenGames';
        const tracked:AIProvider={generate:async(game,session,action,correction,options)=>{
          try{usageCall=this.usage?.begin({coauthorId,name,model:lease.node.model,gameId:game.manifest.id})}catch{}
          try{return await provider.generate(game,session,action,correction,{...options,signal:controller.signal,deadline})}
          catch(error){const unavailable=error instanceof DonorUnavailableError?error:new DonorUnavailableError(error instanceof Error?error.message:'Сценарист не выполнил ход');finishUsage('failed',unavailable.message);throw unavailable}
        }};
        await this.runtime.turn(job.sessionId,job.action,tracked,job.ownerId,{signal:controller.signal,deadline});
        finishUsage('responded');this.pool.succeeded(lease.node.id);job.status='completed';break;
      }catch(error){
        if(!(error instanceof DonorUnavailableError)){finishUsage('failed',error instanceof Error?error.message:'Ход не применён');throw error}
        finishUsage('failed',error.message);this.pool.failed(lease.node.id);tried.add(lease.node.id);lease.release();
        const remaining=deadline-Date.now();if(remaining<=0)throw error;
        const next=await this.pool.acquireNext(tried,remaining,controller.signal);if(!next)throw error;lease=next;
      }
    }}catch(error){job.status='failed';job.error=error instanceof Error?error.message:'Не удалось выполнить ход';this.refund(job)}
    finally{clearTimeout(deadlineTimer);controller.abort();lease.release();job.finishedAt=Date.now();this.forgetAction(job);this.persist();this.schedule()}
  }
}
