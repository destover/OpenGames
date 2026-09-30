import { createHmac, timingSafeEqual } from 'node:crypto';

export type TopupRequest={paymentId:string;amountRub:number;description:string;returnUrl?:string};
export type CreatedTopup={externalId:string;confirmationUrl:string};
export type ProviderEvent={externalId:string;status:'succeeded'|'pending'|'failed';amountRub?:number;receiptUrl?:string};
export type VerifyContext={raw:string;ip:string;headers:Record<string,string|undefined>};

export interface PaymentProvider{
  id:string;label:string;configured:boolean;note:string;
  create(request:TopupRequest):Promise<CreatedTopup>;
  verify(context:VerifyContext):boolean;
  parse(raw:string):ProviderEvent|null;
  status(externalId:string):Promise<ProviderEvent|null>;
  refund(externalId:string,amountRub:number):Promise<{refundId:string}>;
}

export class PaymentError extends Error { status:number; constructor(message:string,status=502){super(message);this.status=status} }
const normalizeIp=(ip:string)=>String(ip||'').replace(/^::ffff:/,'').replace(/^\[|\]$/g,'');
const equal=(a:string,b:string)=>{const left=Buffer.from(String(a)),right=Buffer.from(String(b));return left.length===right.length&&timingSafeEqual(left,right)};
const ruble=(value:unknown)=>{const parsed=Number(value);return Number.isFinite(parsed)?Math.round(parsed*100)/100:0};
const parseJson=(raw:string)=>{try{return JSON.parse(raw) as Record<string,any>}catch{return null}};

class YooKassaProvider implements PaymentProvider {
  id='yookassa';label='ЮKassa (СБП)';private shopId:string;private secretKey:string;private allowedIps:Set<string>;private token:string;private returnUrl?:string;
  constructor(env:NodeJS.ProcessEnv){this.shopId=env.YOOKASSA_SHOP_ID||'';this.secretKey=env.YOOKASSA_SECRET_KEY||'';this.token=env.PAYMENT_WEBHOOK_TOKEN||'';this.returnUrl=env.OPENGAME_PUBLIC_URL;this.allowedIps=new Set(String(env.YOOKASSA_ALLOWED_IPS||'').split(',').map(value=>value.trim()).filter(Boolean))}
  get configured(){return Boolean(this.shopId&&this.secretKey&&(this.allowedIps.size>0||this.token))}
  get note(){if(!this.shopId||!this.secretKey)return 'Не заданы YOOKASSA_SHOP_ID или YOOKASSA_SECRET_KEY';if(!this.allowedIps.size&&!this.token)return 'Не задан YOOKASSA_ALLOWED_IPS или PAYMENT_WEBHOOK_TOKEN: уведомления приниматься не будут';return 'Уведомления проверяются по списку IP и общему токену'}
  private async call(path:string,init:RequestInit={}){const response=await fetch('https://api.yookassa.ru/v3'+path,{...init,headers:{Authorization:'Basic '+Buffer.from(this.shopId+':'+this.secretKey).toString('base64'),'Content-Type':'application/json','Idempotence-Key':String((init.headers as Record<string,string>)?.['Idempotence-Key']||''),...(init.headers||{})},signal:AbortSignal.timeout(12_000)});
    const data=await response.json().catch(()=>null) as Record<string,any>|null;if(!response.ok)throw new PaymentError('Платёжный провайдер ответил ошибкой '+(data?.description||response.status),502);return data||{}}
  async create(request:TopupRequest){if(!this.configured)throw new PaymentError(this.note,503);
    const base=String(request.returnUrl||this.returnUrl||'').replace(/\/$/,'');
    const data=await this.call('/payments',{method:'POST',headers:{'Idempotence-Key':request.paymentId},body:JSON.stringify({amount:{value:request.amountRub.toFixed(2),currency:'RUB'},capture:true,description:request.description,confirmation:{type:'redirect',return_url:base?`${base}/#/profile/billing`:'https://opengames.duckdns.org/#/profile/billing'},metadata:{payment_id:request.paymentId}})});
    return {externalId:String(data.id),confirmationUrl:String(data.confirmation?.confirmation_url||'')}}
  verify(context:VerifyContext){if(this.token&&equal(String(context.headers['x-payment-token']||''),this.token))return true;return this.allowedIps.size>0&&this.allowedIps.has(normalizeIp(context.ip))}
  parse(raw:string){const data=parseJson(raw);const object=data?.object;if(!object?.id)return null;const status=String(object.status||'');
    const state:ProviderEvent['status']=status==='succeeded'?'succeeded':status==='canceled'?'failed':'pending';
    return {externalId:String(object.id),status:state,amountRub:ruble(object.amount?.value),receiptUrl:object.receipt?String(object.receipt.url||''):undefined}}
  async status(externalId:string){const data=await this.call('/payments/'+encodeURIComponent(externalId));const status=String(data.status||'');
    return {externalId:String(data.id),status:status==='succeeded'?'succeeded':status==='pending'?'pending':'failed',amountRub:ruble(data.amount?.value),receiptUrl:data.receipt?.url?String(data.receipt.url):undefined} as ProviderEvent}
  async refund(externalId:string,amountRub:number){const data=await this.call('/refunds',{method:'POST',headers:{'Idempotence-Key':'refund-'+externalId},body:JSON.stringify({payment_id:externalId,amount:{value:amountRub.toFixed(2),currency:'RUB'}})});return {refundId:String(data.id)}}
}

class EnotProvider implements PaymentProvider {
  id='enot';label='ENOT (СБП)';private shopId:string;private apiKey:string;private secret:string;
  constructor(env:NodeJS.ProcessEnv){this.shopId=env.ENOT_SHOP_ID||'';this.apiKey=env.ENOT_API_KEY||'';this.secret=env.ENOT_WEBHOOK_SECRET||''}
  get configured(){return Boolean(this.shopId&&this.secret)}
  get note(){return 'Схема создания платежа ENOT не подтверждена документацией: включать только после сверки полей уведомления. Приём уведомлений работает по HMAC-SHA256 заголовка x-signature.'}
  async create():Promise<CreatedTopup>{throw new PaymentError(this.note,501)}
  verify(context:VerifyContext){if(!this.secret)return false;const signature=String(context.headers['x-signature']||'');if(!signature)return false;return equal(createHmac('sha256',this.secret).update(context.raw).digest('hex'),signature)}
  parse(raw:string){const data=parseJson(raw);if(!data)return null;const id=String(data.payment_id||data.id||data.payment?.id||'');if(!id)return null;
    const rawStatus=String(data.status||data.state||'').toLowerCase();
    const state:ProviderEvent['status']=['succeeded','success','paid','completed','confirmed'].includes(rawStatus)?'succeeded':['failed','canceled','cancelled','declined','error'].includes(rawStatus)?'failed':'pending';
    return {externalId:id,status:state,amountRub:ruble(data.amount??data.sum??data.payment?.amount)}}
  async status():Promise<ProviderEvent|null>{return null}
  async refund(_externalId:string,_amountRub:number):Promise<{refundId:string}>{throw new PaymentError('Возврат через ENOT не реализован: подтвердите схему у провайдера',501)}
}

export type PaymentRegistry={providers:PaymentProvider[];byId(id:string):PaymentProvider|undefined;describe():{id:string;label:string;configured:boolean;note:string}[]};
export function paymentRegistry(env:NodeJS.ProcessEnv):PaymentRegistry{const providers:PaymentProvider[]=[new YooKassaProvider(env),new EnotProvider(env)];return {providers,byId:id=>providers.find(item=>item.id===id),describe:()=>providers.map(item=>({id:item.id,label:item.label,configured:item.configured,note:item.note}))}}
