import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type PaymentStatus='pending'|'succeeded'|'failed'|'refunded';
export type LedgerKind='topup'|'bonus'|'refund'|'adjustment';

export const MICROS_PER_RUB=1_000_000;
export const toMicros=(rub:number)=>Math.round(rub*MICROS_PER_RUB);
export const toRub=(micros:number)=>micros/MICROS_PER_RUB;
export const PACKAGES=[{id:'p300',amountRub:300,bonusRub:0},{id:'p1000',amountRub:1000,bonusRub:50},{id:'p3000',amountRub:3000,bonusRub:300},{id:'p10000',amountRub:10000,bonusRub:1000}] as const;
export type PackId=typeof PACKAGES[number]['id'];
export const packageById=(id:string)=>PACKAGES.find(item=>item.id===id);

export type Payment={id:string;userId:string;provider:string;externalId:string|null;packId:string;amountRub:number;bonusRub:number;commission:number;status:PaymentStatus;confirmationUrl:string|null;receiptUrl:string|null;createdAt:number;paidAt:number|null;refundedAt:number|null;refundId:string|null;note:string|null};
export type LedgerEntry={id:string;userId:string;ts:number;kind:LedgerKind;amountRub:number;balanceAfterRub:number;ref:string|null;meta:string|null};
export type PaymentInput={userId:string;provider:string;packId:string;externalId?:string;confirmationUrl?:string;commission?:number;note?:string};
export type ProviderEvent={externalId:string;status:'succeeded'|'pending'|'failed';amountRub?:number;receiptUrl?:string};

const row=(record:Record<string,unknown>)=>({
  id:String(record.id),userId:String(record.user_id),provider:String(record.provider),externalId:record.external_id==null?null:String(record.external_id),
  packId:String(record.pack_id),amountRub:Number(record.amount_rub),bonusRub:Number(record.bonus_rub),commission:Number(record.commission_rub),
  status:String(record.status) as PaymentStatus,confirmationUrl:record.confirmation_url==null?null:String(record.confirmation_url),
  receiptUrl:record.receipt_url==null?null:String(record.receipt_url),createdAt:Number(record.created_at),paidAt:record.paid_at==null?null:Number(record.paid_at),
  refundedAt:record.refunded_at==null?null:Number(record.refunded_at),refundId:record.refund_id==null?null:String(record.refund_id),note:record.note==null?null:String(record.note)
});

export class BillingStore {
  private db:DatabaseSync;
  constructor(file:string){mkdirSync(dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file);chmodSync(file,0o600);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,provider TEXT NOT NULL,external_id TEXT UNIQUE,pack_id TEXT NOT NULL,amount_rub REAL NOT NULL,bonus_rub REAL NOT NULL,commission_rub REAL NOT NULL DEFAULT 0,status TEXT NOT NULL,confirmation_url TEXT,receipt_url TEXT,created_at INTEGER NOT NULL,paid_at INTEGER,refunded_at INTEGER,refund_id TEXT,note TEXT);
    CREATE INDEX IF NOT EXISTS payments_user ON payments(user_id,created_at);
    CREATE INDEX IF NOT EXISTS payments_status ON payments(status,created_at);
    CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,ts INTEGER NOT NULL,kind TEXT NOT NULL,amount_micros INTEGER NOT NULL,balance_after_micros INTEGER NOT NULL,ref TEXT,meta TEXT);
    CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id,ts);`)}
  private balanceMicros(userId:string){const row=this.db.prepare('SELECT balance_after_micros AS balance FROM ledger WHERE user_id=? ORDER BY ts DESC,rowid DESC LIMIT 1').get(userId) as {balance:number}|undefined;return row?Number(row.balance):0}
  private credit(userId:string,kind:LedgerKind,micros:number,ref:string,meta?:Record<string,unknown>){const balance=this.balanceMicros(userId)+micros,id=randomUUID();this.db.prepare('INSERT INTO ledger(id,user_id,ts,kind,amount_micros,balance_after_micros,ref,meta) VALUES(?,?,?,?,?,?,?,?)').run(id,userId,Date.now(),kind,micros,balance,ref,meta?JSON.stringify(meta):null);return balance}
  private debit(userId:string,kind:LedgerKind,micros:number,ref:string,meta?:Record<string,unknown>){const balance=this.balanceMicros(userId)-micros,id=randomUUID();this.db.prepare('INSERT INTO ledger(id,user_id,ts,kind,amount_micros,balance_after_micros,ref,meta) VALUES(?,?,?,?,?,?,?,?)').run(id,userId,Date.now(),kind,-micros,balance,ref,meta?JSON.stringify(meta):null);return balance}
  create(input:PaymentInput){const pack=packageById(input.packId);if(!pack)throw new Error('Неизвестный пакет пополнения');const id=randomUUID();this.db.prepare('INSERT INTO payments(id,user_id,provider,external_id,pack_id,amount_rub,bonus_rub,commission_rub,status,confirmation_url,created_at,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.userId,input.provider,input.externalId??null,pack.id,pack.amountRub,pack.bonusRub,Math.max(0,input.commission??0),'pending',input.confirmationUrl??null,Date.now(),input.note??null);return this.payment(id)!}
  payment(id:string){const record=this.db.prepare('SELECT * FROM payments WHERE id=?').get(id) as Record<string,unknown>|undefined;return record?row(record):null}
  paymentForUser(id:string,userId:string){const record=this.payment(id);return record&&record.userId===userId?record:null}
  byExternal(provider:string,externalId:string){const record=this.db.prepare('SELECT * FROM payments WHERE provider=? AND external_id=?').get(provider,externalId) as Record<string,unknown>|undefined;return record?row(record):null}
  linkExternal(id:string,externalId:string,confirmationUrl?:string){this.db.prepare('UPDATE payments SET external_id=?,confirmation_url=COALESCE(?,confirmation_url) WHERE id=? AND status=\'pending\'').run(externalId,confirmationUrl??null,id);return this.payment(id)}
  fail(id:string,note:string){this.db.prepare("UPDATE payments SET status='failed',note=? WHERE id=? AND status='pending'").run(String(note).slice(0,300),id);return this.payment(id)}
  /** Зачисляет оплату ровно один раз: повторный вебхук того же платежа не меняет баланс. */
  applyEvent(provider:string,event:ProviderEvent){const payment=this.byExternal(provider,event.externalId);if(!payment)return {status:'unknown' as const,paymentId:null,credited:0};
    if(payment.status==='succeeded'||payment.status==='refunded')return {status:'duplicate' as const,paymentId:payment.id,credited:0};
    if(event.status!=='succeeded'){if(event.status==='failed')this.db.prepare("UPDATE payments SET status='failed' WHERE id=? AND status='pending'").run(payment.id);return {status:event.status,paymentId:payment.id,credited:0}}
    const amountRub=typeof event.amountRub==='number'&&event.amountRub>0?event.amountRub:payment.amountRub;
    if(Math.abs(amountRub-payment.amountRub)>0.009)return {status:'mismatch' as const,paymentId:payment.id,credited:0};
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare("UPDATE payments SET status='succeeded',paid_at=?,receipt_url=? WHERE id=? AND status='pending'").run(Date.now(),event.receiptUrl??null,payment.id);
      this.credit(payment.userId,'topup',toMicros(payment.amountRub),payment.id,{provider});
      if(payment.bonusRub>0)this.credit(payment.userId,'bonus',toMicros(payment.bonusRub),payment.id,{provider,pack:payment.packId});
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error}
    return {status:'credited' as const,paymentId:payment.id,credited:payment.amountRub+payment.bonusRub,balanceRub:toRub(this.balanceMicros(payment.userId))}}
  balanceRub(userId:string){return toRub(this.balanceMicros(userId))}
  history(userId:string,limit=50){const records=this.db.prepare('SELECT * FROM ledger WHERE user_id=? ORDER BY ts DESC,rowid DESC LIMIT ?').all(userId,Math.max(1,Math.min(200,limit))) as Record<string,unknown>[];
    return records.map(record=>({id:String(record.id),ts:Number(record.ts),kind:String(record.kind) as LedgerKind,amountRub:toRub(Number(record.amount_micros)),balanceAfterRub:toRub(Number(record.balance_after_micros)),ref:record.ref==null?null:String(record.ref)}))}
  adminAdjust(userId:string,amountRub:number,reason:string){if(!Number.isFinite(amountRub)||amountRub===0)throw new Error('Укажите ненулевую сумму');const magnitude=toMicros(Math.abs(amountRub)),balance=amountRub>0?this.credit(userId,'adjustment',magnitude,'admin',{reason}):this.debit(userId,'adjustment',magnitude,'admin',{reason});return {balanceRub:toRub(balance)}}
  /** Возврат: деньги уходят провайдеру, кошелёк списывает столько, сколько в нём реально есть. */
  refund(id:string,refundId:string,reason:string,meta:Record<string,unknown>={}){const payment=this.payment(id);if(!payment)throw Object.assign(new Error('Платёж не найден'),{status:404});
    if(payment.status==='refunded')return {duplicate:true as const,payment,balanceRub:this.balanceRub(payment.userId)};
    if(payment.status!=='succeeded')throw Object.assign(new Error('Возврат доступен только для оплаченного платежа'),{status:409});
    const credited=toMicros(payment.amountRub+payment.bonusRub),available=this.balanceMicros(payment.userId),debit=Math.min(available,credited);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare("UPDATE payments SET status='refunded',refunded_at=?,refund_id=? WHERE id=?").run(Date.now(),refundId,id);
      if(debit>0)this.debit(payment.userId,'refund',debit,id,{...meta,reason,refundId});
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error}
    return {duplicate:false as const,payment:this.payment(id)!,balanceRub:toRub(this.balanceMicros(payment.userId)),uncoveredRub:toRub(credited-debit)}}
  adminPayments(options:{status?:string;userId?:string;limit?:number}={}){const clauses:string[]=[],values:(string|number)[]=[];
    if(options.status){clauses.push('status=?');values.push(options.status)}
    if(options.userId){clauses.push('user_id=?');values.push(options.userId)}
    const where=clauses.length?' WHERE '+clauses.join(' AND '):'',limit=Math.max(1,Math.min(200,options.limit??100));
    return (this.db.prepare(`SELECT * FROM payments${where} ORDER BY created_at DESC LIMIT ?`).all(...values,limit) as Record<string,unknown>[]).map(row)}
  adminOverview(days=30){const since=Date.now()-Math.max(1,Math.min(days,365))*86_400_000;
    const payments=this.adminPayments({limit:200}),sum=(list:Payment[],pick:(x:Payment)=>number)=>list.reduce((total,item)=>total+pick(item),0);
    const succeeded=payments.filter(item=>item.status==='succeeded'||item.status==='refunded'),refunded=payments.filter(item=>item.status==='refunded');
    const period=payments.filter(item=>item.createdAt>=since);
    return {available:true,days,packages:PACKAGES.map(item=>({...item})),providers:[...new Set(payments.map(item=>item.provider))],
      totals:{topupsRub:sum(succeeded,x=>x.amountRub),bonusRub:sum(succeeded,x=>x.bonusRub),commissionRub:sum(succeeded,x=>x.commission),refundsRub:sum(refunded,x=>x.amountRub),netRub:sum(succeeded,x=>x.amountRub+x.bonusRub)-sum(refunded,x=>x.amountRub),pending:payments.filter(item=>item.status==='pending').length,failed:payments.filter(item=>item.status==='failed').length,refunded:refunded.length,paid:payments.filter(item=>item.status==='succeeded').length},
      period:{payments:period.length,topupsRub:sum(period.filter(x=>x.status==='succeeded'),x=>x.amountRub+ x.bonusRub)},
      wallets:{users:Number((this.db.prepare("SELECT COUNT(DISTINCT user_id) AS users FROM ledger WHERE amount_micros>0").get() as {users:number}).users),balanceRub:toRub(Number((this.db.prepare('SELECT COALESCE(SUM(amount_micros),0) AS total FROM ledger').get() as {total:number}).total))},
      byPack:PACKAGES.map(pack=>({...pack,count:payments.filter(item=>item.packId===pack.id&&(item.status==='succeeded'||item.status==='refunded')).length,amountRub:sum(payments.filter(item=>item.packId===pack.id&&(item.status==='succeeded'||item.status==='refunded')),x=>x.amountRub)}))}}
  publicView(userId:string){return {available:true,balanceRub:this.balanceRub(userId),currency:'RUB',packages:PACKAGES.map(item=>({...item,totalRub:item.amountRub+item.bonusRub})),history:this.history(userId,20)}}
}
