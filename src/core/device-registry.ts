import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const code=()=>randomBytes(5).toString('hex').toUpperCase();
type Pending={device_code_hash:string;name:string;user_code_hash:string;expires_at:number;owner_id:string|null;polled_at:number};
type Device={id:string;owner_id:string;name:string;created_at:number;revoked_at:number|null;last_seen_at:number|null;model:string|null;busy:number;slots:number;completed:number};

export class DeviceRegistry {
  private db:DatabaseSync;
  constructor(file:string){
    mkdirSync(dirname(file),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(file);chmodSync(file,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS donor_pairings(device_code_hash TEXT PRIMARY KEY,user_code_hash TEXT UNIQUE NOT NULL,name TEXT NOT NULL,expires_at INTEGER NOT NULL,owner_id TEXT,polled_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS donor_devices(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,name TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL,revoked_at INTEGER,last_seen_at INTEGER,model TEXT,busy INTEGER NOT NULL DEFAULT 0,slots INTEGER NOT NULL DEFAULT 0,completed INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS donor_devices_owner ON donor_devices(owner_id);`);
  }
  begin(name:unknown){
    if(typeof name!=='string'||name.trim().length<2||name.trim().length>60)throw new Error('Укажите имя устройства от 2 до 60 символов');
    const now=Date.now(),deviceCode=token(),userCode=code();
    this.db.prepare('DELETE FROM donor_pairings WHERE expires_at<?').run(now);
    this.db.prepare('INSERT INTO donor_pairings(device_code_hash,user_code_hash,name,expires_at) VALUES(?,?,?,?)').run(hash(deviceCode),hash(userCode),name.trim(),now+600_000);
    return {deviceCode,userCode,expiresAt:now+600_000,interval:5,verificationUri:'/profile/donors'};
  }
  pairing(userCode:unknown){
    if(typeof userCode!=='string'||!/^[0-9A-F]{10}$/.test(userCode.toUpperCase()))throw new Error('Неверный код привязки');
    const row=this.db.prepare('SELECT name,expires_at,owner_id FROM donor_pairings WHERE user_code_hash=?').get(hash(userCode.toUpperCase())) as {name:string;expires_at:number;owner_id:string|null}|undefined;
    if(!row||row.expires_at<Date.now()||row.owner_id)throw new Error('Код привязки недействителен или использован');
    return {name:row.name,expiresAt:row.expires_at};
  }
  approve(userCode:unknown,ownerId:string){
    const pairing=this.pairing(userCode);
    const count=this.db.prepare('SELECT COUNT(*) AS count FROM donor_devices WHERE owner_id=? AND revoked_at IS NULL').get(ownerId) as {count:number};
    if(count.count>=8)throw new Error('Достигнут лимит устройств');
    this.db.prepare('UPDATE donor_pairings SET owner_id=? WHERE user_code_hash=? AND owner_id IS NULL AND expires_at>?').run(ownerId,hash(String(userCode).toUpperCase()),Date.now());
    return pairing;
  }
  poll(deviceCode:unknown){
    if(typeof deviceCode!=='string'||!/^[A-Za-z0-9_-]{40,64}$/.test(deviceCode))throw new Error('Неверный код устройства');
    const key=hash(deviceCode),now=Date.now();
    const row=this.db.prepare('SELECT * FROM donor_pairings WHERE device_code_hash=?').get(key) as Pending|undefined;
    if(!row||row.expires_at<now)throw new Error('Срок привязки истёк');
    if(now-row.polled_at<5000)return {status:'slow_down',interval:5};
    this.db.prepare('UPDATE donor_pairings SET polled_at=? WHERE device_code_hash=?').run(now,key);
    if(!row.owner_id)return {status:'pending',interval:5};
    const accessToken=token(),deviceId=randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const removed=this.db.prepare('DELETE FROM donor_pairings WHERE device_code_hash=? AND owner_id=?').run(key,row.owner_id);
      if(!removed.changes)throw new Error('Код уже использован');
      this.db.prepare('INSERT INTO donor_devices(id,owner_id,name,token_hash,created_at) VALUES(?,?,?,?,?)').run(deviceId,row.owner_id,row.name,hash(accessToken),now);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error}
    return {status:'approved',deviceId,accessToken};
  }
  authenticate(accessToken:unknown){
    if(typeof accessToken!=='string'||!/^[A-Za-z0-9_-]{40,64}$/.test(accessToken))return;
    const row=this.db.prepare('SELECT * FROM donor_devices WHERE token_hash=? AND revoked_at IS NULL').get(hash(accessToken)) as Device|undefined;
    return row;
  }
  list(ownerId:string){return this.db.prepare('SELECT id,name,created_at AS createdAt,revoked_at AS revokedAt,last_seen_at AS lastSeenAt,model,busy,slots,completed FROM donor_devices WHERE owner_id=? ORDER BY created_at DESC').all(ownerId) as (Device&Record<string,unknown>)[]}
  adminCoauthors(){return this.db.prepare('SELECT id,owner_id,name,created_at AS createdAt,revoked_at AS revokedAt,last_seen_at AS lastSeenAt,model,busy,slots,completed FROM donor_devices ORDER BY created_at DESC').all() as Array<{id:string;owner_id:string;name:string;createdAt:number;revokedAt:number|null;lastSeenAt:number|null;model:string|null;busy:number;slots:number;completed:number}>}
  revoke(ownerId:string,id:string){const result=this.db.prepare('UPDATE donor_devices SET revoked_at=?,busy=0,slots=0 WHERE id=? AND owner_id=? AND revoked_at IS NULL').run(Date.now(),id,ownerId);if(!result.changes)throw new Error('Устройство не найдено');return {ok:true}}
  removeRevoked(ownerId:string,id:string){const result=this.db.prepare('DELETE FROM donor_devices WHERE id=? AND owner_id=? AND revoked_at IS NOT NULL').run(id,ownerId);if(!result.changes)throw new Error('Отозванное устройство не найдено');return {ok:true}}
  revokeSelf(accessToken:unknown){const device=this.authenticate(accessToken);if(!device)throw new Error('Устройство не найдено');this.db.prepare('UPDATE donor_devices SET revoked_at=?,busy=0,slots=0 WHERE id=? AND revoked_at IS NULL').run(Date.now(),device.id);return device.id}
  renameSelf(accessToken:unknown,name:unknown){const device=this.authenticate(accessToken);if(!device)throw new Error('Устройство не найдено');if(typeof name!=='string'||name.trim().length<2||name.trim().length>60)throw new Error('Имя устройства: от 2 до 60 символов');this.db.prepare('UPDATE donor_devices SET name=? WHERE id=?').run(name.trim(),device.id);return {name:name.trim()}}
  heartbeat(id:string,model:string,busy:number,slots:number){this.db.prepare('UPDATE donor_devices SET last_seen_at=?,model=?,busy=?,slots=? WHERE id=? AND revoked_at IS NULL').run(Date.now(),model,busy,slots,id)}
}
