import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';

export const SHARED_ROUTES=['direct','aitunnel','provod','polza','openrouter','other'] as const;
export type SharedRoute=typeof SHARED_ROUTES[number];
export const ROUTE_LABELS:Record<SharedRoute,string>={direct:'Прямой вендор',aitunnel:'AITUNNEL',provod:'PROVOD',polza:'Polza',openrouter:'OpenRouter',other:'Другой'};
export type SharedKeyStatus='active'|'paused';
export type BalanceSnapshot={available:boolean;remainingRub?:number;limitRub?:number;usageRub?:number;resetAt?:string;message?:string;checkedAt:string};
export type SharedKey={id:string;label:string;route:SharedRoute;model:string;keyMask:string;monthlyCapRub:number;status:SharedKeyStatus;note:string;createdAt:number;updatedAt:number;balance:BalanceSnapshot|null};

type Encrypted={iv:string;tag:string;data:string};

export class SharedKeyStore {
  private db:DatabaseSync;private key:Buffer;
  constructor(file:string,secret=process.env.OPENGAME_SECRET){if(!secret||secret.length<32||/^(?:replace-with-|change-me|your-secret|example-secret|test-secret)/i.test(secret))throw new Error('OPENGAME_SECRET должен быть случайным значением длиной не менее 32 символов');mkdirSync(dirname(file),{recursive:true,mode:0o700});this.key=scryptSync(secret,'opengame-shared-key',32);this.db=new DatabaseSync(file);chmodSync(file,0o600);this.db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS shared_keys(id TEXT PRIMARY KEY,label TEXT NOT NULL,route TEXT NOT NULL,model TEXT NOT NULL,iv TEXT NOT NULL,tag TEXT NOT NULL,data TEXT NOT NULL,digest TEXT NOT NULL UNIQUE,monthly_cap_rub REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',note TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,balance TEXT,balance_at INTEGER);
    CREATE INDEX IF NOT EXISTS shared_keys_status ON shared_keys(status,created_at);`)}
  private encrypt(value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return {iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')}}
  private decrypt(record:Encrypted){const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(record.iv,'hex'));decipher.setAuthTag(Buffer.from(record.tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(record.data,'hex')),decipher.final()]).toString('utf8')}
  private mask(value:string){return `${value.slice(0,6)}***${value.slice(-4)}`}
  private view(record:Record<string,any>):SharedKey{return {id:String(record.id),label:String(record.label),route:String(record.route) as SharedRoute,model:String(record.model),keyMask:this.mask(this.decrypt({iv:String(record.iv),tag:String(record.tag),data:String(record.data)})),monthlyCapRub:Number(record.monthly_cap_rub),status:String(record.status) as SharedKeyStatus,note:String(record.note||''),createdAt:Number(record.created_at),updatedAt:Number(record.updated_at),balance:record.balance?JSON.parse(String(record.balance)) as BalanceSnapshot:null}}
  add(input:{label:string;route:string;model:string;key:string;monthlyCapRub?:number;note?:string}){const label=String(input.label||'').trim(),model=String(input.model||'').trim(),key=String(input.key||'').trim();
    if(!label||label.length>60)throw Object.assign(new Error('Укажите название ключа до 60 символов'),{status:400});
    if(!(SHARED_ROUTES as readonly string[]).includes(input.route))throw Object.assign(new Error('Неизвестный маршрут провайдера'),{status:400});
    if(!model||model.length>120)throw Object.assign(new Error('Укажите модель до 120 символов'),{status:400});
    if(key.length<16)throw Object.assign(new Error('Ключ выглядит некорректно: ожидается не менее 16 символов'),{status:400});
    const cap=Number(input.monthlyCapRub??0);if(!Number.isFinite(cap)||cap<0||cap>1_000_000)throw Object.assign(new Error('Месячный лимит должен быть числом от 0 до 1 000 000 ₽'),{status:400});
    const digest=createHash('sha256').update(key).digest('hex');
    if(this.db.prepare('SELECT id FROM shared_keys WHERE digest=?').get(digest))throw Object.assign(new Error('Такой ключ уже добавлен'),{status:409});
    const {iv,tag,data}=this.encrypt(key),id=randomUUID(),now=Date.now();
    this.db.prepare('INSERT INTO shared_keys(id,label,route,model,iv,tag,data,digest,monthly_cap_rub,status,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,label,input.route,model,iv,tag,data,digest,cap,'active',String(input.note||'').slice(0,300),now,now);
    return this.get(id)!}
  get(id:string){const record=this.db.prepare('SELECT * FROM shared_keys WHERE id=?').get(id) as Record<string,any>|undefined;return record?this.view(record):null}
  list(){return (this.db.prepare('SELECT * FROM shared_keys ORDER BY status=\'active\' DESC, created_at DESC').all() as Record<string,any>[]).map(record=>this.view(record))}
  secret(id:string,activeOnly=true){const record=this.db.prepare(`SELECT iv,tag,data FROM shared_keys WHERE id=?${activeOnly?" AND status='active'":''}`).get(id) as Encrypted|undefined;return record?this.decrypt({iv:String(record.iv),tag:String(record.tag),data:String(record.data)}):null}
  update(id:string,patch:{label?:string;route?:string;model?:string;monthlyCapRub?:number;status?:string;note?:string}){const current=this.get(id);if(!current)throw Object.assign(new Error('Ключ не найден'),{status:404});
    const label=patch.label===undefined?current.label:String(patch.label).trim().slice(0,60),model=patch.model===undefined?current.model:String(patch.model).trim().slice(0,120);
    const route=patch.route===undefined?current.route:(String(patch.route) as SharedRoute);if(!(SHARED_ROUTES as readonly string[]).includes(route))throw Object.assign(new Error('Неизвестный маршрут провайдера'),{status:400});
    const status=patch.status===undefined?current.status:(String(patch.status) as SharedKeyStatus);if(!['active','paused'].includes(status))throw Object.assign(new Error('Статус должен быть active или paused'),{status:400});
    const cap=patch.monthlyCapRub===undefined?current.monthlyCapRub:Number(patch.monthlyCapRub);if(!Number.isFinite(cap)||cap<0||cap>1_000_000)throw Object.assign(new Error('Месячный лимит должен быть числом от 0 до 1 000 000 ₽'),{status:400});
    this.db.prepare('UPDATE shared_keys SET label=?,route=?,model=?,monthly_cap_rub=?,status=?,note=?,updated_at=? WHERE id=?').run(label,route,model,cap,status,(patch.note===undefined?current.note:String(patch.note).slice(0,300)),Date.now(),id);
    return this.get(id)!}
  remove(id:string){const result=this.db.prepare('DELETE FROM shared_keys WHERE id=?').run(id);return Number(result.changes)>0}
  recordBalance(id:string,snapshot:BalanceSnapshot){this.db.prepare('UPDATE shared_keys SET balance=?,balance_at=? WHERE id=?').run(JSON.stringify(snapshot),Date.now(),id);return this.get(id)}
  summary(){const list=this.list();return {total:list.length,active:list.filter(item=>item.status==='active').length,paused:list.filter(item=>item.status==='paused').length,checked:list.filter(item=>item.balance?.available).length,low:list.filter(item=>item.balance?.available&&item.monthlyCapRub>0&&(item.balance.remainingRub??0)<item.monthlyCapRub*0.1).length}}
}
