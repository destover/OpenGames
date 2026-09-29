import { prompt } from './ai.ts';
import type { Action, GamePackage, Session } from './types.ts';

export const DONOR_PROTOCOL_VERSION = 1;
export const DONOR_MAX_MESSAGE_BYTES = 256 * 1024;
export const DONOR_MAX_RESULT_BYTES = 64 * 1024;
export const DONOR_HEARTBEAT_MS = 15_000;
export const DONOR_LEASE_MS = 300_000;

export type DonorJob = {version:1;type:'job';jobId:string;requestId:string;attempt:number;leaseUntil:number;model:string;request:ReturnType<typeof donorRequest>};
export type DonorCommand = DonorJob | {version:1;type:'cancel';jobId:string;requestId:string};
export type DonorEvent =
  | {version:1;type:'heartbeat';model:string;quantization:string;slots:number;busy:number;available:boolean}
  | {version:1;type:'accepted';jobId:string;requestId:string;attempt:number}
  | {version:1;type:'completed';jobId:string;requestId:string;attempt:number;result:unknown}
  | {version:1;type:'failed';jobId:string;requestId:string;attempt:number;reason:'timeout'|'model'|'resource'|'cancelled'};

export function donorRequest(game:GamePackage,session:Session,action:Action,model:string,correction?:string){
  const mutation={type:'object',required:['op','path'],additionalProperties:false,properties:{op:{enum:['set','increment','append','remove']},path:{type:'string'},value:{type:['string','number','boolean','object','array','null']},amount:{type:'number'}}};
  const event=game.rules?.transitions[action.type]?.event;
  const actionTypes=game.boundaries?['free_text']:Object.keys(game.actions);
  const schema={type:'object',required:['narrative','suggestions','state_mutation','events'],additionalProperties:false,properties:{narrative:{type:'string'},suggestions:{type:'array',minItems:2,maxItems:3,items:{type:'object',required:['type','text','icon'],additionalProperties:false,properties:{type:{enum:actionTypes},text:{type:'string'},icon:{type:'string'}}}},state_mutation:{type:'array',maxItems:game.boundaries?6:0,items:mutation},events:{type:'array',minItems:event?1:0,maxItems:event?1:0,items:{type:'object',required:['type'],additionalProperties:false,properties:{type:event?{const:event}:{type:'string'}}}}}};
  const request={model,temperature:0.35,max_tokens:400,response_format:{type:'json_schema',json_schema:{name:'game_turn',strict:true,schema}},messages:[{role:'system',content:prompt(game,session,action,correction)+'\nKeep the narrative within 3 sentences and the suggestions within 3 items. Use set for every string, list and enum field; use increment only for a field marked as a number and only under the conditions written in that field. Never leave a field the action clearly changed. Append at most 2 items to a list per turn. Do not invent locations contradicting known world facts. Return events: [] in State Author mode. Use set with the resulting number when reducing a numeric resource.'},{role:'user',content:JSON.stringify({action})}]};
  if(Buffer.byteLength(JSON.stringify(request))>DONOR_MAX_MESSAGE_BYTES)throw new Error('Задание превышает допустимый размер');
  return request;
}

export function parseDonorEvent(raw:string):DonorEvent{
  if(Buffer.byteLength(raw)>DONOR_MAX_MESSAGE_BYTES)throw new Error('Сообщение донора слишком большое');
  const data:unknown=JSON.parse(raw);
  if(!data||typeof data!=='object')throw new Error('Неверное сообщение донора');
  const item=data as Record<string,unknown>;
  if(item.version!==DONOR_PROTOCOL_VERSION||typeof item.type!=='string')throw new Error('Неверная версия протокола донора');
  if(item.type==='heartbeat'){
    if(typeof item.model==='string'&&item.model.length<=100&&typeof item.quantization==='string'&&item.quantization.length<=40&&Number.isInteger(item.slots)&&Number(item.slots)>=1&&Number(item.slots)<=8&&Number.isInteger(item.busy)&&Number(item.busy)>=0&&Number(item.busy)<=Number(item.slots)&&typeof item.available==='boolean')return item as DonorEvent;
  }else if(['accepted','completed','failed'].includes(item.type)){
    if(typeof item.jobId==='string'&&/^[0-9a-f-]{36}$/i.test(item.jobId)&&typeof item.requestId==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(item.requestId)&&Number.isInteger(item.attempt)&&Number(item.attempt)>=1){
      if(item.type==='accepted')return item as DonorEvent;
      if(item.type==='failed'&&['timeout','model','resource','cancelled'].includes(String(item.reason)))return item as DonorEvent;
      if(item.type==='completed'&&item.result!==undefined&&Buffer.byteLength(JSON.stringify(item.result))<=DONOR_MAX_RESULT_BYTES)return item as DonorEvent;
    }
  }
  throw new Error('Неверное сообщение донора');
}
