import {RemoteAIProvider,type AIProvider,type AIRequestOptions,type AIResult} from './ai.ts';
import type {Action,GamePackage,Session} from './types.ts';
import type {SharedKeyStore} from './shared-key.ts';
import {fetchBalance} from './provider-balance.ts';

const endpoints:Record<string,string>={provod:'https://api.provod.ai/v1',polza:'https://polza.ai/api/v1',aitunnel:'https://api.aitunnel.ru/v1',openrouter:'https://openrouter.ai/api/v1',direct:'https://api.deepseek.com/v1'};
const cooldowns=new Map<string,number>();
export class SharedProvidersUnavailable extends Error {}
export function sharedCandidates(store:SharedKeyStore){
  return store.list().filter(key=>key.status==='active'&&endpoints[key.route]&&(!key.balance?.available||key.balance.remaining===undefined||key.balance.remaining>0)).sort((a,b)=>a.createdAt-b.createdAt||a.route.localeCompare(b.route));
}
export class SharedAIProvider implements AIProvider{
  private store:SharedKeyStore;
  private hasFunds:()=>boolean;
  private record:(provider:string,model:string)=>ReturnType<NonNullable<AIRequestOptions['beginRequest']>>;
  constructor(store:SharedKeyStore,hasFunds:()=>boolean,record:(provider:string,model:string)=>ReturnType<NonNullable<AIRequestOptions['beginRequest']>>){
    this.store=store;this.hasFunds=hasFunds;this.record=record;
  }
  async generate(game:GamePackage,session:Session,action:Action,correction?:string,options?:AIRequestOptions):Promise<AIResult>{
    const deadline=Math.min(options?.deadline??Infinity,Date.now()+110000);
    const keys=sharedCandidates(this.store);
    const ordered=[...keys.map(key=>({key,model:key.model})),...keys.flatMap(key=>key.models.filter(model=>model!==key.model).map(model=>({key,model})))].slice(0,8);
    for(const {key,model} of ordered){
      options?.signal?.throwIfAborted();
      if(!this.hasFunds()||deadline-Date.now()<1000)break;
      const id=key.id+'/'+model;
      if((cooldowns.get(id)||0)>Date.now())continue;
      const secret=this.store.secret(key.id);
      if(!secret)continue;
      let balance=key.balance;
      if(!balance||Date.now()-Date.parse(balance.checkedAt)>60_000){
        balance=await fetchBalance(key.route,secret);
        if(!balance.error)this.store.recordBalance(key.id,balance);
      }
      if(balance?.available&&balance.remaining!==undefined&&balance.remaining<=0)continue;
      const provider=new RemoteAIProvider(key.route,[secret],model,endpoints[key.route]);
      try{
        options?.onNarrative?.('');
        const result=await provider.generate(game,session,action,correction,{...options,deadline:Math.min(deadline,Date.now()+35_000),beginRequest:()=>this.record(key.route,model)});
        cooldowns.delete(id);
        return {...result,source:'shared:'+key.route};
      }catch(error){
        if(options?.signal?.aborted)throw error;
        cooldowns.set(id,Date.now()+60_000);
        const latest=await fetchBalance(key.route,secret);
        if(!latest.error)this.store.recordBalance(key.id,latest);
      }
    }
    throw new SharedProvidersUnavailable('Общие провайдеры сейчас недоступны');
  }
}
