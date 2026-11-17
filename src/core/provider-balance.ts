import type { BalanceSnapshot, SharedRoute } from './shared-key.ts';

export const sharedProviders={
  direct:{models:'https://api.deepseek.com/models',keyUrl:'https://platform.deepseek.com/api_keys',guide:'Войдите в DeepSeek Platform, откройте API keys, создайте ключ и скопируйте его.'},
  aitunnel:{models:'https://api.aitunnel.ru/public/aitunnel/models/chat',keyUrl:'https://aitunnel.ru/docs/keys',guide:'Пополните счёт, откройте «Ключи» в панели управления, создайте ключ и скопируйте его.'},
  provod:{models:'https://api.provod.ai/v1/models',keyUrl:'https://provod.ai/ru/docs/authentication',guide:'Выберите рабочее пространство, откройте раздел ключей и создайте обычный API-ключ для генерации.'},
  polza:{models:'https://polza.ai/api/v1/models?type=chat',keyUrl:'https://polza.ai/dashboard/api-keys',guide:'Войдите в консоль, выберите организацию, создайте API-ключ и скопируйте его.'},
  openrouter:{models:'https://openrouter.ai/api/v1/models/user',keyUrl:'https://openrouter.ai/settings/keys',guide:'Откройте настройки ключей, создайте API-ключ и при необходимости задайте ему лимит с ежемесячным сбросом.'},
} satisfies Partial<Record<SharedRoute,{models:string;keyUrl:string;guide:string}>>;

export function sharedProvider(route:string){
  return Object.hasOwn(sharedProviders,route)?sharedProviders[route as keyof typeof sharedProviders]:undefined;
}

const number=(value:unknown)=>((typeof value==='number'||(typeof value==='string'&&value.trim()))&&Number.isFinite(Number(value)))?Number(value):undefined;
const minimum=(balance:number|undefined,limit:number|undefined)=>balance===undefined?limit:limit===undefined?balance:Math.min(balance,limit);
const monthly=(value:unknown)=>value==='monthly'||value==='month';

async function providerJson(url:string,secret?:string){
  const response=await fetch(url,{headers:secret?{Authorization:'Bearer '+secret}:undefined,redirect:'error',signal:AbortSignal.timeout(8_000)});
  if(!response.ok)throw new Error('Провайдер вернул HTTP '+response.status);
  return await response.json() as Record<string,any>;
}

export async function fetchBalance(route:string,secret:string,aitunnelKey?:Promise<Record<string,any>>):Promise<BalanceSnapshot>{
  const checkedAt=new Date().toISOString();
  const snapshot=(currency:string,remaining?:number,monthlyRemaining?:number):BalanceSnapshot=>({checkedAt,available:remaining!==undefined,currency,remaining,monthlyRemaining,message:remaining===undefined?'Провайдер не вернул доступную сумму':undefined});
  try{
    if(route==='openrouter'){
      const {data}=await providerJson('https://openrouter.ai/api/v1/key',secret);
      if(data?.is_management_key||data?.is_provisioning_key)throw new Error('Нужен обычный API-ключ для генерации');
      const remaining=number(data?.limit_remaining);
      return {...snapshot('USD',remaining,monthly(data?.limit_reset)?remaining:undefined),message:remaining===undefined?'У ключа нет лимита. Баланс аккаунта доступен только управляющему ключу.':undefined};
    }
    if(route==='aitunnel'){
      const [balance,key]=await Promise.all([providerJson('https://api.aitunnel.ru/v1/aitunnel/balance',secret),aitunnelKey??providerJson('https://api.aitunnel.ru/v1/aitunnel/key',secret)]);
      const remaining=minimum(number(balance.balance),number(balance.budget));
      return snapshot('RUB',remaining,monthly(key.budget?.reset_interval)?remaining:undefined);
    }
    if(route==='polza'){
      const balance=await providerJson('https://polza.ai/api/v2/balance',secret);
      return snapshot('RUB',number(balance.available));
    }
    if(route==='provod'){
      const [balance,key]=await Promise.all([providerJson('https://api.provod.ai/v1/balance',secret),providerJson('https://api.provod.ai/v1/key',secret)]);
      const remaining=minimum(number(balance.availableBalance),number(key.data?.limit_remaining));
      return snapshot(/^[A-Z]{3}$/.test(balance.currency)?balance.currency:'RUB',remaining,monthly(key.data?.limit_reset)?remaining:undefined);
    }
    if(route==='direct'){
      const balance=await providerJson('https://api.deepseek.com/user/balance',secret);
      const info=Array.isArray(balance.balance_infos)?balance.balance_infos[0]:undefined;
      return snapshot(info?.currency==='CNY'?'CNY':'USD',number(info?.total_balance));
    }
    return {available:false,checkedAt,message:'Для этого провайдера автоматическая проверка недоступна'};
  }catch(error){
    return {available:false,checkedAt,error:true,message:error instanceof Error?error.message:'Проверка остатка недоступна'};
  }
}

export async function inspectSharedProvider(route:string,secret:string){
  const provider=sharedProvider(route);
  if(!provider)throw Object.assign(new Error('Выберите поддерживаемого провайдера'),{status:400});
  if(secret.length<16||secret.length>1024)throw Object.assign(new Error('Укажите API-ключ провайдера'),{status:400});
  try{
    const aitunnelKey=route==='aitunnel'?providerJson('https://api.aitunnel.ru/v1/aitunnel/key',secret):undefined;
    const [catalog,balance,access]=await Promise.all([
      providerJson(provider.models,['aitunnel','polza'].includes(route)?undefined:secret),
      fetchBalance(route,secret,aitunnelKey),
      aitunnelKey,
    ]);
    if(balance.error&&(['polza','openrouter'].includes(route)||/HTTP (401|403)/.test(balance.message||'')))throw new Error(balance.message);
    const allowed=Array.isArray(access?.allowed_models)&&access.allowed_models.length?new Set(access.allowed_models):undefined;
    const entries=route==='aitunnel'?Object.keys(catalog).map(id=>({id})):catalog.data;
    if(!Array.isArray(entries))throw new Error('Провайдер вернул неизвестный формат каталога');
    const models=new Map<string,{id:string;name:string}>();
    for(const model of entries){
      const id=model?.id;
      const output=model?.architecture?.output_modalities??model?.output_modalities;
      if(typeof id!=='string'||!id||id.length>120||(allowed&&!allowed.has(id))||(Array.isArray(output)&&!output.includes('text')))continue;
      models.set(id,{id,name:typeof model.name==='string'?model.name:id});
    }
    if(!models.size)throw new Error('Провайдер не вернул доступных текстовых моделей');
    return {models:[...models.values()],balance};
  }catch(error){
    throw Object.assign(new Error(error instanceof Error?error.message:'Каталог провайдера недоступен'),{status:502});
  }
}
