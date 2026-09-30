import type { BalanceSnapshot, SharedKey } from './shared-key.ts';

const checked=()=>new Date().toISOString();
const number=(value:unknown)=>{const parsed=Number(value);return Number.isFinite(parsed)?Math.round(parsed*100)/100:undefined};
const unreachable=(message:string):BalanceSnapshot=>({available:false,message,checkedAt:checked()});

type Fetcher=typeof fetch;

/** Опрашивает остаток платформенного ключа у провайдера по маршруту реестра. */
export async function fetchBalance(key:Pick<SharedKey,'route'|'label'>,secret:string,doFetch:Fetcher=fetch):Promise<BalanceSnapshot>{
  const auth={Authorization:'Bearer '+secret,'Content-Type':'application/json'};
  const json=async(url:string,headers:Record<string,string>=auth)=>{const response=await doFetch(url,{headers,signal:AbortSignal.timeout(10_000)});if(!response.ok)throw new Error('Ответ '+response.status);return await response.json() as Record<string,any>};
  try{
    if(key.route==='openrouter'){const data=await json('https://openrouter.ai/api/v1/key'),info=data.data||{};return {available:true,limitRub:number(info.limit),usageRub:number(info.usage),remainingRub:number(info.limit_remaining),resetAt:info.limit_reset?new Date(Number(info.limit_reset)*1000).toISOString():undefined,checkedAt:checked()}}
    if(key.route==='aitunnel'){const data=await json('https://api.aitunnel.ru/v1/aitunnel/balance'),info=data.data||data;const remaining=number(info.balance??info.remain??info.amount);return {available:remaining!==undefined,remainingRub:remaining,message:remaining===undefined?'Провайдер не вернул остаток':undefined,checkedAt:checked()}}
    if(key.route==='polza'){const data=await json('https://polza.ai/api/v1/balance'),info=data.data||data;const remaining=number(info.balance??info.amount);return {available:remaining!==undefined,remainingRub:remaining,message:remaining===undefined?'Провайдер не вернул остаток':undefined,checkedAt:checked()}}
    if(key.route==='direct'){const data=await json('https://api.deepseek.com/user/balance'),info=Array.isArray(data.balance_infos)?data.balance_infos[0]:null;if(!info)return unreachable('Провайдер не вернул баланс');const currency=String(info.currency||'CNY'),total=number(info.total_balance);return {available:true,remainingRub:currency==='CNY'?undefined:total,limitRub:undefined,usageRub:undefined,message:currency==='CNY'?`Остаток ${total} ${currency}: пересчёт в рубли не автоматический, курс фиксируется вручную`:undefined,checkedAt:checked()}}
    return unreachable('Для маршрута «'+key.label+'» автоматическая проверка остатка не реализована')
  }catch(error){return unreachable('Проверка не удалась: '+(error instanceof Error?error.message:'неизвестная ошибка'))}
}

export function balanceState(key:Pick<SharedKey,'monthlyCapRub'|'balance'>):'unknown'|'ok'|'low'|'critical'{
  if(!key.balance?.available||key.balance.remainingRub===undefined)return 'unknown';
  if(key.monthlyCapRub<=0)return 'ok';
  const ratio=key.balance.remainingRub/key.monthlyCapRub;
  return ratio<=0.1?'critical':ratio<=0.3?'low':'ok';
}
