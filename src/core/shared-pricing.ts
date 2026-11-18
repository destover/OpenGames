import type {TokenUsage} from './ai.ts';
import {GENERATION_MULTIPLIER,MICROS_PER_RUB,toRub,type GenerationCharge} from './billing.ts';

type Price={input:number;output:number;cached?:number;reasoning?:number};
const cache=new Map<string,{at:number;models:Map<string,Price>}>();
const number=(value:unknown)=>(typeof value==='number'||(typeof value==='string'&&value.trim()!==''))&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):undefined;
export async function sharedModelPrice(route:string,model:string):Promise<Price|undefined>{
  let entry=cache.get(route);
  if(!entry||Date.now()-entry.at>900_000){
    const url=route==='provod'?'https://api.provod.ai/api/models':route==='polza'?'https://polza.ai/api/v1/models?type=chat':route==='aitunnel'?'https://api.aitunnel.ru/public/aitunnel/models/chat':undefined;
    if(!url)return;
    const response=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error'});
    if(!response.ok)throw new Error('Каталог цен недоступен');
    const catalog=await response.json() as any,models=new Map<string,Price>();
    const rows=route==='aitunnel'?Object.entries(catalog).map(([id,value])=>({id,...value as object})):catalog.data;
    if(!Array.isArray(rows))throw new Error('Неизвестный формат тарифов');
    for(const row of rows){
      const spec=route==='provod'?row.text:route==='polza'?row.top_provider?.pricing:row;
      if(!spec||(route!=='aitunnel'&&spec.currency!=='RUB'))continue;
      const input=number(spec.promptPricePer1mTokens??spec.prompt_per_million??spec.prompt_cost);
      const output=number(spec.completionPricePer1mTokens??spec.completion_per_million??spec.completion_cost);
      if(input===undefined||output===undefined)continue;
      models.set(row.id,{input,output,cached:number(spec.cacheReadPricePer1mTokens??spec.input_cache_read_per_million),reasoning:number(spec.internal_reasoning_per_million)});
    }
    entry={at:Date.now(),models};cache.set(route,entry);
  }
  return entry.models.get(model);
}
export function generationCharge(provider:string,model:string,usage:TokenUsage|undefined,price:Price):GenerationCharge{
  if(!usage||!Number.isSafeInteger(usage.promptTokens)||!Number.isSafeInteger(usage.completionTokens)||usage.promptTokens<0||usage.completionTokens<0)throw new Error('Провайдер не вернул расход токенов');
  const cached=Math.max(0,Math.min(usage.cachedPromptTokens??0,usage.promptTokens));
  const reasoning=Math.max(0,Math.min(usage.reasoningTokens??0,usage.completionTokens));
  const calculated=((usage.promptTokens-cached)*price.input+cached*(price.cached??price.input)+(usage.completionTokens-reasoning)*price.output+reasoning*(price.reasoning??price.output))/1_000_000;
  const reported=usage.costRub;
  const costRub=reported!==undefined?reported:calculated;
  if(!Number.isFinite(costRub)||costRub<0)throw new Error('Некорректная стоимость генерации');
  return {provider,model,promptTokens:usage.promptTokens,completionTokens:usage.completionTokens,costRub,amountRub:toRub(Math.ceil(costRub*GENERATION_MULTIPLIER*MICROS_PER_RUB)),multiplier:GENERATION_MULTIPLIER,pricingSource:reported!==undefined?'provider':'catalog'};
}
