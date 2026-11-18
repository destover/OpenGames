import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';

export const SHARED_ROUTES=['direct','aitunnel','provod','polza','openrouter','other'] as const;
export type SharedRoute=typeof SHARED_ROUTES[number];
export const ROUTE_LABELS:Record<SharedRoute,string>={direct:'DeepSeek',aitunnel:'AITUNNEL',provod:'PROVOD',polza:'Polza',openrouter:'OpenRouter',other:'Другой'};
export type SharedKeyStatus='active'|'paused';
export type BalanceSnapshot={available:boolean;currency?:string;remaining?:number;monthlyRemaining?:number;error?:boolean;message?:string;checkedAt:string};
export type SharedKey={id:string;label:string;route:SharedRoute;model:string;models:string[];keyMask:string;status:SharedKeyStatus;note:string;createdAt:number;updatedAt:number;balance:BalanceSnapshot|null};

type Encrypted={iv:string;tag:string;data:string};

export class SharedKeyStore {
  private db:DatabaseSync;private key:Buffer;
  constructor(file:string,secret=process.env.OPENGAME_SECRET){if(!secret||secret.length<32||/^(?:replace-with-|change-me|your-secret|example-secret|test-secret)/i.test(secret))throw new Error('OPENGAME_SECRET должен быть случайным значением длиной не менее 32 символов');mkdirSync(dirname(file),{recursive:true,mode:0o700});this.key=scryptSync(secret,'opengame-shared-key',32);this.db=new DatabaseSync(file);chmodSync(file,0o600);this.db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS shared_keys(id TEXT PRIMARY KEY,label TEXT NOT NULL,route TEXT NOT NULL,model TEXT NOT NULL,iv TEXT NOT NULL,tag TEXT NOT NULL,data TEXT NOT NULL,digest TEXT NOT NULL UNIQUE,monthly_cap_rub REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',note TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,balance TEXT,balance_at INTEGER);
    CREATE INDEX IF NOT EXISTS shared_keys_status ON shared_keys(status,created_at);`);
    const columns=this.db.prepare('PRAGMA table_info(shared_keys)').all() as {name:string}[];
    if(!columns.some(column=>column.name==='models'))this.db.exec('ALTER TABLE shared_keys ADD COLUMN models TEXT');
  }
  private encrypt(value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return {iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')}}
  private decrypt(record:Encrypted){const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(record.iv,'hex'));decipher.setAuthTag(Buffer.from(record.tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(record.data,'hex')),decipher.final()]).toString('utf8')}
  private mask(value:string){return value.length>=16?`${value.slice(0,6)}***${value.slice(-4)}`:'***'}
  private view(record:Record<string,any>):SharedKey{return {id:String(record.id),label:String(record.label),route:String(record.route) as SharedRoute,model:String(record.model),models:record.models?JSON.parse(String(record.models)):[String(record.model)],keyMask:this.mask(this.decrypt({iv:String(record.iv),tag:String(record.tag),data:String(record.data)})),status:String(record.status) as SharedKeyStatus,note:String(record.note||''),createdAt:Number(record.created_at),updatedAt:Number(record.updated_at),balance:record.balance_at?this.readBalance(record.balance):null}}
  private readBalance(value:unknown):BalanceSnapshot|null{
    const snapshot=JSON.parse(String(value||'null')) as BalanceSnapshot|null;
    return snapshot&&(snapshot.currency||!snapshot.available)?snapshot:null;
  }
  add(input:{label:string;route:string;model:string;models?:string[];key:string;note?:string;balance:BalanceSnapshot}){const label=String(input.label||'').trim(),model=String(input.model||'').trim(),key=String(input.key||'').trim();
    if(!label||label.length>60)throw Object.assign(new Error('Укажите название ключа до 60 символов'),{status:400});
    if(!(SHARED_ROUTES as readonly string[]).includes(input.route))throw Object.assign(new Error('Неизвестный маршрут провайдера'),{status:400});
    if(!model||model.length>120)throw Object.assign(new Error('Укажите модель до 120 символов'),{status:400});
    const models=input.models??[model];
    if(!Array.isArray(models)||!models.length||models.length>50||models.some(item=>typeof item!=='string'||!item.trim()||item.length>120)||new Set(models).size!==models.length||!models.includes(model))throw Object.assign(new Error('Выберите от 1 до 50 моделей и основную модель из списка'),{status:400});
    if(key.length<16)throw Object.assign(new Error('Ключ выглядит некорректно: ожидается не менее 16 символов'),{status:400});
    const digest=createHash('sha256').update(key).digest('hex');
    if(this.db.prepare('SELECT id FROM shared_keys WHERE digest=?').get(digest))throw Object.assign(new Error('Такой ключ уже добавлен'),{status:409});
    const {iv,tag,data}=this.encrypt(key),id=randomUUID(),now=Date.now();
    this.db.prepare('INSERT INTO shared_keys(id,label,route,model,iv,tag,data,digest,status,note,created_at,updated_at,balance,balance_at,models) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,label,input.route,model,iv,tag,data,digest,'active',String(input.note||'').slice(0,300),now,now,JSON.stringify(input.balance),now,JSON.stringify(models));
    return this.get(id)!}
  get(id:string){const record=this.db.prepare('SELECT * FROM shared_keys WHERE id=?').get(id) as Record<string,any>|undefined;return record?this.view(record):null}
  list(){return (this.db.prepare('SELECT * FROM shared_keys ORDER BY status=\'active\' DESC, created_at DESC').all() as Record<string,any>[]).map(record=>this.view(record))}
  secret(id:string,activeOnly=true){const record=this.db.prepare(`SELECT iv,tag,data FROM shared_keys WHERE id=?${activeOnly?" AND status='active'":''}`).get(id) as Encrypted|undefined;return record?this.decrypt({iv:String(record.iv),tag:String(record.tag),data:String(record.data)}):null}
  update(id:string,patch:{label?:string;model?:string;models?:string[];status?:string;note?:string;balance?:BalanceSnapshot}){const current=this.get(id);if(!current)throw Object.assign(new Error('Ключ не найден'),{status:404});
    const label=patch.label===undefined?current.label:String(patch.label).trim().slice(0,60),model=patch.model===undefined?current.model:String(patch.model).trim().slice(0,120);
    const models=patch.models===undefined?current.models:patch.models;
    if(!Array.isArray(models)||!models.length||models.length>50||models.some(item=>typeof item!=='string'||!item.trim()||item.length>120)||new Set(models).size!==models.length||!models.includes(model))throw Object.assign(new Error('Выберите модели и основную модель из списка'),{status:400});
    const status=patch.status===undefined?current.status:(String(patch.status) as SharedKeyStatus);if(!['active','paused'].includes(status))throw Object.assign(new Error('Статус должен быть active или paused'),{status:400});
    const now=Date.now();
    this.db.prepare('UPDATE shared_keys SET label=?,model=?,models=?,status=?,note=?,updated_at=?,balance=COALESCE(?,balance),balance_at=COALESCE(?,balance_at) WHERE id=?').run(label,model,JSON.stringify(models),status,(patch.note===undefined?current.note:String(patch.note).slice(0,300)),now,patch.balance?JSON.stringify(patch.balance):null,patch.balance?now:null,id);
    return this.get(id)!}
  remove(id:string){const result=this.db.prepare('DELETE FROM shared_keys WHERE id=?').run(id);return Number(result.changes)>0}
  recordBalance(id:string,snapshot:BalanceSnapshot){this.db.prepare('UPDATE shared_keys SET balance=?,balance_at=? WHERE id=?').run(JSON.stringify(snapshot),Date.now(),id);return this.get(id)}
  summary(){const list=this.list();return {total:list.length,active:list.filter(item=>item.status==='active').length,paused:list.filter(item=>item.status==='paused').length,checked:list.filter(item=>item.balance?.available).length,low:list.filter(item=>item.balance?.remaining!==undefined&&item.balance.remaining<=0).length}}
}
