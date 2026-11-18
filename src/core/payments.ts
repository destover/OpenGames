import { timingSafeEqual } from 'node:crypto';

export type PaymentProviderId = 'yookassa';
export const paymentProviderIds = ['yookassa'] as const;
export type PaymentCredentials = {shopId:string; apiKey:string};
export type TopupRequest = {paymentId:string; amountRub:number; description:string; returnUrl?:string};
export type CreatedTopup = {externalId:string; confirmationUrl:string};
export type ProviderEvent = {externalId:string; orderId:string; status:'succeeded'|'pending'|'failed'; amountRub:number};
export type VerifyContext = {raw:string; ip:string; headers:Record<string,string|undefined>};

export interface PaymentProvider {
  id:PaymentProviderId; label:string; configured:boolean; note:string;
  create(request:TopupRequest):Promise<CreatedTopup>;
  verify(context:VerifyContext):boolean;
  notificationId(raw:string):string | undefined;
  status(externalId:string):Promise<ProviderEvent>;
  refund(externalId:string,amountRub:number):Promise<{refundId:string}>;
}

export class PaymentError extends Error {
  status:number;
  constructor(message:string,status=502){super(message);this.status=status}
}

const normalizeIp=(ip:string)=>ip.replace(/^::ffff:/,'').replace(/^\[|\]$/g,'');
const equal=(a:string,b:string)=>{
  const left=Buffer.from(a),right=Buffer.from(b);
  return left.length===right.length&&timingSafeEqual(left,right);
};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const parseJson=(raw:string)=>{
  try{const value=JSON.parse(raw);return value && typeof value==='object' && !Array.isArray(value)?value:null}
  catch{return null}
};

function paymentEvent(externalId:unknown,orderId:unknown,status:ProviderEvent['status'],amount:unknown,currency:unknown):ProviderEvent {
  const amountRub=typeof amount==='number'||(typeof amount==='string'&&/^\d+(?:\.\d{1,2})?$/.test(amount))?Number(amount):NaN;
  if(!uuid(externalId)||!uuid(orderId)||currency!=='RUB'||!Number.isFinite(amountRub)||amountRub<=0){
    throw new PaymentError('Провайдер вернул некорректные реквизиты платежа');
  }
  return {externalId,orderId,status,amountRub};
}

function topupLink(externalId:unknown, value:unknown, domains:string[]):CreatedTopup {
  let url:URL|undefined;
  try{if(typeof value==='string')url=new URL(value)}catch{}
  if(!uuid(externalId)||!url||url.protocol!=='https:'||url.username||url.password||
    !domains.some(domain=>url!.hostname===domain||url!.hostname.endsWith('.'+domain))){
    throw new PaymentError('Провайдер вернул некорректный адрес оплаты');
  }
  return {externalId,confirmationUrl:url.href};
}
const returnPage=(origin?:string)=>(origin||'https://opengames.duckdns.org').replace(/\/$/,'')+'/#/profile/account';

async function providerJson(url:string, init:RequestInit){
  try{
    const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(12_000)});
    if(response.ok)return await response.json();
  }catch{}
  throw new PaymentError('Платёжный провайдер временно недоступен или отклонил запрос');
}

class YooKassaProvider implements PaymentProvider {
  id='yookassa' as const;
  label='ЮKassa (СБП)';
  private readonly credentials:PaymentCredentials;
  private readonly allowedIps:Set<string>;
  private readonly token:string;
  constructor(credentials:PaymentCredentials,env:NodeJS.ProcessEnv){
    this.credentials=credentials;
    this.token=env.PAYMENT_WEBHOOK_TOKEN||'';
    this.allowedIps=new Set((env.YOOKASSA_ALLOWED_IPS||'').split(',').map(value=>normalizeIp(value.trim())).filter(Boolean));
  }
  get configured(){return Boolean(this.credentials.shopId&&this.credentials.apiKey)}
  get note(){return this.configured?'Реквизиты заполнены. Статус уведомлений проверяется через API ЮKassa.':'Укажите идентификатор магазина и секретный ключ ЮKassa.'}
  private call(path:string,init:RequestInit={}){
    return providerJson('https://api.yookassa.ru/v3'+path,{
      ...init,headers:{Authorization:'Basic '+Buffer.from(this.credentials.shopId+':'+this.credentials.apiKey).toString('base64'),
        'Content-Type':'application/json',...init.headers}
    });
  }
  async create(request:TopupRequest){
    if(!this.configured)throw new PaymentError(this.note,503);
    const data=await this.call('/payments',{method:'POST',headers:{'Idempotence-Key':request.paymentId},body:JSON.stringify({
      amount:{value:request.amountRub.toFixed(2),currency:'RUB'},capture:true,payment_method_data:{type:'sbp'},
      description:request.description,confirmation:{type:'redirect',return_url:returnPage(request.returnUrl)},
      metadata:{payment_id:request.paymentId}
    })});
    return topupLink(data?.id,data?.confirmation?.confirmation_url,['yookassa.ru','yoomoney.ru']);
  }
  verify(context:VerifyContext){
    if(!this.token&&!this.allowedIps.size)return true;
    return Boolean((this.token&&equal(context.headers['x-payment-token']||'',this.token))||this.allowedIps.has(normalizeIp(context.ip)));
  }
  notificationId(raw:string){
    const data=parseJson(raw);
    if(data?.type==='notification'&&['payment.succeeded','payment.canceled'].includes(data.event)&&uuid(data.object?.id))return data.object.id;
  }
  async status(externalId:string){
    const data=await this.call('/payments/'+encodeURIComponent(externalId));
    const status=data?.status==='succeeded'&&data.paid===true?'succeeded':data?.status==='canceled'?'failed':'pending';
    return paymentEvent(data?.id,data?.metadata?.payment_id,status,data?.amount?.value,data?.amount?.currency);
  }
  async refund(externalId:string,amountRub:number){
    const data=await this.call('/refunds',{method:'POST',headers:{'Idempotence-Key':'refund-'+externalId},
      body:JSON.stringify({payment_id:externalId,amount:{value:amountRub.toFixed(2),currency:'RUB'}})});
    if(!uuid(data?.id)||data.payment_id!==externalId||data.status!=='succeeded')throw new PaymentError('ЮKassa ещё не подтвердила возврат',409);
    return {refundId:data.id};
  }
}

export function paymentRegistry(env:NodeJS.ProcessEnv, saved:(id:PaymentProviderId)=>PaymentCredentials|undefined){
  const credentials=(id:PaymentProviderId)=>saved(id)??{shopId:env.YOOKASSA_SHOP_ID||'',apiKey:env.YOOKASSA_SECRET_KEY||''};
  const byId=(value:string)=>{
    if(value==='yookassa')return new YooKassaProvider(credentials(value),env);
  };
  const describe=()=>paymentProviderIds.map(id=>{
    const {shopId,apiKey}=credentials(id);
    const {label,configured,note}=byId(id)!;
    return {id,label,configured,note,shopId,hasApiKey:!!apiKey};
  });
  return {credentials,byId,describe};
}
