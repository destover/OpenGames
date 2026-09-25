import providers from './core/providers.json' with { type: 'json' };
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { appendFileSync, copyFileSync, mkdirSync, readFileSync as readTextSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { GameRuntime } from './core/runtime.ts';
import { RemoteAIProvider, AnthropicProvider, FallbackAIProvider, LocalAIProvider, OllamaAIProvider, OpenAIProvider, OpenRouterProvider } from './core/ai.ts';
import { AccountStore, DailyLimitError } from './core/accounts.ts';
import { LocalSaveSystem } from './core/save.ts';
import { DonorAIProvider } from './core/donor.ts';
import { DonorPool } from './core/donor-pool.ts';
import { TurnQueue } from './core/turn-queue.ts';
import { DeviceRegistry } from './core/device-registry.ts';
import { ConnectTransport } from './core/connect-transport.ts';
import { CoauthorUsageStore } from './core/coauthor-usage.ts';
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

const root = dirname(fileURLToPath(import.meta.url));
const envFile = join(root, '..', '.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}
const configuredPublicUrl=process.env.OPENGAME_PUBLIC_URL;let publicOrigin:string|undefined;
if(configuredPublicUrl){let parsed:URL;try{parsed=new URL(configuredPublicUrl)}catch{throw new Error('OPENGAME_PUBLIC_URL должен быть корректным URL')}if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('OPENGAME_PUBLIC_URL должен быть публичным HTTP(S) URL без учётных данных');if(parsed.protocol==='https:'&&process.env.OPENGAME_SECURE_COOKIE!=='1')throw new Error('Для HTTPS в OPENGAME_PUBLIC_URL установите OPENGAME_SECURE_COOKIE=1');publicOrigin=parsed.origin}
const games = new Map<string,GamePackage>([[survival.manifest.id, survival], [detective.manifest.id, detective], [spaceColony.manifest.id, spaceColony], [museumNight.manifest.id, museumNight], [marsOutpost.manifest.id, marsOutpost], [jungleExpedition.manifest.id, jungleExpedition], [underwaterStation.manifest.id, underwaterStation], [clockworkCity.manifest.id, clockworkCity], [arcticProtocol.manifest.id, arcticProtocol], [emergencyTriage.manifest.id, emergencyTriage], [airTrafficBlackout.manifest.id, airTrafficBlackout], [floodCommand.manifest.id, floodCommand], [centralBankRun.manifest.id, centralBankRun], [filmProduction.manifest.id, filmProduction], [orchestraPremiere.manifest.id, orchestraPremiere], [oceanRegatta.manifest.id, oceanRegatta], [SummerRoof.manifest.id, SummerRoof], [SummerKites.manifest.id, SummerKites], [SummerCourtyard.manifest.id, SummerCourtyard], [AutumnBookmobile.manifest.id, AutumnBookmobile], [AutumnHarvest.manifest.id, AutumnHarvest], [AutumnAteliers.manifest.id, AutumnAteliers], [WinterShelter.manifest.id, WinterShelter], [WinterLetters.manifest.id, WinterLetters], [WinterAurora.manifest.id, WinterAurora], [SpringBike.manifest.id, SpringBike], [SpringBees.manifest.id, SpringBees], [SpringFountain.manifest.id, SpringFountain], [NightRailYard.manifest.id,NightRailYard], [ArchiveWaterline.manifest.id,ArchiveWaterline], [GridRepairDispatch.manifest.id,GridRepairDispatch], [TravellingStage.manifest.id,TravellingStage], [OasisWaterCompact.manifest.id,OasisWaterCompact], [SkybridgeCargo.manifest.id,SkybridgeCargo], [CoralRestorationLab.manifest.id,CoralRestorationLab], [LandslideExcavation.manifest.id,LandslideExcavation], [PolarRadioRelay.manifest.id,PolarRadioRelay], [InteractiveExhibit.manifest.id,InteractiveExhibit]]);
const openRouterKeys = [process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY_BACKUP].filter((key): key is string => Boolean(key));
const aiMode = process.env.OPENGAME_DONOR === '1' ? 'donor' : process.env.OPENGAME_OLLAMA === '1' ? 'ollama' : process.env.OPENGAME_LOCAL_AI === '1' ? 'local' : (openRouterKeys.length ? 'openrouter' : process.env.OPENAI_API_KEY ? 'openai' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'local');
const donorPool=aiMode==='donor'?new DonorPool():undefined;
const baseProvider = aiMode === 'donor' ? new DonorAIProvider(donorPool!.first) : aiMode === 'ollama' ? new OllamaAIProvider() : aiMode === 'openrouter' ? new OpenRouterProvider(openRouterKeys, process.env.OPENROUTER_MODEL) : aiMode === 'openai' ? new OpenAIProvider(process.env.OPENAI_API_KEY!, process.env.OPENAI_MODEL) : aiMode === 'anthropic' ? new AnthropicProvider(process.env.ANTHROPIC_API_KEY!, process.env.ANTHROPIC_MODEL) : new LocalAIProvider();
const provider = aiMode === 'donor' ? baseProvider : new FallbackAIProvider(baseProvider, new LocalAIProvider());
const runtime = new GameRuntime(games, provider, new LocalSaveSystem(join(root, '..', 'data', 'saves')));
const accounts = new AccountStore(join(root, '..', 'data', 'accounts.json'));
accounts.initializeAdmin(process.env.OPENGAME_ADMIN_EMAIL);
const adminData=join(root,'..','data','admin');mkdirSync(adminData,{recursive:true,mode:0o700});const adminAudit=join(adminData,'audit.jsonl');
const coauthorUsage=new CoauthorUsageStore(join(root,'..','data','coauthor-usage.sqlite'));
function audit(actor:string,action:string,target:string,details:Record<string,unknown>={}){appendFileSync(adminAudit,JSON.stringify({at:new Date().toISOString(),actor,action,target,details})+'\n',{mode:0o600});}
const deviceRegistry=aiMode==='donor'?new DeviceRegistry(join(root,'..','data','donor-devices.sqlite')):undefined;
let queue:TurnQueue|undefined,connectTransport:ConnectTransport|undefined;
const smtp=process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASSWORD?nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||465),secure:process.env.SMTP_SECURE!=='0',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}}):null;
const json = (value: unknown) => JSON.stringify(value);
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
async function body(req: import('node:http').IncomingMessage) { let data = ''; for await (const chunk of req){data+=chunk;if(data.length>1_000_000)throw new Error('Запрос слишком большой')} return data ? JSON.parse(data) : {}; }
function cookie(req:import('node:http').IncomingMessage,name:string){return req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)}
function sessionToken(req:import('node:http').IncomingMessage){return cookie(req,sessionCookie)}
function authId(req: import('node:http').IncomingMessage) { return accounts.idByToken(sessionToken(req)); }
function sessionHeader(token:string,maxAge=604800){return `${sessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.OPENGAME_SECURE_COOKIE==='1'?'; Secure':''}`}
function rateKey(req:import('node:http').IncomingMessage){const peer=req.socket.remoteAddress||'local';if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer))return peer;const real=String(req.headers['x-real-ip']||'').trim(),forwarded=String(req.headers['x-forwarded-for']||'').split(',').at(-1)?.trim();return isIP(real)?real:forwarded&&isIP(forwarded)?forwarded:peer}
function loginBlocked(key:string){const item=loginAttempts.get(key);if(!item)return false;if(item.resetAt<=Date.now()){loginAttempts.delete(key);return false}return item.count>=5}
function loginFailed(key:string){const item=loginAttempts.get(key),now=Date.now();loginAttempts.set(key,!item||item.resetAt<=now?{count:1,resetAt:now+15*60_000}:{count:item.count+1,resetAt:item.resetAt})}
function resetAllowed(key:string){const now=Date.now(),item=resetAttempts.get(key);if(!item||item.resetAt<=now){resetAttempts.set(key,{count:1,resetAt:now+15*60_000});return true}if(item.count>=3)return false;item.count++;return true}
function donorAllowed(key:string,limit:number){const now=Date.now(),item=donorAttempts.get(key);if(!item||item.resetAt<=now){donorAttempts.set(key,{count:1,resetAt:now+15*60_000});return true}if(item.count>=limit)return false;item.count++;return true}
function send(res: import('node:http').ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) { res.writeHead(status, { ...securityHeaders,'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(json(value)); }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if(req.method==='GET'&&url.pathname==='/admin'){const actor=authId(req);if(!actor)return send(res,401,{error:'Требуется вход'});if(!accounts.isAdmin(actor))return send(res,403,{error:'Недостаточно прав'});const html=await readFile(join(root,'..','web','admin.html'));res.writeHead(200,{...securityHeaders,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return}
    if(req.method==='GET'&&url.pathname==='/admin.js'){const data=await readFile(join(root,'..','web','admin.js'));res.writeHead(200,{...securityHeaders,'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(data);return}
    if(req.method==='GET'&&url.pathname==='/admin.css'){const data=await readFile(join(root,'..','web','admin.css'));res.writeHead(200,{...securityHeaders,'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-store'});res.end(data);return}
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) { const asset = url.pathname.slice('/assets/'.length); if (!/^[a-zA-Z0-9._/-]+$/.test(asset) || asset.split('/').some(part => !part || part === '.' || part === '..')) return send(res, 404, { error: 'Файл не найден' }); const file = join(root, '..', 'web', 'assets', asset); const data = await readFile(file); res.writeHead(200, { ...securityHeaders,'Content-Type': asset.endsWith('.svg') ? 'image/svg+xml' : asset.endsWith('.png') ? 'image/png' : /\.jpe?g$/i.test(asset) ? 'image/jpeg' : asset.endsWith('.wav') ? 'audio/wav' : asset.endsWith('.ogg') ? 'audio/ogg' : asset.endsWith('.mp3') ? 'audio/mpeg' : asset.endsWith('.m4a') ? 'audio/mp4' : 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' }); res.end(data); return; }
    if (req.method==='GET'&&url.pathname==='/api/donor/downloads'){const platform=browserPlatform(req);return send(res,200,{platform,downloads:connectDownloads.map(({file,...item})=>({...item,url:'/downloads/'+file,recommended:item.platform===platform}))},{'Cache-Control':'no-store','Vary':'User-Agent, Sec-CH-UA-Platform'})}
    if ((req.method==='GET'||req.method==='HEAD')&&url.pathname.startsWith('/downloads/')){const file=url.pathname.slice('/downloads/'.length);if(!connectDownloads.some(item=>item.file===file))return send(res,404,{error:'Файл не найден'});const path=join(root,'..','web','downloads',file),size=(await stat(path)).size;res.writeHead(200,{...securityHeaders,'Content-Type':file.endsWith('.dmg')?'application/x-apple-diskimage':file.endsWith('.exe')?'application/vnd.microsoft.portable-executable':'application/zip','Content-Length':String(size),'Content-Disposition':`attachment; filename="${file}"`,'Cache-Control':'public, max-age=86400, immutable'});if(req.method==='HEAD')res.end();else createReadStream(path).pipe(res);return}
    if (req.method === 'GET' && ['/app.js','/style.css','/redesign.css','/ui.json'].includes(url.pathname)) { const data = await readFile(join(root, '..', 'web', url.pathname.slice(1))); res.writeHead(200, {...securityHeaders,'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'application/json', 'Cache-Control':'no-store'}); res.end(data); return; }
    if (req.method === 'GET' && url.pathname === '/') { const html = await readFile(join(root, '..', 'web', 'index.html'), 'utf8'); res.writeHead(200, { ...securityHeaders,'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return; }
    if (req.method === 'GET' && url.pathname === '/api/ai/providers') return send(res,200,providers);
    if (req.method === 'GET' && url.pathname === '/api/health') {const donor=donorPool?await donorPool.health():undefined,ok=donor?donor.connected:true;return send(res,ok?200:503,{ok,games:runtime.listGames().length,provider:aiMode,aiConnected:ok})}
    if(url.pathname.startsWith('/api/admin/')){const actor=authId(req);if(!actor)return send(res,401,{error:'Требуется вход'});if(!accounts.isAdmin(actor))return send(res,403,{error:'Недостаточно прав'});if(!['GET','HEAD'].includes(req.method||'')&&req.headers['x-admin-confirm']!=='confirmed')return send(res,403,{error:'Требуется подтверждение действия'});
      if(req.method==='GET'&&url.pathname==='/api/admin/overview')return send(res,200,{...accounts.adminSummary(),games:runtime.listGames().length,sessions:runtime.adminSessions().length,turns:runtime.adminSessions().reduce((n,s)=>n+s.turns.length,0),provider:aiMode,health:'ok',updatedAt:new Date().toISOString()});
      if(req.method==='GET'&&url.pathname==='/api/admin/users')return send(res,200,accounts.adminUsers());
      if(req.method==='GET'&&url.pathname==='/api/admin/packages')return send(res,200,runtime.listGames().map(item=>{const full=runtime.gamePackage(item.manifest.id)!;return {...item,package:full}}));
      if(req.method==='PUT'&&/^\/api\/admin\/packages\/[^/]+$/.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/')[4]);if(!/^[a-z0-9_-]+$/i.test(id))return send(res,400,{error:'Некорректный ID игры'});const data=await body(req),game=data.package;if(!game||game.manifest?.id!==id)return send(res,400,{error:'ID пакета не совпадает'});const path=join(root,'games',id+'.json');runtime.validateGamePackageUpdate(id,game);copyFileSync(path,join(adminData,`${id}-${Date.now()}.json`));const temp=path+'.tmp';writeFileSync(temp,JSON.stringify(game,null,2));renameSync(temp,path);runtime.replaceGamePackage(id,game);audit(actor,'package.publish',id,{reason:String(data.reason||'').slice(0,300),version:game.manifest.version});return send(res,200,{ok:true,game:runtime.listGames().find(item=>item.manifest.id===id)})}
      if(req.method==='POST'&&/^\/api\/admin\/packages\/[a-z0-9_-]+\/rollback$/i.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/')[4]);if(!/^[a-z0-9_-]+$/i.test(id))return send(res,400,{error:'Некорректный ID игры'});const data=await body(req),name=String(data.backup||'');if(!new RegExp('^'+id+'-[0-9]+\\.json$').test(name))return send(res,400,{error:'Некорректная резервная копия'});const file=join(adminData,name),game=JSON.parse(readTextSync(file,'utf8'));runtime.validateGamePackageUpdate(id,game);const path=join(root,'games',id+'.json');copyFileSync(path,join(adminData,`${id}-${Date.now()}.json`));const temp=path+'.tmp';writeFileSync(temp,JSON.stringify(game,null,2));renameSync(temp,path);runtime.replaceGamePackage(id,game);audit(actor,'package.rollback',id,{backup:name,reason:String(data.reason||'').slice(0,300)});return send(res,200,{ok:true})}
      if(req.method==='PATCH'&&/^\/api\/admin\/users\/[^/]+\/status$/.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/')[4]),data=await body(req),result=accounts.adminSetDisabled(id,Boolean(data.disabled));audit(actor,'user.status',id,{disabled:result.disabled});return send(res,200,result)}
      if(req.method==='POST'&&/^\/api\/admin\/users\/[^/]+\/allowance$/.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/')[4]),data=await body(req),limits=accounts.adminGrantTurns(id,Number(data.allowance));audit(actor,'user.turns.grant',id,{granted:Number(data.allowance),allowance:limits.daily_allowance,remaining:limits.remaining_today,reason:String(data.reason||'').slice(0,300)});return send(res,200,limits)}
      if(req.method==='GET'&&url.pathname==='/api/admin/sessions'){const offset=Math.max(0,Math.min(100_000,Number(url.searchParams.get('offset')||0)||0)),limit=Math.max(1,Math.min(100,Number(url.searchParams.get('limit')||50)||50));return send(res,200,runtime.adminSessionsPage(offset,limit))}
      if(req.method==='PUT'&&/^\/api\/admin\/sessions\/[0-9a-f-]{36}$/i.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/')[4]),data=await body(req);copyFileSync(join(root,'..','data','saves',id+'.json'),join(adminData,`${id}-${Date.now()}.json`));const updated=runtime.adminReplaceSession(id,data.session);audit(actor,'session.edit',id,{reason:String(data.reason||'').slice(0,300)});return send(res,200,updated)}
      if(req.method==='GET'&&url.pathname==='/api/admin/audit')return send(res,200,existsSync(adminAudit)?readTextSync(adminAudit,'utf8').trim().split(/\r?\n/).slice(-500).filter(Boolean).map(line=>JSON.parse(line)).reverse():[]);
      if(req.method==='GET'&&url.pathname==='/api/admin/billing')return send(res,200,{available:false,provider:null,records:[],message:'Платежный провайдер не подключен'});
      if(req.method==='POST'&&/^\/api\/admin\/billing\/[^/]+\/refund$/.test(url.pathname))return send(res,503,{error:'Платежный провайдер не подключен; возврат не выполнен'});
      if(req.method==='GET'&&url.pathname==='/api/admin/coauthors'){const stats=coauthorUsage.summary(Number(url.searchParams.get('days')||30)),devices=deviceRegistry?.adminCoauthors()||[],names=new Map(devices.map(device=>[device.id,device.name]));return send(res,200,{...stats,byCoauthor:stats.byCoauthor.map(item=>({...item,name:names.get(item.id)||item.name}))})}
      if(req.method==='GET'&&url.pathname==='/api/admin/infrastructure')return send(res,200,{provider:'local-agent',configured:!!process.env.OPENGAME_ADMIN_AGENT,operations:['health','logs','restart','rollback'],message:process.env.OPENGAME_ADMIN_AGENT?'Агент настроен':'Ограниченный VDS-агент не настроен; изменяющие операции недоступны'});
      if(req.method==='POST'&&url.pathname==='/api/admin/infrastructure/operation'){const data=await body(req);if(!['health','logs','restart','rollback'].includes(data.operation)||!process.env.OPENGAME_ADMIN_AGENT)return send(res,503,{error:'Допустимый агент инфраструктуры не настроен'});return send(res,503,{error:'Подключение агента не реализовано'})}
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
    if (req.method === 'GET' && url.pathname === '/api/ai/limits') { const userId=authId(req);if(!userId)return send(res,401,{error:'Требуется вход'});if(aiMode==='donor'){const limits=accounts.dailyLimits(userId);return send(res,200,{provider:'donor',available:true,limit:limits.daily_allowance,remaining:limits.remaining_today,resetAt:limits.resetAt})}const config=accounts.getProvider(userId); if(!config)return send(res,401,{error:'Требуется вход'}); if(config.provider==='openrouter'){try{const response=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:'Bearer '+config.key},signal:AbortSignal.timeout(8000)}); const data=await response.json() as any; return send(res,response.ok?200:502,{provider:config.provider,limit:data.data?.limit??null,usage:data.data?.usage??null,remaining:data.data?.limit_remaining??null,reset:data.data?.limit_reset??null,available:response.ok});}catch{return send(res,200,{provider:config.provider,available:false})}} return send(res,200,{provider:config.provider,available:false,message:'Лимиты доступны в кабинете провайдера'}); }
    if (req.method === 'GET' && url.pathname === '/api/ai/status') {const donorStatus=donorPool?await donorPool.health():undefined;return send(res, 200, { provider: aiMode, availableProviders: [...Object.keys(providers), 'local', 'ollama', 'donor'], model: aiMode === 'donor' ? donorPool!.model : aiMode === 'ollama' ? (process.env.OLLAMA_MODEL || 'qwen3.5:9b') : aiMode === 'openrouter' ? (process.env.OPENROUTER_MODEL || 'openrouter/free') : aiMode === 'openai' ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : aiMode === 'anthropic' ? (process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest') : 'Локальный сценарист', connected: donorStatus?donorStatus.connected:aiMode!=='local', coauthors:donorStatus?.donors, donors:donorStatus?.donors, fallback: aiMode === 'donor' || aiMode === 'ollama' ? undefined : 'Локальный сценарист' });}
    if (url.pathname.startsWith('/api/auth/') && ['POST','PUT'].includes(req.method || '') && req.headers['x-storage-consent'] !== 'accepted') return send(res,403,{error:'Требуется согласие на хранение данных'});
    if (req.method === 'POST' && url.pathname === '/api/auth/register') { const data=await body(req),result=accounts.register(data.email,data.password);return send(res,201,{user:result.user},{'Set-Cookie':sessionHeader(result.token)}); }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') { const data=await body(req),key=rateKey(req);if(loginBlocked(key))return send(res,429,{error:'Слишком много попыток. Повторите через 15 минут'});try{const result=accounts.login(data.email,data.password);loginAttempts.delete(key);return send(res,200,{user:result.user},{'Set-Cookie':sessionHeader(result.token)})}catch{loginFailed(key);return send(res,401,{error:'Неверный email или пароль'})} }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') { const token=sessionToken(req);accounts.revoke(token);return send(res,200,{ok:true},{'Set-Cookie':sessionHeader('',0)}); }
    if (req.method === 'POST' && url.pathname === '/api/auth/password/forgot') { if(!resetAllowed(rateKey(req)))return send(res,429,{error:'Слишком много запросов. Повторите через 15 минут'});const data=await body(req),token=smtp&&publicOrigin?accounts.createPasswordReset(data.email):undefined;if(token&&smtp&&publicOrigin){const link=`${publicOrigin}/#/auth/reset?token=${encodeURIComponent(token)}`;try{await smtp.sendMail({from:`OpenGames <${process.env.SMTP_USER}>`,to:String(data.email||'').trim(),subject:'Восстановление пароля OpenGames',text:`Ссылка для смены пароля действует 15 минут:\n${link}\n\nЕсли вы не запрашивали восстановление, проигнорируйте письмо.`,html:`<p>Ссылка для смены пароля действует 15 минут:</p><p><a href="${link}">Сменить пароль</a></p><p>Если вы не запрашивали восстановление, проигнорируйте письмо.</p>`})}catch(error){accounts.discardPasswordReset(token);console.error('Password reset mail failed:',error instanceof Error?error.message:'SMTP error')}}return send(res,200,{ok:true}); }
    if (req.method === 'POST' && url.pathname === '/api/auth/password/reset') { const data=await body(req);accounts.resetPassword(data.token,data.password);return send(res,200,{ok:true},{'Set-Cookie':sessionHeader('',0)}); }
    if (req.method === 'GET' && url.pathname === '/api/auth/me') { const user = accounts.userByToken(sessionToken(req)); return user ? send(res, 200, { user }) : send(res, 401, { error: 'Требуется вход' }); }
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
    if (url.pathname.startsWith('/api/sessions') && !authId(req)) return send(res,401,{error:'Требуется вход'});
    if (url.pathname.startsWith('/api/sessions') && req.method === 'POST' && req.headers['x-storage-consent'] !== 'accepted') return send(res,403,{error:'Требуется согласие на хранение данных'});
    if (req.method === 'GET' && url.pathname === '/api/sessions') return send(res, 200, runtime.listSessions(authId(req)));
    if (req.method === 'POST' && url.pathname === '/api/sessions') { const ownerId = authId(req); if (!ownerId || (aiMode!=='ollama' && !(aiMode==='donor'&&accounts.getAiSource(ownerId)==='donor') && !accounts.getProviders(ownerId))) return send(res, 403, { error: 'Добавьте ключ AI-сценариста в профиле' }); const data = await body(req); return send(res, 201, runtime.create(data.gameId, ownerId)); }
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/); const turnMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/turns$/);
    if (sessionMatch && req.method === 'GET') return send(res, 200, runtime.get(sessionMatch[1], authId(req)));
    const pendingMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/pending-turn$/);
    if (pendingMatch && req.method === 'GET' && queue) { const ownerId=authId(req)!; runtime.get(pendingMatch[1],ownerId); const pending=queue.pending(pendingMatch[1],ownerId); return send(res,200,pending?queue.view(pending.id,ownerId):{status:'idle'}); }
    const jobMatch = url.pathname.match(/^\/api\/turn-jobs\/([^/]+)$/);
    if (jobMatch && queue) { const ownerId=authId(req); if (!ownerId) return send(res,401,{error:'Требуется вход'}); if(req.method==='GET')return send(res,200,queue.view(jobMatch[1],ownerId)); if(req.method==='DELETE')return send(res,200,queue.cancel(jobMatch[1],ownerId)); }
    if (turnMatch && req.method === 'POST') { const userId = authId(req); if (!userId) return send(res,401,{error:'Требуется вход'}); const action=await body(req) as Action; if(queue&&accounts.getAiSource(userId)==='donor')return send(res,202,queue.enqueue(turnMatch[1],userId,action)); if(queue?.pending(turnMatch[1],userId))return send(res,409,{error:'Предыдущий ход ещё обрабатывается'}); const config = aiMode !== 'ollama' ? accounts.getProviders(userId) : undefined; if (aiMode !== 'ollama' && !config) return send(res,403,{error:'Добавьте ключ AI-сценариста в профиле'}); const primary = aiMode === 'ollama' ? new OllamaAIProvider() : new RemoteAIProvider(config!.provider,config!.keys,config!.model); return send(res,200,await runtime.turn(turnMatch[1],action,primary,userId)); }
    send(res, 404, { error: 'Not found' });
  } catch (error) { if(error instanceof DailyLimitError)return send(res,402,{error:error.message,code:error.code,resetAt:error.resetAt});const status=Number((error as Error&{status?:number})?.status);if(Number.isInteger(status)&&status>=400&&status<500)return send(res,status,{error:error instanceof Error?error.message:'Некорректный запрос'});console.error('Request failed:',error instanceof Error?error.message:'unknown error');return send(res,500,{error:'Внутренняя ошибка сервера'}); }
});
if(deviceRegistry&&donorPool){connectTransport=new ConnectTransport(server,deviceRegistry,donorPool);queue=new TurnQueue(runtime,accounts,donorPool,join(root,'..','data','turn-jobs.json'),connectTransport,coauthorUsage)}
let shuttingDown=false;
function shutdown(){if(shuttingDown)return;shuttingDown=true;connectTransport?.close();const force=setTimeout(()=>{server.closeAllConnections();process.exit(1)},15_000);force.unref();server.close(error=>{clearTimeout(force);if(error){console.error('HTTP shutdown failed:',error.message);process.exitCode=1}else process.exitCode=0})}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
const port = Number(process.env.PORT || 3000),host=process.env.HOST||'127.0.0.1'; server.listen(port,host,() => console.log(`OpenGames Beta: http://${host}:${port} (user provider)`));
