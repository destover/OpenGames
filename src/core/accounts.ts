import providers from './providers.json' with { type: 'json' };
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type EncryptedKey = { iv: string; tag: string; data: string };
type Limits = {daily_allowance:number;remaining_today:number;last_reset_timestamp:number};
type ProviderLimitsCache = {
  provider: string;
  limit: number | null;
  usage: number | null;
  remaining: number | null;
  resetAt: number | null;
  fetchedAt: number;
  error?: string;
  estimated?: boolean;
};

type OgcatHistoryEntry = { at: number; delta: number; balance: number; reason: string; jobId?: string };

type User = {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  openRouterKey?: EncryptedKey;
  createdAt: string;
  displayName?: string;
  role?: 'user' | 'admin';
  disabled?: boolean;
  provider?: string;
  providerKeys?: Record<string, EncryptedKey | EncryptedKey[]>;
  providerModels?: Record<string, string>;
  aiSource?: 'donor' | 'personal';
  limits?: Limits;
  refundedTurnJobs?: string[];
  bonusTurns?: number;
  ogcatBalance: number;
  ogcatEarnedTotal: number;
  ogcatSpentTotal: number;
  ogcatLastEarnedAt?: number;
  ogcatHistory?: OgcatHistoryEntry[];
  providerLimits?: Record<string, ProviderLimitsCache>;
  timezone?: string;
};
type SessionRecord = { userId: string; expiresAt: string };
type ResetRecord = { userId: string; expiresAt: string };
type Database = { users: User[]; tokens: Record<string, SessionRecord>; passwordResets?: Record<string, ResetRecord> };
const currentModel = (provider:string, model:string) => provider==='groq'&&model==='llama-3.3-70b-versatile'?'openai/gpt-oss-120b':model;
export class DailyLimitError extends Error { status=402; code='daily_limit_exhausted'; resetAt:number; constructor(resetAt:number){super('Суточный лимит ходов исчерпан');this.resetAt=resetAt} }
const dayStart=(now:number)=>Math.floor(now/86_400_000)*86_400_000;
export class AccountStore {
  private db: Database;
  private readonly key: Buffer;
  private readonly path: string;
  constructor(path: string, secret = process.env.OPENGAME_SECRET) { if(!secret||secret.length<32||/^(?:replace-with-|change-me|your-secret|example-secret|test-secret)/i.test(secret))throw new Error('OPENGAME_SECRET должен быть случайным значением длиной не менее 32 символов');this.path = path; mkdirSync(dirname(path), { recursive: true, mode:0o700 });chmodSync(dirname(path),0o700);this.key = scryptSync(secret, 'opengame-key', 32);this.db = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { users: [], tokens: {}, passwordResets:{} };const now=Date.now();this.db.tokens=Object.fromEntries(Object.entries(this.db.tokens||{}).filter(([,record])=>typeof record==='object'&&record&&Date.parse(record.expiresAt)>now));this.db.passwordResets=Object.fromEntries(Object.entries(this.db.passwordResets||{}).filter(([,record])=>Date.parse(record.expiresAt)>now));this.persist(); }
  private persist() { writeFileSync(this.path, JSON.stringify(this.db, null, 2),{mode:0o600});chmodSync(this.path,0o600); }
  initializeAdmin(email?:string){const normalized=String(email||'').trim().toLowerCase();if(!normalized)return;const user=this.db.users.find(item=>item.email===normalized);if(user&&user.role!=='admin'){user.role='admin';this.persist()}}
  isAdmin(userId?:string){return !!userId&&this.db.users.some(user=>user.id===userId&&user.role==='admin'&&!user.disabled)}
  adminUsers(){return this.db.users.map(user=>({id:user.id,email:user.email,displayName:user.displayName||'',role:user.role||'user',disabled:!!user.disabled,createdAt:user.createdAt,limits:user.limits?{...user.limits}:undefined}))}
  adminSetDisabled(userId:string,disabled:boolean){const user=this.db.users.find(item=>item.id===userId);if(!user)throw new Error('Пользователь не найден');user.disabled=disabled;if(disabled)for(const [hash,record] of Object.entries(this.db.tokens))if(record.userId===userId)delete this.db.tokens[hash];this.persist();return {id:user.id,disabled:!!user.disabled}}
  adminGrantTurns(userId:string,amount:number){const user=this.db.users.find(item=>item.id===userId);if(!user)throw new Error('Пользователь не найден');if(!Number.isInteger(amount)||amount<1||amount>10000)throw new Error('Количество ходов должно быть от 1 до 10000');const limits=this.daily(userId);if(limits.daily_allowance+amount>10000||limits.remaining_today+amount>10000)throw new Error('Итоговый лимит не может превышать 10000');limits.daily_allowance+=amount;limits.remaining_today+=amount;this.persist();return {...limits}}
  adminSummary(){return {users:this.db.users.length,admins:this.db.users.filter(user=>user.role==='admin'&&!user.disabled).length}}
  private daily(userId:string){const user=this.db.users.find(item=>item.id===userId);if(!user)throw new Error('Пользователь не найден');const today=dayStart(Date.now());if(!user.limits||user.limits.last_reset_timestamp<today){user.limits={daily_allowance:50,remaining_today:50,last_reset_timestamp:today};user.refundedTurnJobs=[];this.persist()}return user.limits}
  dailyLimits(userId:string){const limits=this.daily(userId);return {...limits,resetAt:limits.last_reset_timestamp+86_400_000}}
  reserveTurn(userId:string){const limits=this.daily(userId);if(limits.remaining_today<=0)throw new DailyLimitError(limits.last_reset_timestamp+86_400_000);limits.remaining_today--;this.persist();return limits.last_reset_timestamp}
  refundTurn(userId:string,chargedDay:number,jobId:string){const user=this.db.users.find(item=>item.id===userId);if(!user||!user.limits||user.limits.last_reset_timestamp!==chargedDay||dayStart(Date.now())!==chargedDay||user.refundedTurnJobs?.includes(jobId))return;user.refundedTurnJobs||=[];user.refundedTurnJobs.push(jobId);user.limits.remaining_today=Math.min(user.limits.daily_allowance,user.limits.remaining_today+1);this.persist()}
  private tokenHash(token:string){return createHash('sha256').update(token).digest('hex')}
  private token(userId: string) { const token = randomBytes(32).toString('hex'); this.db.tokens[this.tokenHash(token)] = {userId,expiresAt:new Date(Date.now()+7*24*60*60*1000).toISOString()}; this.persist(); return token; }
  private decrypt(record: EncryptedKey) { const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(record.iv,'hex')); decipher.setAuthTag(Buffer.from(record.tag,'hex')); return Buffer.concat([decipher.update(Buffer.from(record.data,'hex')),decipher.final()]).toString('utf8'); }
  private mask(record: EncryptedKey) { const value=this.decrypt(record), prefix=value.slice(0,value.startsWith('sk-or-v1-')?12:7), suffix=value.slice(-4); return `${prefix}***${suffix}`; }
  private public(user: User) {
    const provider=user.provider||'openrouter', all:Record<string,EncryptedKey[]>={};
    for(const [name,value] of Object.entries(user.providerKeys||{})) all[name]=Array.isArray(value)?value:[value];
    if(user.openRouterKey&&!all.openrouter?.length) all.openrouter=[user.openRouterKey];
    const keyLabelsByProvider=Object.fromEntries(Object.entries(all).map(([name,records])=>[name,records.map(record=>this.mask(record))]));
    const records=all[provider]||[];
    return { id:user.id,email:user.email,createdAt:user.createdAt,role:user.role||'user',hasOpenRouterKey:Boolean(all.openrouter?.length),displayName:user.displayName||'',provider,model:currentModel(provider,user.providerModels?.[provider]||''),modelsByProvider:Object.fromEntries(Object.entries(user.providerModels||{}).map(([name,model])=>[name,currentModel(name,model)])),hasKey:records.length>0,keyLabels:records.map(record=>this.mask(record)),keyLabelsByProvider,aiSource:user.aiSource||'donor',bonusTurns:user.bonusTurns||0,ogcatBalance:user.ogcatBalance||0,ogcatEarnedTotal:user.ogcatEarnedTotal||0,ogcatSpentTotal:user.ogcatSpentTotal||0,timezone:user.timezone };
  }
  register(email: string, password: string) { email = String(email || '').trim().toLowerCase(); if (!email || password.length < 8) throw new Error('Укажите email и пароль не короче 8 символов'); if (this.db.users.some(user => user.email === email)) throw new Error('Пользователь уже зарегистрирован'); const salt = randomBytes(16).toString('hex'); const user: User = { id: randomBytes(16).toString('hex'), email, salt, passwordHash: scryptSync(password, salt, 32).toString('hex'), createdAt: new Date().toISOString(), bonusTurns: 0, ogcatBalance: 0, ogcatEarnedTotal: 0, ogcatSpentTotal: 0, ogcatHistory: [], providerLimits: {} }; this.db.users.push(user); const token = this.token(user.id); return { token, user: this.public(user) }; }
  login(email: string, password: string, timezone?: string) { const user = this.db.users.find(item => item.email === String(email || '').trim().toLowerCase()); if (!user||user.disabled) throw new Error('Неверный email или пароль'); const actual = scryptSync(password, user.salt, 32); if (!timingSafeEqual(actual, Buffer.from(user.passwordHash, 'hex'))) throw new Error('Неверный email или пароль'); if (timezone && typeof timezone === 'string' && /^[A-Za-z_+\-]+(\/[A-Za-z_+\-]+)+$/.test(timezone)) { user.timezone = timezone; } return { token: this.token(user.id), user: this.public(user) }; }
  userByToken(token?: string) { const id=this.idByToken(token),user=this.db.users.find(item=>item.id===id);return user?this.public(user):undefined; }
  idByToken(token?: string) { if(!token)return;const hash=this.tokenHash(token),record=this.db.tokens[hash];if(!record)return;if(Date.parse(record.expiresAt)<=Date.now()){delete this.db.tokens[hash];this.persist();return}return record.userId; }
  revoke(token?:string){if(!token)return;delete this.db.tokens[this.tokenHash(token)];this.persist()}
  createPasswordReset(email:string){const user=this.db.users.find(item=>item.email===String(email||'').trim().toLowerCase());if(!user)return;for(const [hash,record] of Object.entries(this.db.passwordResets||{}))if(record.userId===user.id)delete this.db.passwordResets![hash];const token=randomBytes(32).toString('hex');this.db.passwordResets![this.tokenHash(token)]={userId:user.id,expiresAt:new Date(Date.now()+15*60_000).toISOString()};this.persist();return token}
  discardPasswordReset(token:string){delete this.db.passwordResets?.[this.tokenHash(token)];this.persist()}
  resetPassword(token:string,password:string){if(typeof token!=='string'||!token||typeof password!=='string'||password.length<8)throw new Error('Ссылка недействительна или пароль короче 8 символов');const hash=this.tokenHash(token),record=this.db.passwordResets?.[hash];if(!record||Date.parse(record.expiresAt)<=Date.now()){if(record)delete this.db.passwordResets![hash];this.persist();throw new Error('Ссылка недействительна или устарела')}const user=this.db.users.find(item=>item.id===record.userId);if(!user)throw new Error('Ссылка недействительна или устарела');user.salt=randomBytes(16).toString('hex');user.passwordHash=scryptSync(password,user.salt,32).toString('hex');for(const [sessionHash,session] of Object.entries(this.db.tokens))if(session.userId===user.id)delete this.db.tokens[sessionHash];for(const [resetHash,reset] of Object.entries(this.db.passwordResets||{}))if(reset.userId===user.id)delete this.db.passwordResets![resetHash];this.persist()}
  updateProfile(userId: string, displayName: string) { const user = this.db.users.find(u => u.id === userId)!; user.displayName = String(displayName || '').trim().slice(0,80); this.persist(); return this.public(user); }
  getAiSource(userId:string){return this.db.users.find(u=>u.id===userId)?.aiSource||'donor'}
  setAiSource(userId:string,source:string){if(source!=='donor'&&source!=='personal')throw new Error('Неизвестный сценарист');if(source==='personal'&&!this.getProviders(userId))throw new Error('Сначала добавьте личный API-ключ');const user=this.db.users.find(u=>u.id===userId);if(!user)throw new Error('Пользователь не найден');user.aiSource=source;this.persist();return this.public(user)}
  setProviderKey(userId: string, provider: string, value: string, model = '') {
    if (!Object.hasOwn(providers,provider)) throw new Error('Провайдер не поддерживается');
    if (typeof value !== 'string' || !/^[^\s]{20,512}$/.test(value.trim())) throw new Error('Некорректный ключ');
    const normalized=value.trim(),digest=createHash('sha256').update(normalized).digest('hex');
    const user = this.db.users.find(u => u.id === userId)!;
    const stored=Object.values(user.providerKeys||{}).flatMap(item=>Array.isArray(item)?item:[item]);if(user.openRouterKey)stored.push(user.openRouterKey);
    if(stored.some(record=>createHash('sha256').update(this.decrypt(record)).digest('hex')===digest))throw new Error('Данный ключ уже введён');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
    user.providerKeys ||= {}; const current=user.providerKeys[provider], records:Array<EncryptedKey>=Array.isArray(current)?current:current?[current]:[]; records.push({iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')}); user.providerKeys[provider] = records; user.providerModels ||= {}; if(model)user.providerModels[provider]=String(model).slice(0,120); user.provider = provider;
    this.persist(); return this.public(user);
  }
  setProviderModel(userId: string, provider: string, model: string) {
    if (!Object.hasOwn(providers,provider)) throw new Error('Провайдер не поддерживается');
    const user=this.db.users.find(u=>u.id===userId)!;const raw=user.providerKeys?.[provider],hasKey=(Array.isArray(raw)?raw.length:Boolean(raw))||(provider==='openrouter'&&Boolean(user.openRouterKey));
    if(!hasKey)throw new Error('Сначала добавьте ключ этого провайдера');if(!String(model||'').trim())throw new Error('Выберите модель');
    user.providerModels||={};user.providerModels[provider]=String(model).trim().slice(0,120);user.provider=provider;this.persist();return this.public(user);
  }
  getProvider(userId: string) {
    const user = this.db.users.find(u => u.id === userId); if (!user) return;
    const provider = user.provider || 'openrouter', raw = user.providerKeys?.[provider], record = Array.isArray(raw)?raw[0]:raw;
    if (!record) { const key = provider === 'openrouter' ? this.getOpenRouterKey(userId) : undefined; return key ? {provider,key} : undefined; }
    return {provider,key:this.decrypt(record)};
  }
  getProviders(userId: string) { const user=this.db.users.find(u=>u.id===userId); if(!user)return; const provider=user.provider||'openrouter',raw=user.providerKeys?.[provider],records:Array<EncryptedKey>=Array.isArray(raw)?raw:raw?[raw]:[]; const keys=records.map(record=>this.decrypt(record)); if(!keys.length&&provider==='openrouter'){const legacy=this.getOpenRouterKey(userId);if(legacy)keys.push(legacy)} return keys.length?{provider,keys,model:currentModel(provider,user.providerModels?.[provider]||'')}:undefined; }
  getOpenRouterKey(userId: string) { const record = this.db.users.find(item => item.id === userId)?.openRouterKey; return record ? this.decrypt(record) : undefined; }

  getOgcatBalance(userId: string) { const user=this.db.users.find(u=>u.id===userId); if(!user)throw new Error('Пользователь не найден'); return { balance: user.ogcatBalance||0, earnedTotal: user.ogcatEarnedTotal||0, spentTotal: user.ogcatSpentTotal||0, lastEarnedAt: user.ogcatLastEarnedAt }; }

  addOgcat(userId: string, amount: number, reason: string, jobId?: string) { if(!Number.isInteger(amount)||amount<=0)throw new Error('Некорректное количество OGCAT'); const user=this.db.users.find(u=>u.id===userId); if(!user)throw new Error('Пользователь не найден'); const prevBalance=user.ogcatBalance||0; const newBalance=prevBalance+amount; user.ogcatBalance=newBalance; user.ogcatEarnedTotal=(user.ogcatEarnedTotal||0)+amount; user.ogcatLastEarnedAt=Date.now(); user.ogcatHistory||=[]; user.ogcatHistory.push({ at: Date.now(), delta: amount, balance: newBalance, reason, jobId }); if(user.ogcatHistory.length>200) user.ogcatHistory=user.ogcatHistory.slice(-200); this.persist(); return { balance: newBalance, earnedTotal: user.ogcatEarnedTotal }; }

  convertOgcatToTurns(userId: string, amount: number) { if(!Number.isInteger(amount)||amount<=0)throw new Error('Некорректное количество'); const user=this.db.users.find(u=>u.id===userId); if(!user)throw new Error('Пользователь не найден'); const balance=user.ogcatBalance||0; if(balance<amount)throw new Error('Недостаточно OGCAT'); user.ogcatBalance=balance-amount; user.ogcatSpentTotal=(user.ogcatSpentTotal||0)+amount; user.bonusTurns=(user.bonusTurns||0)+amount; user.ogcatHistory||=[]; user.ogcatHistory.push({ at: Date.now(), delta: -amount, balance: user.ogcatBalance, reason: 'convert_to_bonus_turns' }); this.persist(); return { ogcatBalance: user.ogcatBalance, bonusTurns: user.bonusTurns, spentTotal: user.ogcatSpentTotal }; }

  getOgcatHistory(userId: string, limit=50) { const user=this.db.users.find(u=>u.id===userId); if(!user)throw new Error('Пользователь не найден'); return (user.ogcatHistory||[]).slice(-limit).reverse(); }

  useBonusTurn(userId: string) { const user=this.db.users.find(u=>u.id===userId); if(!user)throw new Error('Пользователь не найден'); const bonus=user.bonusTurns||0; if(bonus<=0)return false; user.bonusTurns=bonus-1; this.persist(); return true; }

  getBonusTurns(userId: string) { const user=this.db.users.find(u=>u.id===userId); if(!user)throw new Error('Пользователь не найден'); return user.bonusTurns||0; }

  getProviderLimits(userId: string) { const user=this.db.users.find(u=>u.id===userId); if(!user)throw new Error('Пользователь не найден'); return user.providerLimits||{}; }

  async refreshProviderLimits(userId: string, provider: string) { const user=this.db.users.find(u=>u.id===userId); if(!user)throw new Error('Пользователь не найden'); const config=this.getProviders(userId); if(!config||config.provider!==provider)throw new Error('Ключ провайдера не найден'); const spec=providers[provider as keyof typeof providers]; let limit=null,usage=null,remaining=null,resetAt=null,error: string|undefined,estimated=false; try { if(provider==='openrouter') { const response=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:'Bearer '+config.keys[0]},signal:AbortSignal.timeout(8000)}); if(response.ok){const data=await response.json() as any; limit=data.data?.limit??null; usage=data.data?.usage??null; remaining=data.data?.limit_remaining??null; resetAt=data.data?.limit_reset??null;} else { error=`HTTP ${response.status}`; } } else { estimated=true; error='Provider does not expose limits API'; } } catch(e) { error=e instanceof Error?e.message:'Request failed'; } user.providerLimits||={}; user.providerLimits[provider]={provider,limit,usage,remaining,resetAt,fetchedAt:Date.now(),error,estimated}; this.persist(); return user.providerLimits[provider]; }

  estimateTurns(userId: string, provider: string, coauthorUsage: any) { const user=this.db.users.find(u=>u.id===userId); if(!user)throw new Error('Пользователь не найден'); const limits=user.providerLimits?.[provider]; const stats=coauthorUsage?.summary?.(30); if(!stats)return { estimatedTurns: 0, confidence: 'low' as const, avgTokens: 0, reason: 'No usage statistics' }; const byProvider=stats.byCoauthor?.find((c: any)=>c.id.includes(provider)||c.name.toLowerCase().includes(provider.toLowerCase())); const avgTokens=byProvider?.avgCompletionTokens??byProvider?.avgPromptTokens??0; if(!avgTokens||avgTokens<=0)return { estimatedTurns: 0, confidence: 'low' as const, avgTokens: 0, reason: 'Insufficient token data' }; let remaining=limits?.remaining??limits?.limit??user.limits?.daily_allowance??50; if(limits?.estimated)remaining=Math.min(remaining, user.limits?.daily_allowance??50); const estimatedTurns=Math.floor(remaining/avgTokens); const sampleSize=byProvider?.calls??0; let confidence: 'high'|'medium'|'low'='low'; if(sampleSize>=50)confidence='high'; else if(sampleSize>=10)confidence='medium'; return { estimatedTurns: Math.max(0, estimatedTurns), confidence, avgTokens: Math.round(avgTokens), sampleSize, isEstimate: limits?.estimated??true }; }
}
