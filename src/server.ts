import providers from './core/providers.json' with { type: 'json' };
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { appendFileSync, copyFileSync, mkdirSync, readFileSync as readTextSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { GameRuntime } from './core/runtime.ts';
import { type AIProvider, RemoteAIProvider, AnthropicProvider, FallbackAIProvider, LocalAIProvider, OllamaAIProvider, OpenAIProvider, OpenRouterProvider } from './core/ai.ts';
import { modelInfo, pilotModel, playerProfileLimits, type GenerationSettings } from './core/generation.ts';
import { FeedbackStore, feedbackKinds, feedbackStatuses, feedbackRequestDays, feedbackRequestTypes, type FeedbackFilter, type FeedbackRequestType } from './core/feedback.ts';
import { feedbackMcpAuthorized, serveFeedbackMcp } from './core/feedback-mcp.ts';
import { ModelUsageStore } from './core/model-usage.ts';
import { OAuthLogin, type OAuthProvider } from './core/oauth.ts';
import { AccountStore, DailyLimitError } from './core/accounts.ts';
import { LocalSaveSystem } from './core/save.ts';
import { DonorAIProvider } from './core/donor.ts';
import { DonorPool } from './core/donor-pool.ts';
import { TurnQueue } from './core/turn-queue.ts';
import { DeviceRegistry } from './core/device-registry.ts';
import { ConnectTransport } from './core/connect-transport.ts';
import { CoauthorUsageStore } from './core/coauthor-usage.ts';
import { BillingStore, packageById } from './core/billing.ts';
import { paymentRegistry, PaymentError, type PaymentProviderId } from './core/payments.ts';
import { SharedKeyStore, ROUTE_LABELS, SHARED_ROUTES } from './core/shared-key.ts';
import { balanceState, fetchBalance } from './core/provider-balance.ts';
import { LegalStore, LEGAL_DOCUMENTS } from './core/legal.ts';
import { InfrastructureMonitor } from './core/infrastructure.ts';
import type { Action, GamePackage } from './core/types.ts';
import survival from './games/survival.json' with { type: 'json' };
import detective from './games/detective.json' with { type: 'json' };
import spaceColony from './games/space_colony.json' with { type: 'json' };
import museumNight from './games/museum_night.json' with { type: 'json' };
import marsOutpost from './games/mars_outpost.json' with { type: 'json' };
import jungleExpedition from './games/jungle_expedition.json' with { type: 'json' };
import underwaterStation from './games/underwater_station.json' with { type: 'json' };
import clockworkCity from './games/clockwork_city.json' with { type: 'json' };
import arcticProtocol from './games/arctic_protocol.json' with { type: 'json' };
import emergencyTriage from './games/emergency_triage.json' with { type: 'json' };
import airTrafficBlackout from './games/air_traffic_blackout.json' with { type: 'json' };
import floodCommand from './games/flood_command.json' with { type: 'json' };
import centralBankRun from './games/central_bank_run.json' with { type: 'json' };
import filmProduction from './games/film_production.json' with { type: 'json' };
import orchestraPremiere from './games/orchestra_premiere.json' with { type: 'json' };
import oceanRegatta from './games/ocean_regatta.json' with { type: 'json' };
import SummerRoof from './games/summer_roof.json' with { type: 'json' };
import SummerKites from './games/summer_kites.json' with { type: 'json' };
import SummerCourtyard from './games/summer_courtyard.json' with { type: 'json' };
import AutumnBookmobile from './games/autumn_bookmobile.json' with { type: 'json' };
import AutumnHarvest from './games/autumn_harvest.json' with { type: 'json' };
import AutumnAteliers from './games/autumn_ateliers.json' with { type: 'json' };
import WinterShelter from './games/winter_shelter.json' with { type: 'json' };
import WinterLetters from './games/winter_letters.json' with { type: 'json' };
import WinterAurora from './games/winter_aurora.json' with { type: 'json' };
import SpringBike from './games/spring_bike.json' with { type: 'json' };
import SpringBees from './games/spring_bees.json' with { type: 'json' };
import SpringFountain from './games/spring_fountain.json' with { type: 'json' };
import NightRailYard from './games/night_rail_yard.json' with { type: 'json' };
import ArchiveWaterline from './games/archive_waterline.json' with { type: 'json' };
import GridRepairDispatch from './games/grid_repair_dispatch.json' with { type: 'json' };
import TravellingStage from './games/travelling_stage.json' with { type: 'json' };
import OasisWaterCompact from './games/oasis_water_compact.json' with { type: 'json' };
import SkybridgeCargo from './games/skybridge_cargo.json' with { type: 'json' };
import CoralRestorationLab from './games/coral_restoration_lab.json' with { type: 'json' };
import LandslideExcavation from './games/landslide_excavation.json' with { type: 'json' };
import PolarRadioRelay from './games/polar_radio_relay.json' with { type: 'json' };
import InteractiveExhibit from './games/interactive_exhibit.json' with { type: 'json' };
import WaferReference from './games/wafer_reference.json' with { type: 'json' };
import HearingInterval from './games/hearing_interval.json' with { type: 'json' };
import BakeryLedger from './games/bakery_ledger.json' with { type: 'json' };
import SeedQuarantine from './games/seed_quarantine.json' with { type: 'json' };

const root = dirname(fileURLToPath(import.meta.url));
const envFile = join(root, '..', '.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}
const configuredPublicUrl=process.env.OPENGAME_PUBLIC_URL;let publicOrigin:string|undefined;
if(configuredPublicUrl){let parsed:URL;try{parsed=new URL(configuredPublicUrl)}catch{throw new Error('OPENGAME_PUBLIC_URL должен быть корректным URL')}if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('OPENGAME_PUBLIC_URL должен быть публичным HTTP(S) URL без учётных данных');if(parsed.protocol==='https:'&&process.env.OPENGAME_SECURE_COOKIE!=='1')throw new Error('Для HTTPS в OPENGAME_PUBLIC_URL установите OPENGAME_SECURE_COOKIE=1');publicOrigin=parsed.origin}
const games = new Map<string,GamePackage>([[survival.manifest.id, survival], [detective.manifest.id, detective], [spaceColony.manifest.id, spaceColony], [museumNight.manifest.id, museumNight], [marsOutpost.manifest.id, marsOutpost], [jungleExpedition.manifest.id, jungleExpedition], [underwaterStation.manifest.id, underwaterStation], [clockworkCity.manifest.id, clockworkCity], [arcticProtocol.manifest.id, arcticProtocol], [emergencyTriage.manifest.id, emergencyTriage], [airTrafficBlackout.manifest.id, airTrafficBlackout], [floodCommand.manifest.id, floodCommand], [centralBankRun.manifest.id, centralBankRun], [filmProduction.manifest.id, filmProduction], [orchestraPremiere.manifest.id, orchestraPremiere], [oceanRegatta.manifest.id, oceanRegatta], [SummerRoof.manifest.id, SummerRoof], [SummerKites.manifest.id, SummerKites], [SummerCourtyard.manifest.id, SummerCourtyard], [AutumnBookmobile.manifest.id, AutumnBookmobile], [AutumnHarvest.manifest.id, AutumnHarvest], [AutumnAteliers.manifest.id, AutumnAteliers], [WinterShelter.manifest.id, WinterShelter], [WinterLetters.manifest.id, WinterLetters], [WinterAurora.manifest.id, WinterAurora], [SpringBike.manifest.id, SpringBike], [SpringBees.manifest.id, SpringBees], [SpringFountain.manifest.id, SpringFountain], [NightRailYard.manifest.id,NightRailYard], [ArchiveWaterline.manifest.id,ArchiveWaterline], [GridRepairDispatch.manifest.id,GridRepairDispatch], [TravellingStage.manifest.id,TravellingStage], [OasisWaterCompact.manifest.id,OasisWaterCompact], [SkybridgeCargo.manifest.id,SkybridgeCargo], [CoralRestorationLab.manifest.id,CoralRestorationLab], [LandslideExcavation.manifest.id,LandslideExcavation], [PolarRadioRelay.manifest.id,PolarRadioRelay], [InteractiveExhibit.manifest.id,InteractiveExhibit], [WaferReference.manifest.id,WaferReference], [HearingInterval.manifest.id,HearingInterval], [BakeryLedger.manifest.id,BakeryLedger], [SeedQuarantine.manifest.id,SeedQuarantine]] as unknown as [string,GamePackage][]);
const openRouterKeys = [process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY_BACKUP].filter((key): key is string => Boolean(key));
const aiMode = process.env.OPENGAME_DONOR === '1' ? 'donor' : process.env.OPENGAME_OLLAMA === '1' ? 'ollama' : process.env.OPENGAME_LOCAL_AI === '1' ? 'local' : (openRouterKeys.length ? 'openrouter' : process.env.OPENAI_API_KEY ? 'openai' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'local');
const donorPool=aiMode==='donor'?new DonorPool():undefined;
const baseProvider = aiMode === 'donor' ? new DonorAIProvider(donorPool!.first) : aiMode === 'ollama' ? new OllamaAIProvider() : aiMode === 'openrouter' ? new OpenRouterProvider(openRouterKeys, process.env.OPENROUTER_MODEL) : aiMode === 'openai' ? new OpenAIProvider(process.env.OPENAI_API_KEY!, process.env.OPENAI_MODEL) : aiMode === 'anthropic' ? new AnthropicProvider(process.env.ANTHROPIC_API_KEY!, process.env.ANTHROPIC_MODEL) : new LocalAIProvider();
const provider = aiMode === 'donor' ? baseProvider : new FallbackAIProvider(baseProvider, new LocalAIProvider());
const runtime = new GameRuntime(games, provider, new LocalSaveSystem(join(root, '..', 'data', 'saves')), join(root,'..','data','game-publication.json'));
const accounts = new AccountStore(join(root, '..', 'data', 'accounts.json'));
const oauth = new OAuthLogin(accounts, publicOrigin);
const pilotKey = process.env.OPENGAME_PILOT_OPENROUTER_KEY;
const modelUsage = new ModelUsageStore(join(root, '..', 'data', 'model-usage.sqlite'));
const ollamaModel = process.env.OLLAMA_MODEL || 'qwen3.5:9b';

function resolveWriter(userId: string, settings: GenerationSettings) {
  if (settings.provider && settings.model) {
    const config = accounts.getProviders(userId, settings.provider);
    if (!config) throw Object.assign(new Error('Добавьте ключ выбранного провайдера'), {status:403});
    return { ...config, model:settings.model };
  }
  if (aiMode === 'donor' && accounts.getAiSource(userId) === 'donor') return {provider:'donor',model:donorPool!.model,keys:[]};
  if (aiMode === 'ollama' && accounts.getAiSource(userId) !== 'personal') {
    return pilotKey ? {provider:'openrouter',model:pilotModel,keys:[pilotKey]} : {provider:'ollama',model:ollamaModel,keys:[]};
  }
  const config = accounts.getProviders(userId);
  if (config) return { ...config, model: config.model || providers[config.provider as keyof typeof providers].defaultModel };
  if (pilotKey) return {provider:'openrouter',model:pilotModel,keys:[pilotKey]};
}

function generationSettings(userId: string, value: any): GenerationSettings {
  const bad = () => Object.assign(new Error('Некорректные настройки генерации'), {status:400});
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad();
  const { provider, model, length, initiative, pace, temperature, topP, narration } = value;
  let playerProfile: GenerationSettings['playerProfile'];
  if (value.playerProfile !== undefined) {
    if (!value.playerProfile || typeof value.playerProfile !== 'object' || Array.isArray(value.playerProfile)) throw bad();
    playerProfile = {};
    for (const field of Object.keys(playerProfileLimits) as Array<keyof typeof playerProfileLimits>) {
      const entry = value.playerProfile[field];
      if (entry === undefined) continue;
      if (typeof entry !== 'string' || entry.trim().length > playerProfileLimits[field]) throw bad();
      if (entry.trim()) playerProfile[field] = entry.trim();
    }
  }
  if (provider || model) {
    if (typeof provider !== 'string' || typeof model !== 'string' || !Object.hasOwn(providers, provider) ||
      !modelInfo(provider, model) || !accounts.getProviders(userId, provider)) throw bad();
  }
  if (length !== undefined && !['short','standard','long'].includes(length) ||
      initiative !== undefined && !['low','normal','high'].includes(initiative) ||
      pace !== undefined && !['slow','normal','fast'].includes(pace) ||
      narration !== undefined && !['characters','shared'].includes(narration) ||
      [temperature, topP].some(n => n !== undefined && (!Number.isFinite(n) || n < 0 || n > 1))) throw bad();
  return { provider:provider || undefined, model:model || undefined, length, initiative, pace, temperature, topP, playerProfile, narration };
}
accounts.initializeAdmin(process.env.OPENGAME_ADMIN_EMAIL);
const adminData=join(root,'..','data','admin');mkdirSync(adminData,{recursive:true,mode:0o700});const adminAudit=join(adminData,'audit.jsonl');
const feedback = new FeedbackStore(join(root,'..','data','feedback.sqlite'));
const privateFeedback = {'Cache-Control':'no-store'};
function feedbackFilters(query: URLSearchParams): FeedbackFilter {
  const status = query.get('status') as FeedbackFilter['status'] ?? undefined;
  const kind = query.get('kind') as FeedbackFilter['kind'] ?? undefined;
  const requestType=query.get('requestType') as FeedbackRequestType|null;
  const gameId = query.get('gameId') || undefined;
  const number = (name: string, fallback: number, max: number) => {
    const value = Number(query.get(name) ?? fallback);
    return Number.isSafeInteger(value) && value>=0 ? Math.min(value,max) : fallback;
  };
  return {status:status && feedbackStatuses.includes(status)?status:undefined,
    kind:kind && feedbackKinds.includes(kind)?kind:undefined,
    requestType:requestType&&feedbackRequestTypes.includes(requestType)?requestType:undefined,
    gameId:gameId?.slice(0,80),offset:number('offset',0,1_000_000),limit:number('limit',20,100)};
}
const coauthorUsage=new CoauthorUsageStore(join(root,'..','data','coauthor-usage.sqlite'));
const billing=new BillingStore(join(root,'..','data','billing.sqlite'));
const sharedKeys=new SharedKeyStore(join(root,'..','data','shared-keys.sqlite'));
const legal=new LegalStore(join(root,'..','data','legal.json'));
const infrastructure=new InfrastructureMonitor({releasesDir:join(root,'..','..','releases'),dataDir:join(root,'..','data'),port:Number(process.env.PORT||3000),publicUrl:configuredPublicUrl,units:String(process.env.OPENGAME_ADMIN_UNITS||'opengames,nginx').split(',').map(item=>item.trim()).filter(Boolean),games:runtime.listGames().length,donor:async()=>{const health=donorPool?await donorPool.health():undefined;return {connected:Boolean(health?.connected),devices:donorPool?.size||0}},legal:()=>({terms:legal.complete('terms'),privacy:legal.complete('privacy')}),journalLines:200});
const payments=paymentRegistry(process.env,id=>accounts.getPaymentCredentials(id));
function audit(actor:string,action:string,target:string,details:Record<string,unknown>={}){appendFileSync(adminAudit,JSON.stringify({at:new Date().toISOString(),actor,action,target,details})+'\n',{mode:0o600});}
const deviceRegistry=aiMode==='donor'?new DeviceRegistry(join(root,'..','data','donor-devices.sqlite')):undefined;
let queue:TurnQueue|undefined,connectTransport:ConnectTransport|undefined;
const smtp=process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASSWORD?nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||465),secure:process.env.SMTP_SECURE!=='0',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}}):null;
let sendingFeedbackEmails=false;
async function notifyFeedbackAdministrator(){
  if(!smtp||sendingFeedbackEmails)return;
  const eligible=accounts.adminUsers().filter(user=>!user.disabled&&user.role==='admin'&&user.email);
  const feedbackAdministrator=process.env.OPENGAME_ADMIN_EMAIL?.trim()||(eligible.length===1?eligible[0].email:undefined);
  if(!feedbackAdministrator)return;
  sendingFeedbackEmails=true;
  try{
    for(const request of feedback.pendingRequestEmails()){
      const title=request.type==='account_deletion'?'Удаление аккаунта и данных':'Возврат средств';
      const link=publicOrigin?publicOrigin+'/admin#feedback?ticket='+request.id:undefined;
      let sent=false;
      try{
        const result=await smtp.sendMail({
          from:`OpenGames <${process.env.SMTP_USER}>`,to:feedbackAdministrator,
          subject:'OpenGames · '+title,
          messageId:`<feedback-${request.id}@${publicOrigin?new URL(publicOrigin).hostname:'opengames.local'}>`,
          text:[`Новая заявка: ${title}`,`Номер: ${request.id}`,link||'Откройте раздел «Обратная связь» в админ-панели.'].join('\n')
        });
        sent=result.accepted.length>0;
      }catch{}
      feedback.markRequestEmail(request.id,request.attempts,sent);
    }
  }catch{
    console.error('Не удалось обработать очередь почты по обращениям');
  }finally{
    sendingFeedbackEmails=false;
  }
}
if(smtp){
  setInterval(()=>void notifyFeedbackAdministrator(),30_000).unref();
  void notifyFeedbackAdministrator();
}
const json = (value: unknown) => JSON.stringify(value);
const noIndexHeaders={'X-Robots-Tag':'noindex, nofollow, noarchive, nosnippet','Cache-Control':'no-store'};
const legalDocs=new Map(LEGAL_DOCUMENTS.map(doc=>[doc.route,doc]));
const securityHeaders={'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cross-Origin-Opener-Policy':'same-origin','Accept-CH':'Sec-CH-UA-Platform'};
const connectDownloads=[
  {id:'macos-desktop',platform:'macos',kind:'desktop',file:'opengames-connect-0.1.7-macos-arm64.dmg',icon:'connect-macos.svg'},
  {id:'macos-cli',platform:'macos',kind:'cli',file:'opengames-connect-cli-0.1.6-macos-arm64.zip',icon:'connect-terminal.svg'},
  {id:'windows-desktop',platform:'windows',kind:'desktop',file:'opengames-connect-0.1.7-windows-x64.exe',icon:'connect-windows.svg'},
  {id:'windows-cli',platform:'windows',kind:'cli',file:'opengames-connect-cli-0.1.6-windows-x64.zip',icon:'connect-terminal.svg'}
];
function browserPlatform(req:import('node:http').IncomingMessage){const hint=String(req.headers['sec-ch-ua-platform']||'').replace(/"/g,'').toLowerCase(),ua=String(req.headers['user-agent']||'').toLowerCase();if(/iphone|ipad|ipod|android|mobile/.test(ua))return null;if(hint==='macos'||(!hint&&/(macintosh|mac os x)/.test(ua)))return 'macos';if(hint==='windows'||(!hint&&ua.includes('windows')))return 'windows';return null}
const loginAttempts=new Map<string,{count:number;resetAt:number}>(),resetAttempts=new Map<string,{count:number;resetAt:number}>(),sessionCookie='opengame_session';
const donorAttempts=new Map<string,{count:number;resetAt:number}>();
const topupAttempts=new Map<string,{count:number;resetAt:number}>();
function topupAllowed(userId:string){const now=Date.now(),item=topupAttempts.get(userId);if(!item||item.resetAt<=now){topupAttempts.set(userId,{count:1,resetAt:now+60*60_000});return true}if(item.count>=3)return false;item.count++;return true}
async function body(req: import('node:http').IncomingMessage) { let data = ''; for await (const chunk of req){data+=chunk;if(data.length>1_000_000)throw new Error('Запрос слишком большой')} return data ? JSON.parse(data) : {}; }
async function rawBody(req: import('node:http').IncomingMessage) { let data = ''; for await (const chunk of req){data+=chunk;if(data.length>256_000)throw new Error('Запрос слишком большой')} return data; }
function cookie(req:import('node:http').IncomingMessage,name:string){return req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)}
function sessionToken(req:import('node:http').IncomingMessage){return cookie(req,sessionCookie)}
function authId(req: import('node:http').IncomingMessage) { return accounts.idByToken(sessionToken(req)); }
function sessionHeader(token:string,maxAge=604800){return `${sessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.OPENGAME_SECURE_COOKIE==='1'?'; Secure':''}`}
function rateKey(req:import('node:http').IncomingMessage){const peer=req.socket.remoteAddress||'local';if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer))return peer;const real=String(req.headers['x-real-ip']||'').trim(),forwarded=String(req.headers['x-forwarded-for']||'').split(',').at(-1)?.trim();return isIP(real)?real:forwarded&&isIP(forwarded)?forwarded:peer}
const registrationWindow=15*60_000;
const registrationAttempts:{ip:string;at:number}[]=[];
function registrationRetryAfter(ip:string){
  const now=Date.now();
  while(registrationAttempts.length&&registrationAttempts[0].at<=now-registrationWindow)registrationAttempts.shift();
  const personal=registrationAttempts.filter(attempt=>attempt.ip===ip);
  const blockedSince=Math.max(personal.length>=5?personal[0].at:0,registrationAttempts.length>=60?registrationAttempts[0].at:0);
  if(blockedSince)return Math.max(1,Math.ceil((blockedSince+registrationWindow-now)/1000));
  registrationAttempts.push({ip,at:now});
  return 0;
}
function loginBlocked(key:string){const item=loginAttempts.get(key);if(!item)return false;if(item.resetAt<=Date.now()){loginAttempts.delete(key);return false}return item.count>=5}
function loginFailed(key:string){const item=loginAttempts.get(key),now=Date.now();loginAttempts.set(key,!item||item.resetAt<=now?{count:1,resetAt:now+15*60_000}:{count:item.count+1,resetAt:item.resetAt})}
function resetAllowed(key:string){const now=Date.now(),item=resetAttempts.get(key);if(!item||item.resetAt<=now){resetAttempts.set(key,{count:1,resetAt:now+15*60_000});return true}if(item.count>=3)return false;item.count++;return true}
function donorAllowed(key:string,limit:number){const now=Date.now(),item=donorAttempts.get(key);if(!item||item.resetAt<=now){donorAttempts.set(key,{count:1,resetAt:now+15*60_000});return true}if(item.count>=limit)return false;item.count++;return true}
function send(res: import('node:http').ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) { res.writeHead(status, { ...securityHeaders,'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(json(value)); }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/mcp/feedback') {
      if (req.headers.origin && req.headers.origin !== publicOrigin) return send(res,403,{error:'Origin forbidden'},privateFeedback);
      if (!feedbackMcpAuthorized(req.headers.authorization)) {
        return send(res,401,{error:'Bearer token required'},{...privateFeedback,'WWW-Authenticate':'Bearer'});
      }
      res.setHeader('Cache-Control','no-store');
      return await serveFeedbackMcp(feedback,req,res,req.method==='POST'?await body(req):undefined);
    }
    if(req.method==='GET'&&url.pathname==='/admin'){const actor=authId(req);if(!actor)return send(res,401,{error:'Требуется вход'});if(!accounts.isAdmin(actor))return send(res,403,{error:'Недостаточно прав'});const html=await readFile(join(root,'..','web','admin.html'));res.writeHead(200,{...securityHeaders,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return}
    if(req.method==='GET'&&url.pathname==='/admin.js'){const data=await readFile(join(root,'..','web','admin.js'));res.writeHead(200,{...securityHeaders,'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(data);return}
    if(req.method==='GET'&&url.pathname==='/admin.css'){const data=await readFile(join(root,'..','web','admin.css'));res.writeHead(200,{...securityHeaders,'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-store'});res.end(data);return}
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const asset=url.pathname.slice('/assets/'.length);
      const types:Record<string,string>={svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',wav:'audio/wav',ogg:'audio/ogg',mp3:'audio/mpeg',m4a:'audio/mp4',webp:'image/webp'};
      const extension=asset.split('.').at(-1)?.toLowerCase()||'';
      const type=Object.hasOwn(types,extension)?types[extension]:undefined;
      const missing=()=>send(res,404,{error:'Файл не найден'});
      if(!type||!(/^[a-zA-Z0-9._/-]+$/).test(asset)||asset.split('/').some(part=>!part||part.startsWith('.')))return missing();
      const directory=await realpath(join(root,'..','web','assets'));
      const requested=join(directory,asset);
      const file=await realpath(requested).catch(()=>null);
      if(file!==requested||!(await stat(file)).isFile())return missing();
      const data=await readFile(file);
      res.writeHead(200,{...securityHeaders,'Content-Type':type,'Cache-Control':'public, max-age=86400'});res.end(data);return;
    }
    if (req.method==='GET'&&url.pathname==='/api/donor/downloads'){const platform=browserPlatform(req);return send(res,200,{platform,downloads:connectDownloads.map(({file,...item})=>({...item,url:'/downloads/'+file,recommended:item.platform===platform}))},{'Cache-Control':'no-store','Vary':'User-Agent, Sec-CH-UA-Platform'})}
    if ((req.method==='GET'||req.method==='HEAD')&&url.pathname.startsWith('/downloads/')){const file=url.pathname.slice('/downloads/'.length);if(!connectDownloads.some(item=>item.file===file))return send(res,404,{error:'Файл не найден'});const path=join(root,'..','web','downloads',file),size=(await stat(path)).size;res.writeHead(200,{...securityHeaders,'Content-Type':file.endsWith('.dmg')?'application/x-apple-diskimage':file.endsWith('.exe')?'application/vnd.microsoft.portable-executable':'application/zip','Content-Length':String(size),'Content-Disposition':`attachment; filename="${file}"`,'Cache-Control':'public, max-age=86400, immutable'});if(req.method==='HEAD')res.end();else createReadStream(path).pipe(res);return}
    if (req.method === 'GET' && ['/app.js','/style.css','/redesign.css','/ui.json'].includes(url.pathname)) { const data = await readFile(join(root, '..', 'web', url.pathname.slice(1))); res.writeHead(200, {...securityHeaders,'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'application/json', 'Cache-Control':'no-store'}); res.end(data); return; }
    if((req.method==='GET'||req.method==='HEAD')&&legalDocs.has(url.pathname)){const doc=legalDocs.get(url.pathname)!,isAdmin=accounts.isAdmin(authId(req)),template=await readFile(join(root,'..','web','legal',doc.template),'utf8'),rendered=legal.render(template,doc.id);
      if(!rendered.published&&!isAdmin){res.writeHead(503,{...securityHeaders,...noIndexHeaders,'Content-Type':'text/html; charset=utf-8','Retry-After':'3600'});if(req.method==='HEAD')res.end();else res.end(legal.unpublishedPage(doc.title));return}
      const html=rendered.published?rendered.html.replace(/<div class="notice">[\s\S]*?<\/div>\s*/,''):rendered.html;
      res.writeHead(200,{...securityHeaders,...noIndexHeaders,'Content-Type':'text/html; charset=utf-8'});if(req.method==='HEAD')res.end();else res.end(html);return}
    if((req.method==='GET'||req.method==='HEAD')&&url.pathname==='/robots.txt'){const text=await readFile(join(root,'..','web','robots.txt'),'utf8');res.writeHead(200,{...securityHeaders,'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=3600'});if(req.method==='HEAD')res.end();else res.end(text);return}
    if (req.method === 'GET' && url.pathname === '/') { const html = await readFile(join(root, '..', 'web', 'index.html'), 'utf8'); res.writeHead(200, { ...securityHeaders,'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return; }
    if (req.method === 'GET' && url.pathname === '/api/ai/providers') return send(res,200,providers);
    if (req.method === 'GET' && url.pathname === '/api/health') {const donor=donorPool?await donorPool.health():undefined,ok=donor?donor.connected:true;return send(res,ok?200:503,{ok,games:runtime.listGames().length,provider:aiMode,aiConnected:ok})}
    const webhookMatch=url.pathname.match(/^\/api\/payments\/webhook\/(yookassa|enot)$/);
    if(webhookMatch&&req.method==='POST'){
      const provider=payments.byId(webhookMatch[1])!;
      if(!provider.configured)return send(res,503,{error:'Провайдер не настроен'});
      const raw=await rawBody(req);
      if(!provider.verify({raw,ip:rateKey(req),headers:req.headers as Record<string,string|undefined>})){
        return send(res,403,{error:'Уведомление не прошло проверку'});
      }
      const id=provider.notificationId(raw);
      if(!id)return send(res,400,{error:'Уведомление не распознано'});
      const payment=billing.byExternal(provider.id,id);
      if(!payment)return send(res,404,{error:'Платёж не найден'});
      if(payment.status!=='pending')return send(res,200,{ok:true,status:'duplicate'});
      const event=await provider.status(id);
      if(event.externalId!==id)return send(res,409,{error:'Идентификатор платежа не совпадает'});
      const result=billing.applyEvent(provider.id,event);
      if(result.status==='mismatch')return send(res,409,{error:'Реквизиты платежа не совпадают'});
      audit('payment:'+provider.id,'payment.webhook',payment.id,{status:result.status});
      return send(res,200,{ok:true,status:result.status});
    }
    if(url.pathname.startsWith('/api/admin/')){const actor=authId(req);if(!actor)return send(res,401,{error:'Требуется вход'});if(!accounts.isAdmin(actor))return send(res,403,{error:'Недостаточно прав'});if(!['GET','HEAD'].includes(req.method||'')&&req.headers['x-admin-confirm']!=='confirmed')return send(res,403,{error:'Требуется подтверждение действия'});
      if(req.method==='GET'&&url.pathname==='/api/admin/overview')return send(res,200,{...accounts.adminSummary(),games:runtime.listGames().length,sessions:runtime.adminSessions().length,turns:runtime.adminSessions().reduce((n,s)=>n+s.turns.length,0),provider:aiMode,health:'ok',updatedAt:new Date().toISOString()});
      if (req.method === 'GET' && url.pathname === '/api/admin/feedback') {
        return send(res,200,feedback.list(feedbackFilters(url.searchParams)),privateFeedback);
      }
      const adminFeedback = url.pathname.match(/^\/api\/admin\/feedback\/([0-9a-f-]{36})$/);
      if (adminFeedback) {
        const id = adminFeedback[1];
        if (req.method==='GET') return send(res,200,feedback.get(id),privateFeedback);
        if (req.method==='POST') {
          const ticket = feedback.reply(id,(await body(req)).text);
          audit(actor,'feedback.reply',id);
          return send(res,200,ticket,privateFeedback);
        }
        if (req.method==='PUT') {
          const ticket = feedback.setStatus(id,(await body(req)).status);
          audit(actor,'feedback.status',id,{status:ticket.status});
          return send(res,200,ticket,privateFeedback);
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/oauth') {
        return send(res,200,oauth.adminView(),{'Cache-Control':'no-store'});
      }
      const oauthAdmin = url.pathname.match(/^\/api\/admin\/oauth\/(google|yandex|vk)$/);
      if (req.method === 'PUT' && oauthAdmin) {
        const provider = oauthAdmin[1] as OAuthProvider;
        oauth.update(provider,await body(req));
        audit(actor,'oauth.update',provider,{enabled:oauth.available().includes(provider)});
        return send(res,200,oauth.adminView(),{'Cache-Control':'no-store'});
      }
      if(url.pathname==='/api/admin/model-limits'){
        if(req.method==='GET'){
          const models=Object.entries(providers).flatMap(([provider,spec])=>spec.models.map(model=>({
            provider,model:model.id,name:model.name,...modelUsage.dailyLimit(provider,model.id)
          })));
          if(aiMode==='ollama')models.unshift({provider:'ollama',model:ollamaModel,name:ollamaModel,...modelUsage.dailyLimit('ollama',ollamaModel)});
          const report=modelUsage.dailyReport();
          return send(res,200,{resetAt:report.resetAt,models:models.map(item=>({
            ...item,usage:report.byModel[item.provider+'/'+item.model]??null
          }))});
        }
        if(req.method==='PUT'){
          const {provider,model,limit}=await body(req);
          const supported=typeof provider==='string'&&typeof model==='string'&&(
            Object.hasOwn(providers,provider)&&modelInfo(provider,model)||provider==='ollama'&&aiMode==='ollama'&&model===ollamaModel
          );
          if(!supported||limit!==null&&(!Number.isSafeInteger(limit)||limit<0))return send(res,400,{error:'Укажите модель и целый неотрицательный лимит'});
          const previous=modelUsage.dailyLimit(provider,model),updated=modelUsage.setDailyLimit(provider,model,limit);
          audit(actor,'model.limit',provider+'/'+model,{previous:previous.limit,limit:updated.limit,override:updated.override});
          return send(res,200,updated);
        }
      }
      if(req.method==='GET'&&url.pathname==='/api/admin/users')return send(res,200,accounts.adminUsers());
      if(req.method==='GET'&&url.pathname==='/api/admin/packages/popular')return send(res,200,runtime.listPopularGames(true));
      if(req.method==='PATCH'&&/^\/api\/admin\/packages\/[a-z0-9_-]+\/publication$/i.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/')[4]),data=await body(req),reason=String(data.reason||'').trim();if(typeof data.published!=='boolean'||!reason||reason.length>300)return send(res,400,{error:'Укажите статус публикации и причину (до 300 символов)'});const previous=runtime.isPublished(id),result=runtime.setPublished(id,data.published);audit(actor,data.published?'game.publish':'game.unpublish',id,{previous,published:result.published,reason});return send(res,200,result)}
      if(req.method==='GET'&&url.pathname==='/api/admin/packages')return send(res,200,runtime.listGames(true).map(item=>{const full=runtime.gamePackage(item.manifest.id)!;return {...item,published:runtime.isPublished(item.manifest.id),package:full}}));
      if(req.method==='PUT'&&/^\/api\/admin\/packages\/[^/]+$/.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/')[4]);if(!/^[a-z0-9_-]+$/i.test(id))return send(res,400,{error:'Некорректный ID игры'});const data=await body(req),game=data.package;if(!game||game.manifest?.id!==id)return send(res,400,{error:'ID пакета не совпадает'});const path=join(root,'games',id+'.json');runtime.validateGamePackageUpdate(id,game);copyFileSync(path,join(adminData,`${id}-${Date.now()}.json`));const temp=path+'.tmp';writeFileSync(temp,JSON.stringify(game,null,2));renameSync(temp,path);runtime.replaceGamePackage(id,game);audit(actor,'package.update',id,{reason:String(data.reason||'').slice(0,300),version:game.manifest.version});return send(res,200,{ok:true,game:runtime.listGames(true).find(item=>item.manifest.id===id)})}
      if(req.method==='POST'&&/^\/api\/admin\/packages\/[a-z0-9_-]+\/rollback$/i.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/')[4]);if(!/^[a-z0-9_-]+$/i.test(id))return send(res,400,{error:'Некорректный ID игры'});const data=await body(req),name=String(data.backup||'');if(!new RegExp('^'+id+'-[0-9]+\\.json$').test(name))return send(res,400,{error:'Некорректная резервная копия'});const file=join(adminData,name),game=JSON.parse(readTextSync(file,'utf8'));runtime.validateGamePackageUpdate(id,game);const path=join(root,'games',id+'.json');copyFileSync(path,join(adminData,`${id}-${Date.now()}.json`));const temp=path+'.tmp';writeFileSync(temp,JSON.stringify(game,null,2));renameSync(temp,path);runtime.replaceGamePackage(id,game);audit(actor,'package.rollback',id,{backup:name,reason:String(data.reason||'').slice(0,300)});return send(res,200,{ok:true})}
      if(req.method==='PATCH'&&/^\/api\/admin\/users\/[^/]+\/status$/.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/')[4]),data=await body(req),result=accounts.adminSetDisabled(id,Boolean(data.disabled));audit(actor,'user.status',id,{disabled:result.disabled});return send(res,200,result)}
      if(req.method==='POST'&&/^\/api\/admin\/users\/[^/]+\/allowance$/.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/')[4]),data=await body(req),limits=accounts.adminGrantTurns(id,Number(data.allowance));audit(actor,'user.turns.grant',id,{granted:Number(data.allowance),allowance:limits.daily_allowance,remaining:limits.remaining_today,reason:String(data.reason||'').slice(0,300)});return send(res,200,limits)}
      if(req.method==='GET'&&url.pathname==='/api/admin/sessions'){const offset=Math.max(0,Math.min(100_000,Number(url.searchParams.get('offset')||0)||0)),limit=Math.max(1,Math.min(100,Number(url.searchParams.get('limit')||50)||50));return send(res,200,runtime.adminSessionsPage(offset,limit))}
      if(req.method==='PUT'&&/^\/api\/admin\/sessions\/[0-9a-f-]{36}$/i.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/')[4]),data=await body(req);copyFileSync(join(root,'..','data','saves',id+'.json'),join(adminData,`${id}-${Date.now()}.json`));const updated=runtime.adminReplaceSession(id,data.session);audit(actor,'session.edit',id,{reason:String(data.reason||'').slice(0,300)});return send(res,200,updated)}
      if(req.method==='GET'&&url.pathname==='/api/admin/audit')return send(res,200,existsSync(adminAudit)?readTextSync(adminAudit,'utf8').trim().split(/\r?\n/).slice(-500).filter(Boolean).map(line=>JSON.parse(line)).reverse():[]);
      const paymentConfig=url.pathname.match(/^\/api\/admin\/billing\/providers\/(yookassa|enot)$/);
      if(req.method==='PUT'&&paymentConfig){
        const id=paymentConfig[1] as PaymentProviderId,data=await body(req),current=payments.credentials(id);
        if(!data||typeof data.shopId!=='string'||typeof data.apiKey!=='string'||
          (id==='enot'&&typeof data.webhookSecret!=='string'))return send(res,400,{error:'Проверьте реквизиты провайдера'});
        const shopId=data.shopId.trim(),apiKey=data.apiKey.trim(),webhookSecret=id==='enot'?data.webhookSecret.trim():'';
        const validShop=id==='yookassa'?/^\d{1,32}$/:/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
        if(!validShop.test(shopId)||!(/^[!-~]{0,512}$/).test(apiKey)||!(/^[!-~]{0,512}$/).test(webhookSecret)){
          return send(res,400,{error:'Проверьте формат ID и ключей'});
        }
        const sameShop=shopId===current.shopId;
        const next={shopId,apiKey:apiKey||(sameShop?current.apiKey:''),webhookSecret:webhookSecret||(sameShop?current.webhookSecret:'')};
        if(!next.apiKey||(id==='enot'&&!next.webhookSecret))return send(res,400,{error:'Для этой кассы укажите все ключи'});
        if(!sameShop&&billing.hasPendingProvider(id))return send(res,409,{error:'Дождитесь завершения платежей перед сменой кассы'});
        accounts.setPaymentCredentials(id,next);
        audit(actor,'payment.provider.configure',id,{shopChanged:!sameShop});
        return send(res,200,payments.describe().find(item=>item.id===id),{'Cache-Control':'no-store'});
      }
      if(req.method==='GET'&&url.pathname==='/api/admin/billing'){const days=Math.max(1,Math.min(365,Number(url.searchParams.get('days')||30)||30)),overview=billing.adminOverview(days),status=url.searchParams.get('status')||undefined,userId=url.searchParams.get('userId')||undefined;return send(res,200,{...overview,providers:payments.describe(),records:billing.adminPayments({status,userId,limit:100})},{'Cache-Control':'no-store'})}
      if(req.method==='POST'&&/^\/api\/admin\/billing\/[0-9a-f-]{36}\/refund$/.test(url.pathname)){const id=url.pathname.split('/')[4],data=await body(req),reason=String(data.reason||'').trim();if(reason.length<3||reason.length>300)return send(res,400,{error:'Укажите причину возврата (3–300 символов)'});const payment=billing.payment(id);if(!payment)return send(res,404,{error:'Платёж не найден'});
        if(!payment.externalId)return send(res,409,{error:'У платежа нет идентификатора в провайдере: возврат невозможен'});
        if(payment.status!=='succeeded')return send(res,409,{error:'Возврат доступен только для оплаченного платежа'});
        const provider=payments.byId(payment.provider);if(!provider)return send(res,503,{error:'Платёжный провайдер больше не поддерживается'});
        const refund=await provider.refund(payment.externalId,payment.amountRub),result=billing.refund(id,refund.refundId,reason,{provider:payment.provider,amountRub:payment.amountRub});audit(actor,'payment.refund',id,{...result.payment,reason,refundId:refund.refundId,uncoveredRub:result.uncoveredRub||0});return send(res,200,result)}
      if(req.method==='POST'&&url.pathname==='/api/admin/billing/adjustment'){const data=await body(req),reason=String(data.reason||'').trim(),target=accounts.adminUsers().find(item=>item.id===String(data.userId||''));if(!target)return send(res,404,{error:'Пользователь не найден'});if(reason.length<3||reason.length>300)return send(res,400,{error:'Укажите причину корректировки (3–300 символов)'});const result=billing.adminAdjust(target.id,Number(data.amountRub),reason);audit(actor,'billing.adjustment',target.id,{amountRub:Number(data.amountRub),reason,...result});return send(res,200,result)}
      if(req.method==='GET'&&url.pathname==='/api/admin/legal')return send(res,200,legal.adminView());
      if(req.method==='PUT'&&url.pathname==='/api/admin/legal'){const data=await body(req),result=legal.save((data.values||data) as Record<string,string>,String(data.reason||''));audit(actor,'legal.update','-',{changed:result.changed,reason:result.reason,documents:result.documents.map(item=>({id:item.id,published:item.published,missing:item.missing}))});return send(res,200,result)}
      if(req.method==='GET'&&url.pathname==='/api/admin/shared-keys')return send(res,200,{...sharedKeys.summary(),routes:SHARED_ROUTES.map(route=>({route,label:ROUTE_LABELS[route]})),keys:sharedKeys.list()});
      if(req.method==='POST'&&url.pathname==='/api/admin/shared-keys'){const data=await body(req),created=sharedKeys.add({label:data.label,route:String(data.route||''),model:data.model,key:data.key,monthlyCapRub:Number(data.monthlyCapRub||0),note:data.note});audit(actor,'sharedKey.create',created.id,{label:created.label,route:created.route,model:created.model,monthlyCapRub:created.monthlyCapRub});return send(res,201,created)}
      const sharedMatch=url.pathname.match(/^\/api\/admin\/shared-keys\/([0-9a-f-]{36})(?:\/(balance))?$/);
      if(sharedMatch){const id=sharedMatch[1],current=sharedKeys.get(id);if(!current)return send(res,404,{error:'Ключ не найден'});
        if(req.method==='GET'&&!sharedMatch[2])return send(res,200,current);
        if(req.method==='PATCH'&&!sharedMatch[2]){const data=await body(req),updated=sharedKeys.update(id,data);audit(actor,'sharedKey.update',id,{label:updated.label,route:updated.route,model:updated.model,status:updated.status,monthlyCapRub:updated.monthlyCapRub,reason:String(data.reason||'').slice(0,300)});return send(res,200,updated)}
        if(req.method==='DELETE'&&!sharedMatch[2]){const data=await body(req).catch(()=>({}) as Record<string,unknown>);const reason=String(data.reason||'').trim();if(reason.length<3)return send(res,400,{error:'Укажите причину удаления (не менее 3 символов)'});sharedKeys.remove(id);audit(actor,'sharedKey.remove',id,{label:current.label,route:current.route,reason});return send(res,200,{ok:true})}
        if(req.method==='POST'&&sharedMatch[2]){const secret=sharedKeys.secret(id,false);if(!secret)return send(res,503,{error:'Ключ недоступен для проверки'});const snapshot=await fetchBalance(current,secret),updated=sharedKeys.recordBalance(id,snapshot)!;audit(actor,'sharedKey.balance',id,{route:current.route,available:snapshot.available,remainingRub:snapshot.remainingRub??null,state:balanceState(updated)});return send(res,200,{...updated,state:balanceState(updated)})}
        return send(res,405,{error:'Метод не поддерживается'})}
      if(req.method==='GET'&&url.pathname==='/api/admin/coauthors'){const stats=coauthorUsage.summary(Number(url.searchParams.get('days')||30)),devices=deviceRegistry?.adminCoauthors()||[],names=new Map(devices.map(device=>[device.id,device.name]));return send(res,200,{...stats,byCoauthor:stats.byCoauthor.map(item=>({...item,name:names.get(item.id)||item.name}))})}
      if(req.method==='GET'&&url.pathname==='/api/admin/infrastructure')return send(res,200,await infrastructure.report({fresh:url.searchParams.get('fresh')==='1'}));
      if(req.method==='POST'&&url.pathname==='/api/admin/infrastructure/operation'){const data=await body(req),name=String(data.operation||'');if(!['health','logs'].includes(name))return send(res,400,{error:'Операция недоступна: '+((name==='restart'||name==='rollback')?'перезапуск и откат выполняются вручную по SSH':'неизвестная операция'),fix:name==='restart'?'systemctl restart opengames':name==='rollback'?'ln -sfnT <релиз> /opt/opengames/current && systemctl restart opengames':undefined});return send(res,200,await infrastructure.operation(name))}
      return send(res,404,{error:'Not found'});
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/check') {
      const userId=authId(req),config=userId?accounts.getProviders(userId):undefined;
      if(!config)return send(res,403,{error:'Добавьте ключ AI-сценариста'});
      const spec=providers[config.provider as keyof typeof providers];let status=0;
      for(const key of config.keys){try{
        const headers:Record<string,string>=config.provider==='anthropic'?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+key};
        const response=await fetch(spec.baseUrl+'/models',{headers,signal:AbortSignal.timeout(8000)});status=response.status;
        if(response.ok)return send(res,200,{ok:true,provider:config.provider});
      }catch{status=0}}
      return send(res,200,{ok:false,provider:config.provider,status});
    }
    if (req.method === 'GET' && url.pathname === '/api/ai/model-usage') {
      const userId = authId(req);
      if (!userId) return send(res,401,{error:'Требуется вход'});
      const writer = resolveWriter(userId,{});
      if (!writer) return send(res,200,{});
      const {provider,model} = writer;
      const usage = provider === 'donor' ? undefined : modelUsage.today(userId,provider,model);
      return send(res,200,{provider,model,usage});
    }
    if (req.method === 'GET' && url.pathname === '/api/ai/limits') { const userId=authId(req);if(!userId)return send(res,401,{error:'Требуется вход'});if(aiMode==='donor'){const limits=accounts.dailyLimits(userId);return send(res,200,{provider:'donor',available:true,limit:limits.daily_allowance,remaining:limits.remaining_today,resetAt:limits.resetAt})}const config=accounts.getProvider(userId); if(!config)return send(res,401,{error:'Требуется вход'}); if(config.provider==='openrouter'){try{const response=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:'Bearer '+config.key},signal:AbortSignal.timeout(8000)}); const data=await response.json() as any; return send(res,response.ok?200:502,{provider:config.provider,limit:data.data?.limit??null,usage:data.data?.usage??null,remaining:data.data?.limit_remaining??null,reset:data.data?.limit_reset??null,available:response.ok});}catch{return send(res,200,{provider:config.provider,available:false})}} return send(res,200,{provider:config.provider,available:false,message:'Лимиты доступны в кабинете провайдера'}); }
    if (req.method === 'GET' && url.pathname === '/api/ai/status') {const donorStatus=donorPool?await donorPool.health():undefined;return send(res, 200, { provider: aiMode, pilotAvailable: !!pilotKey, availableProviders: [...Object.keys(providers), 'local', 'ollama', 'donor'], model: aiMode === 'donor' ? donorPool!.model : pilotKey ? pilotModel : aiMode === 'ollama' ? (process.env.OLLAMA_MODEL || 'qwen3.5:9b') : aiMode === 'openrouter' ? (process.env.OPENROUTER_MODEL || 'openrouter/free') : aiMode === 'openai' ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : aiMode === 'anthropic' ? (process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest') : 'Локальный сценарист', connected: donorStatus?donorStatus.connected:!!pilotKey||aiMode!=='local', coauthors:donorStatus?.donors, donors:donorStatus?.donors, fallback: aiMode === 'donor' || aiMode === 'ollama' ? undefined : 'Локальный сценарист' });}
    if (url.pathname.startsWith('/api/auth/') && ['POST','PUT'].includes(req.method || '') && req.headers['x-storage-consent'] !== 'accepted') return send(res,403,{error:'Требуется согласие на хранение данных'});
    if (req.method === 'GET' && url.pathname === '/api/auth/oauth') {
      return send(res,200,{providers:oauth.available()},{'Cache-Control':'no-store'});
    }
    const oauthRoute = url.pathname.match(/^\/api\/auth\/oauth\/(google|yandex|vk)\/(start|callback)$/);
    if (req.method === 'GET' && oauthRoute) {
      const provider = oauthRoute[1] as OAuthProvider;
      const redirect = (location: string, cookies?: string[]) => {
        res.writeHead(303,{...securityHeaders, Location:location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
          ...(cookies ? {'Set-Cookie':cookies} : {})});
        res.end();
      };
      if (oauthRoute[2] === 'start') {
        const flow = oauth.start(provider);
        return flow ? redirect(flow.url,[flow.cookie]) : redirect('/?oauth=failed');
      }
      try {
        const identity = await oauth.finish(provider,url.searchParams,cookie(req,'opengame_oauth'));
        if (identity) return redirect('/#/games',[oauth.cookie(''),sessionHeader(accounts.loginOAuth(identity))]);
      } catch {
        // Provider responses can contain credentials.
      }
      return redirect('/?oauth=failed');
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const retryAfter=registrationRetryAfter(rateKey(req));
      if(retryAfter)return send(res,429,{error:'Слишком много попыток регистрации. Попробуйте позже'},{'Retry-After':String(retryAfter)});
      const data=await body(req);
      const email=typeof data?.email==='string'?data.email.trim():'', password=data?.password;
      if(email.length>254||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(email)||typeof password!=='string'||password.length<8||password.length>256){
        return send(res,400,{error:'Укажите email и пароль длиной от 8 до 256 символов'});
      }
      try{
        const result=accounts.register(email,password);
        return send(res,201,{user:result.user},{'Set-Cookie':sessionHeader(result.token)});
      }catch(error){
        if(error instanceof Error&&error.message==='Пользователь уже зарегистрирован')return send(res,409,{error:error.message});
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') { const data=await body(req),key=rateKey(req);if(loginBlocked(key))return send(res,429,{error:'Слишком много попыток. Повторите через 15 минут'});try{const result=accounts.login(data.email,data.password,data.timezone);loginAttempts.delete(key);return send(res,200,{user:result.user},{'Set-Cookie':sessionHeader(result.token)})}catch{loginFailed(key);return send(res,401,{error:'Неверный email или пароль'})} }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') { const token=sessionToken(req);accounts.revoke(token);return send(res,200,{ok:true},{'Set-Cookie':sessionHeader('',0)}); }
    if (req.method === 'POST' && url.pathname === '/api/auth/password/forgot') { if(!resetAllowed(rateKey(req)))return send(res,429,{error:'Слишком много запросов. Повторите через 15 минут'});const data=await body(req),token=smtp&&publicOrigin?accounts.createPasswordReset(data.email):undefined;if(token&&smtp&&publicOrigin){const link=`${publicOrigin}/#/auth/reset?token=${encodeURIComponent(token)}`;try{await smtp.sendMail({from:`OpenGames <${process.env.SMTP_USER}>`,to:String(data.email||'').trim(),subject:'Восстановление пароля OpenGames',text:`Ссылка для смены пароля действует 15 минут:\n${link}\n\nЕсли вы не запрашивали восстановление, проигнорируйте письмо.`,html:`<p>Ссылка для смены пароля действует 15 минут:</p><p><a href="${link}">Сменить пароль</a></p><p>Если вы не запрашивали восстановление, проигнорируйте письмо.</p>`})}catch(error){accounts.discardPasswordReset(token);console.error('Password reset mail failed:',error instanceof Error?error.message:'SMTP error')}}return send(res,200,{ok:true}); }
    if (req.method === 'POST' && url.pathname === '/api/auth/password/reset') { const data=await body(req);accounts.resetPassword(data.token,data.password);return send(res,200,{ok:true},{'Set-Cookie':sessionHeader('',0)}); }
    if (req.method === 'GET' && url.pathname === '/api/auth/me') { const user = accounts.userByToken(sessionToken(req)); return user ? send(res, 200, { user }) : send(res, 401, { error: 'Требуется вход' }); }
    if (req.method === 'GET' && url.pathname === '/api/auth/ogcat') { const userId=authId(req); if(!userId)return send(res,401,{error:'Требуется вход'}); return send(res,200,accounts.getOgcatBalance(userId)); }
    if (req.method === 'POST' && url.pathname === '/api/auth/ogcat/convert') { const userId=authId(req); if(!userId)return send(res,401,{error:'Требуется вход'}); const data=await body(req); const amount=Number(data.amount); if(!Number.isInteger(amount)||amount<=0)return send(res,400,{error:'Некорректное количество'}); return send(res,200,accounts.convertOgcatToTurns(userId,amount)); }
    if (req.method === 'GET' && url.pathname === '/api/auth/ogcat/history') { const userId=authId(req); if(!userId)return send(res,401,{error:'Требуется вход'}); const limit=Math.min(200,Math.max(1,Number(url.searchParams.get('limit')||50))); return send(res,200,accounts.getOgcatHistory(userId,limit)); }
    if (req.method === 'GET' && url.pathname === '/api/billing') { const userId=authId(req); if(!userId)return send(res,401,{error:'Требуется вход'}); return send(res,200,{...billing.publicView(userId),providers:payments.describe().map(item=>({id:item.id,label:item.label,configured:item.configured}))}); }
    if (req.method === 'POST' && url.pathname === '/api/payments/topups') {
      const userId=authId(req); if(!userId)return send(res,401,{error:'Требуется вход'});
      if(req.headers['x-storage-consent']!=='accepted')return send(res,403,{error:'Требуется согласие на хранение данных'});
      if(!topupAllowed(userId))return send(res,429,{error:'Слишком много попыток пополнения. Повторите через час'});
      const data=await body(req),pack=packageById(String(data.packId||''));
      if(!pack)return send(res,400,{error:'Выберите пакет пополнения'});
      const provider=payments.byId(String(data.provider||''));
      if(!provider)return send(res,400,{error:'Платёжный провайдер не выбран'});
      if(!provider.configured)return send(res,503,{error:provider.note});
      const pending=billing.create({userId,provider:provider.id,packId:pack.id,commission:Math.round(pack.amountRub*0.016*100)/100});
      let created;
      try{created=await provider.create({paymentId:pending.id,amountRub:pack.amountRub,description:'Пополнение баланса OpenGames',returnUrl:publicOrigin})}
      catch(error){billing.fail(pending.id,error instanceof Error?error.message:'ошибка провайдера');throw error}
      const payment=billing.linkExternal(pending.id,created.externalId,created.confirmationUrl)!;
      audit(userId,'payment.topup',payment.id,{provider:provider.id,packId:pack.id,amountRub:pack.amountRub});
      return send(res,201,{payment,confirmationUrl:created.confirmationUrl,totalRub:pack.amountRub+pack.bonusRub,balanceRub:billing.balanceRub(userId)})}
    const paymentMatch=url.pathname.match(/^\/api\/payments\/([0-9a-f-]{36})$/);
    if(paymentMatch&&req.method==='GET'){const userId=authId(req);if(!userId)return send(res,401,{error:'Требуется вход'});
      const payment=billing.paymentForUser(paymentMatch[1],userId);if(!payment)return send(res,404,{error:'Платёж не найден'});
      if(payment.status==='pending'&&payment.externalId){const provider=payments.byId(payment.provider);
        if(provider?.configured){try{const event=await provider.status(payment.externalId);if(event.externalId===payment.externalId&&event.status!=='pending')billing.applyEvent(provider.id,event)}catch{}}}
      const fresh=billing.paymentForUser(paymentMatch[1],userId)!;
      return send(res,200,{payment:fresh,balanceRub:billing.balanceRub(userId),totalRub:fresh.amountRub+fresh.bonusRub})}
    if (req.method === 'GET' && url.pathname === '/api/auth/provider-limits') { const userId=authId(req); if(!userId)return send(res,401,{error:'Требуется вход'}); const limits=accounts.getProviderLimits(userId); const result:Record<string,any>={}; for(const [provider,cache] of Object.entries(limits)){ result[provider]={...cache,estimatedTurns:0,confidence:'low',avgTokens:0}; try{ const est=accounts.estimateTurns(userId,provider,coauthorUsage); result[provider].estimatedTurns=est.estimatedTurns; result[provider].confidence=est.confidence; result[provider].avgTokens=est.avgTokens; result[provider].sampleSize=est.sampleSize; result[provider].isEstimate=est.isEstimate; }catch{} } return send(res,200,result); }
    if (req.method === 'POST' && url.pathname === '/api/auth/provider-limits/refresh') { const userId=authId(req); if(!userId)return send(res,401,{error:'Требуется вход'}); const data=await body(req); const provider=String(data.provider||'').trim(); if(!provider)return send(res,400,{error:'Укажите провайдера'}); const updated=await accounts.refreshProviderLimits(userId,provider); return send(res,200,updated); }
    if(deviceRegistry&&req.method==='POST'&&url.pathname==='/api/donor/pairings'){
      if(!donorAllowed('begin:'+rateKey(req),5))return send(res,429,{error:'Слишком много запросов привязки'});
      const data=await body(req);return send(res,201,deviceRegistry.begin(data.name));
    }
    if(deviceRegistry&&req.method==='POST'&&url.pathname==='/api/donor/token'){
      const data=await body(req);return send(res,200,deviceRegistry.poll(data.deviceCode),{'Cache-Control':'no-store'});
    }
    if(deviceRegistry&&req.method==='POST'&&url.pathname==='/api/donor/revoke-self'){
      const id=deviceRegistry.revokeSelf(req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,64})$/)?.[1]);connectTransport?.disconnect(id);return send(res,200,{ok:true});
    }
    if(deviceRegistry&&req.method==='POST'&&url.pathname==='/api/donor/rename-self'){
      const data=await body(req);return send(res,200,deviceRegistry.renameSelf(req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,64})$/)?.[1],data.name));
    }
    if(deviceRegistry&&url.pathname.startsWith('/api/donor/devices')){
      const ownerId=authId(req);if(!ownerId)return send(res,401,{error:'Требуется вход'});
      if(req.method==='GET'&&url.pathname==='/api/donor/devices')return send(res,200,{devices:deviceRegistry.list(ownerId).map(device=>({...device,online:connectTransport?.connected(device.id)??false}))});
      const match=url.pathname.match(/^\/api\/donor\/devices\/([0-9a-f-]{36})$/i);
      if(req.method==='DELETE'&&match){if(req.headers['x-storage-consent']!=='accepted')return send(res,403,{error:'Требуется согласие на хранение данных'});const result=deviceRegistry.revoke(ownerId,match[1]);connectTransport?.disconnect(match[1]);return send(res,200,result)}
      const removed=url.pathname.match(/^\/api\/donor\/devices\/([0-9a-f-]{36})\/record$/i);
      if(req.method==='DELETE'&&removed){if(req.headers['x-storage-consent']!=='accepted')return send(res,403,{error:'Требуется согласие на хранение данных'});return send(res,200,deviceRegistry.removeRevoked(ownerId,removed[1]))}
    }
    if(deviceRegistry&&url.pathname==='/api/donor/pairing'&&req.method==='GET'){
      const ownerId=authId(req);if(!ownerId)return send(res,401,{error:'Требуется вход'});
      if(!donorAllowed('lookup:'+ownerId,20))return send(res,429,{error:'Слишком много попыток'});
      return send(res,200,deviceRegistry.pairing(url.searchParams.get('code')));
    }
    if(deviceRegistry&&url.pathname==='/api/donor/approve'&&req.method==='POST'){
      const ownerId=authId(req);if(!ownerId)return send(res,401,{error:'Требуется вход'});
      if(req.headers['x-storage-consent']!=='accepted')return send(res,403,{error:'Требуется согласие на хранение данных'});
      if(!donorAllowed('approve:'+ownerId,10))return send(res,429,{error:'Слишком много попыток'});
      const data=await body(req);return send(res,200,deviceRegistry.approve(data.code,ownerId));
    }
    if (req.method === 'PUT' && ['/api/auth/profile','/api/auth/provider-key','/api/auth/provider-model','/api/auth/ai-source'].includes(url.pathname)) { const userId=authId(req); if (!userId) return send(res,401,{error:'Требуется вход'}); const data=await body(req); const user=url.pathname.endsWith('/profile')?accounts.updateProfile(userId,data.displayName):url.pathname.endsWith('/provider-model')?accounts.setProviderModel(userId,data.provider,data.model):url.pathname.endsWith('/ai-source')?accounts.setAiSource(userId,data.source):accounts.setProviderKey(userId,data.provider,data.key,data.model);return send(res,200,{user}); }
    if (req.method === 'GET' && url.pathname === '/api/games/popular') return send(res, 200, runtime.listPopularGames());
    if (req.method === 'GET' && url.pathname === '/api/games') return send(res, 200, runtime.listGames());
    if(url.pathname==='/api/feedback/requests'&&(req.method==='GET'||req.method==='POST')){
      const ownerId=authId(req);
      if(!ownerId)return send(res,401,{error:'Требуется вход'},privateFeedback);
      if(req.method==='GET')return send(res,200,feedbackRequestDays,privateFeedback);
      if(req.headers['x-storage-consent']!=='accepted')return send(res,403,{error:'Требуется согласие на хранение данных'},privateFeedback);
      const data=await body(req),type=data?.type as FeedbackRequestType;
      if(!feedbackRequestTypes.includes(type))return send(res,400,{error:'Выберите тип заявления'},privateFeedback);
      if(type==='account_deletion'&&data.confirm!==true)return send(res,400,{error:'Подтвердите запрос на удаление'},privateFeedback);
      let paymentId:string|undefined;
      if(type!=='account_deletion'&&data.paymentId){
        if(typeof data.paymentId!=='string'||!billing.paymentForUser(data.paymentId,ownerId)){
          return send(res,400,{error:'Платёж не найден в вашем аккаунте'},privateFeedback);
        }
        paymentId=data.paymentId;
      }
      const text=type==='account_deletion'&&typeof data.text==='string'&&!data.text.trim()?'Прошу удалить аккаунт и связанные персональные данные.':data.text;
      const ticket=feedback.createRequest(ownerId,type,text,paymentId);
      void notifyFeedbackAdministrator();
      return send(res,201,ticket,privateFeedback);
    }
    const playerFeedback = url.pathname.match(/^\/api\/feedback(?:\/([0-9a-f-]{36}))?$/);
    if (playerFeedback) {
      const ownerId = authId(req), id = playerFeedback[1];
      if (!ownerId) return send(res,401,{error:'Требуется вход'},privateFeedback);
      if (req.method==='GET') {
        return send(res,200,id?feedback.get(id,ownerId):feedback.list(feedbackFilters(url.searchParams),ownerId),privateFeedback);
      }
      if (req.method==='POST') {
        if (req.headers['x-storage-consent']!=='accepted') return send(res,403,{error:'Требуется согласие на хранение данных'},privateFeedback);
        const data = await body(req);
        if (!data || typeof data!=='object') return send(res,400,{error:'Некорректное обращение'},privateFeedback);
        if (id) return send(res,200,feedback.reply(id,data.text,ownerId),privateFeedback);
        if (typeof data.sessionId!=='string' || !feedbackKinds.includes(data.kind)) {
          return send(res,400,{error:'Укажите игру и тип обращения'},privateFeedback);
        }
        let session;
        try { session = runtime.get(data.sessionId,ownerId); }
        catch { return send(res,404,{error:'Сессия не найдена'},privateFeedback); }
        const turn = data.turnIndex == null ? undefined : session.turns.find(turn=>turn.index===data.turnIndex);
        if (data.turnIndex != null && !turn) return send(res,400,{error:'Ход не найден'},privateFeedback);
        const context = {
          sessionId:session.id,gameId:session.gameId,gameVersion:session.packageVersion,turnIndex:turn?.index,
          source:turn?.source,model:turn?.model,action:turn?.action.text?.slice(0,1000) || turn?.action.type,
          narrative:turn?.narrative.slice(0,4000),
          error:data.kind==='issue' && typeof data.error==='string' ? data.error.slice(0,500) : undefined
        };
        return send(res,201,feedback.create(ownerId,context,data.kind,data.kind==='rating'?data.rating:data.text),privateFeedback);
      }
    }
    if (url.pathname.startsWith('/api/sessions') && !authId(req)) return send(res,401,{error:'Требуется вход'});
    if (url.pathname.startsWith('/api/sessions') && (req.method === 'POST' || req.method === 'PUT') && req.headers['x-storage-consent'] !== 'accepted') return send(res,403,{error:'Требуется согласие на хранение данных'});
    if (req.method === 'GET' && url.pathname === '/api/sessions') return send(res, 200, runtime.listSessions(authId(req)));
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const ownerId = authId(req)!, data = await body(req);
      if (!runtime.gamePackage(data.gameId)) return send(res,404,{error:'Игра не найдена'});
      if (!resolveWriter(ownerId, accounts.scenarioSettings(ownerId, data.gameId))) return send(res,403,{error:'Добавьте ключ AI-сценариста в профиле'});
      return send(res,201,runtime.create(data.gameId,ownerId));
    }
    const generationMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/generation$/);
    if (generationMatch && ['GET','PUT'].includes(req.method || '')) {
      const userId = authId(req)!, { gameId } = runtime.get(generationMatch[1],userId);
      if (req.method === 'PUT') accounts.setScenarioSettings(userId,gameId,generationSettings(userId,await body(req)));
      const settings = accounts.scenarioSettings(userId,gameId), writer = resolveWriter(userId,settings);
      const describe = (config: ReturnType<typeof resolveWriter>) => config ? { provider:config.provider, model:config.model,
        sampling:config.provider === 'ollama' || !!modelInfo(config.provider,config.model)?.sampling } : undefined;
      const active = describe(writer), defaultWriter = describe(resolveWriter(userId,{}));
      const usage = writer && writer.provider !== 'donor' ? modelUsage.today(userId,writer.provider,writer.model) : undefined;
      return send(res,200,{settings,active,defaultWriter,usage});
    }
    const packageMatch=url.pathname.match(/^\/api\/sessions\/([^/]+)\/package$/);
    if(packageMatch&&req.method==='GET')return send(res,200,runtime.sessionPackage(packageMatch[1],authId(req)));
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/); const turnMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/turns$/);
    if (sessionMatch && req.method === 'GET') return send(res, 200, runtime.get(sessionMatch[1], authId(req)));
    const pendingMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/pending-turn$/);
    if (pendingMatch && req.method === 'GET' && queue) { const ownerId=authId(req)!; runtime.get(pendingMatch[1],ownerId); const pending=queue.pending(pendingMatch[1],ownerId); return send(res,200,pending?queue.view(pending.id,ownerId):{status:'idle'}); }
    const jobMatch = url.pathname.match(/^\/api\/turn-jobs\/([^/]+)$/);
    if (jobMatch && queue) { const ownerId=authId(req); if (!ownerId) return send(res,401,{error:'Требуется вход'}); if(req.method==='GET')return send(res,200,queue.view(jobMatch[1],ownerId)); if(req.method==='DELETE')return send(res,200,queue.cancel(jobMatch[1],ownerId)); }
    if (turnMatch && req.method === 'POST') {
      const userId = authId(req)!, id = turnMatch[1], action = await body(req) as Action;
      const session = runtime.get(id,userId), generation = accounts.scenarioSettings(userId,session.gameId);
      const config = resolveWriter(userId,generation);
      if (!config) return send(res,403,{error:'Добавьте ключ AI-сценариста в профиле'});
      if (config.provider === 'donor') return send(res,202,queue!.enqueue(id,userId,action));
      if (queue?.pending(id,userId)) return send(res,409,{error:'Предыдущий ход ещё обрабатывается'});
      const stream = req.headers.accept === 'application/x-ndjson', controller = new AbortController();
      const beginRequest = () => modelUsage.begin(userId,config.provider,config.model);
      const primary = config.provider === 'ollama' ? new OllamaAIProvider() : new RemoteAIProvider(config.provider,config.keys,config.model);
      const tracked: AIProvider = config.provider !== 'ollama' ? primary : {
        generate: async (...args: Parameters<AIProvider['generate']>) => {
          const record = beginRequest();
          let usage;
          try { const result = await primary.generate(args[0],args[1],args[2],args[3],args[4]); usage = result.usage; return result; }
          finally { record(usage); }
        }
      };
      let preview = '';
      const emit = (value: unknown) => { if (!res.destroyed) res.write(json(value) + '\n'); };
      res.once('close', () => { if (!res.writableEnded) controller.abort(); });
      if (stream) {
        res.writeHead(200,{...securityHeaders,'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
        res.flushHeaders();
      }
      try {
        const result = await runtime.turn(id,action,tracked,userId,{
          signal:controller.signal, generation, beginRequest,
          onNarrative:stream ? text => { if (text !== preview) { preview = text; emit({type:'preview',text}); } } : undefined
        });
        if (stream) emit({type:'result',result});
        else return send(res,200,result);
      } catch (error) {
        if (controller.signal.aborted) return;
        const detail = {error:error instanceof Error ? error.message : 'Ошибка генерации',
          status:Number((error as {status?:number})?.status) || 502, resetAt:(error as {resetAt?:number})?.resetAt};
        if (stream) emit({type:'error',...detail});
        else return send(res,detail.status,detail);
      } finally { if (stream && !res.destroyed) res.end(); }
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch (error) { if(error instanceof DailyLimitError)return send(res,402,{error:error.message,code:error.code,resetAt:error.resetAt});if(error instanceof PaymentError)return send(res,error.status,{error:error.message});const status=Number((error as Error&{status?:number})?.status);if(Number.isInteger(status)&&status>=400&&status<500)return send(res,status,{error:error instanceof Error?error.message:'Некорректный запрос'});console.error('Request failed:',error instanceof Error?error.message:'unknown error');return send(res,500,{error:'Внутренняя ошибка сервера'}); }
});
if(deviceRegistry&&donorPool){connectTransport=new ConnectTransport(server,deviceRegistry,donorPool);queue=new TurnQueue(runtime,accounts,donorPool,join(root,'..','data','turn-jobs.json'),connectTransport,coauthorUsage,deviceRegistry)}
let shuttingDown=false;
function shutdown(){if(shuttingDown)return;shuttingDown=true;connectTransport?.close();const force=setTimeout(()=>{server.closeAllConnections();process.exit(1)},15_000);force.unref();server.close(error=>{clearTimeout(force);if(error){console.error('HTTP shutdown failed:',error.message);process.exitCode=1}else process.exitCode=0})}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
const port = Number(process.env.PORT || 3000),host=process.env.HOST||'127.0.0.1'; server.listen(port,host,() => console.log(`OpenGames Beta: http://${host}:${port} (user provider)`));
