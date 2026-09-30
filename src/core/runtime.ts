import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { coversIntent, dropDuplicateIntents, selectDistinctOptions } from './similarity.ts';
import type { Action, GamePackage, Session } from './types.ts';
import { StateEngine } from './engine.ts';
import type { AIProvider, AIRequestOptions, AIResult } from './ai.ts';
import { DonorUnavailableError } from './donor.ts';
import { LocalSaveSystem } from './save.ts';
import { validateGamePackage } from './schema.ts';

function preparedFallbackNarrative(game: GamePackage, action: Action, language: 'ru' | 'en', repetitions = 0) {
  const label = action.type === 'free_text' ? action.text || '' : game.i18n?.[language]?.actions?.[action.type] || game.actions[action.type]?.label || action.type;
  const probe = `${action.type} ${label}`.toLocaleLowerCase();
  const category = language === 'ru'
    ? /отдох|rest/.test(probe) ? 'rest' : /соб|запас|ресурс|подготовить материалы|gather|collect|supply/.test(probe) ? 'resource' : /переговор|соглас|обсуд|допрос|спрос|сообщ|передать|коорд|приглас|talk|mediate|ask|offer|communicat|coordinate|relay/.test(probe) ? 'people' : /маршрут|план|распредел|назнач|распис|приоритет|выбрать интервал|route|plan|schedule|prioriti|allocate|assign/.test(probe) ? 'plan' : /перейти|тропа|следопыт|осмотреть долину|scout|track|cross|explore/.test(probe) ? 'explore' : /укреп|ремонт|закреп|изол|перекры|усил|перемест|перестав|поворот|почин|adjust|repair|reinforc|anchor|isolate|secure|move|shunt|tune|lock/.test(probe) ? 'intervene' : 'verify'
    : /rest|pause|wait/.test(probe) ? 'rest' : /gather|collect|suppl|stock|prepare material/.test(probe) ? 'resource' : /negotiat|agree|discuss|question|ask|communicat|invite|mediate|relay|coordinate|broadcast/.test(probe) ? 'people' : /route|plan|schedule|prioriti|allocate|assign|slot|organ/.test(probe) ? 'plan' : /scout|track|cross|explore|survey|inspect terrain/.test(probe) ? 'explore' : /reinforc|repair|anchor|isolate|secure|move|shunt|tune|lock|adjust|seal|stabiliz/.test(probe) ? 'intervene' : 'verify';
  const lines: Record<string, string[]> = language === 'ru' ? {
    rest: ['Вы делаете паузу, сохраняя внимание к обстановке. Время идёт, поэтому после неё условия нужно проверить заново, прежде чем считать положение безопасным.', 'Вы остаетесь на месте и даёте себе короткую передышку. За это время обстановка успевает немного измениться; перед следующим шагом нужно заново оценить риск.'],
    resource: ['Вы направляете усилия на ближайший доступный запас и оцениваете, чего он действительно позволит добиться. Это поддерживает дальнейшую работу, но не снимает исходную неопределённость.', 'Вы проверяете доступный ресурс и распределяете усилия без предположения, что запаса хватит надолго. Теперь следующий выбор можно соотнести с тем, что действительно осталось.'],
    people: ['Вы обращаетесь к тем, чьи сведения или согласие важны для этого шага. Ответ уточняет границы возможного; молчание и несогласие не принимаются за одобрение.', 'Выносите предложение на обсуждение и выясняете, какие условия участники готовы принять. Общая позиция пока не достигнута, зато разногласие больше не скрыто за общими словами.'],
    plan: ['Вы переводите намерение в последовательность выполнимых шагов и отмечаете зависимость, которую нельзя пропустить. План проясняет следующий ход, но ещё не означает, что результат достигнут.', 'Вы перестраиваете порядок действий с учётом текущего ограничения. Это убирает одну организационную неопределённость; саму проблему всё ещё нужно проверить на месте.'],
    explore: ['Вы расширяете обзор и фиксируете то, что действительно видно с выбранной точки. Новая деталь помогает выбрать направление, но сама по себе ещё не подтверждает причину происходящего.', 'Вы осматриваете доступный участок и отмечаете, где заканчивается уверенное наблюдение. Картина стала шире, но вывод о причине пока делать рано.'],
    intervene: ['Вы меняете ближайшее условие ровно настолько, насколько требует выбранное действие. Это снимает одну практическую помеху, но создаёт необходимость проверить побочный эффект.', 'Вы выполняете ограниченное вмешательство и фиксируете исходные условия для сравнения. Непосредственная помеха уменьшилась; теперь важно проверить, не возникла ли новая.'],
    verify: ['Вы проверяете выбранный признак по доступному источнику и отделяете наблюдение от вывода. Неопределённость становится уже, хотя первопричина пока не доказана.', 'Вы повторно сверяете данные, обращая внимание на источник и момент наблюдения. Это уточняет, чему можно доверять сейчас, но окончательного объяснения ещё нет.']
  } : {
    rest: ['You pause while keeping watch on the situation. Time continues to pass, so the conditions must be checked again before the position can be called safe.', 'You stay where you are and take a brief pause. The situation shifts slightly while you wait, so the risk needs a fresh assessment before the next move.'],
    resource: ['You focus effort on the nearest available supply and assess what it can actually support. This helps the next step but does not resolve the original uncertainty.', 'You check the available resource and distribute effort without assuming it will last. The next choice can now be weighed against what is actually left.'],
    people: ['You approach the people whose information or agreement matters to this step. Their replies clarify what is possible; silence and disagreement are not treated as consent.', 'You put the proposal to the people affected and find out which conditions they can accept. Agreement has not been reached, but the disagreement is no longer hidden behind general assurances.'],
    plan: ['You turn the intention into a sequence of workable steps and identify a dependency that cannot be skipped. The plan clarifies what comes next, but does not claim the result has already been achieved.', 'You rearrange the sequence around the current constraint. This removes one planning uncertainty; the underlying problem still needs to be checked on site.'],
    explore: ['You widen the view and record what is actually visible from the chosen position. A new detail helps set direction, but does not by itself establish the cause.', 'You inspect the accessible area and mark where reliable observation ends. The picture is wider now, but it is too early to claim a cause.'],
    intervene: ['You change the immediate condition only as far as the chosen action requires. This removes one practical obstacle, while making a check for side effects necessary.', 'You make a limited intervention and record the baseline for comparison. The immediate obstacle is smaller; now you need to check whether another one has appeared.'],
    verify: ['You check the chosen sign against an available source and separate observation from interpretation. The uncertainty narrows, though the root cause is not yet proven.', 'You repeat the check, paying attention to its source and timing. This clarifies what can be trusted now, though it still does not provide a final explanation.']
  };
  const prefix = action.type === 'free_text' ? (language === 'ru' ? `Вы пробуете собственный план: «${label}». ` : `You try your own plan: “${label}.” `) : (language === 'ru' ? `«${label}». ` : `“${label}.” `);
  return prefix + lines[category][repetitions % lines[category].length];
}

const SELF_TEMPLATE_PREFIXES = ['Проверить, что изменил', 'Проверить последствия', 'Сопоставить ', 'Развить результат', 'Осмотреться на месте', 'Двигаться к цели', 'Check what', 'Compare “', 'Build on the result', 'Look around the current place', 'Move toward the objective'];

function languageOf(action: Action): 'ru' | 'en' { return action.language?.toLowerCase().startsWith('en') ? 'en' : 'ru'; }

function distinctOptions(game: GamePackage, session: Session, list: Action[], action: Action, language: 'ru' | 'en'): Action[] {
  const spent = spentIntents(game, session, language);
  spent.push(action.type === 'free_text' ? action.text || '' : game.i18n?.[language]?.actions?.[action.type] || game.actions[action.type]?.label || action.type);
  const before = (session.suggestions || []).map(item => item.text || '');
  const usedTypes = new Set(session.turns.map(turn => turn.action.type));
  const picked = selectDistinctOptions(list.filter(item => item && game.actions[item.type]), spent.filter(Boolean), before);
  return picked.map(item => {
    if (item.type !== 'free_text') return item;
    const covers = Object.entries(game.actions)
      .filter(([type]) => type !== 'free_text' && !usedTypes.has(type) && !picked.some(other => other.type === type))
      .filter(([type]) => coversIntent(item.text || '', game.i18n?.[language]?.actions?.[type] || game.actions[type]?.label || ''))
      .map(([type]) => type);
    return covers.length ? { ...item, covers } : item;
  });
}

function spentIntents(game: GamePackage, session: Session, language: 'ru' | 'en' = 'ru'): string[] {
  return session.turns.map(turn => turn.action.type === 'free_text' ? turn.action.text || '' : game.i18n?.[language]?.actions?.[turn.action.type] || game.actions[turn.action.type]?.label || turn.action.type).filter(Boolean);
}

function preparedFallbackSuggestions(game: GamePackage, session: Session, language: 'ru' | 'en') {
  const last = session.turns.at(-1);
  const lastAction = last ? (last.action.type === 'free_text' ? last.action.text || '' : game.i18n?.[language]?.actions?.[last.action.type] || game.actions[last.action.type]?.label || last.action.type) : '';
  const goal = game.goal?.description?.[language] || game.goal?.label?.[language] || game.manifest.description;
  const place = last?.location ? game.map?.locations?.[last.location]?.[language] : undefined;
  const quoted = lastAction && !SELF_TEMPLATE_PREFIXES.some(prefix => lastAction.startsWith(prefix)) ? lastAction.replace(/[«»"“”]/g, '').slice(0, 60) : '';
  const pool = language === 'ru' ? [
    quoted ? `Проверить, что изменил шаг «${quoted}», и не пропустить последствие.` : 'Проверить по наблюдениям, что изменилось за последний шаг.',
    `Осмотреться на месте и взять новую улику${place ? `: ${place}` : '.'}`,
    'Двигаться к цели собственным планом, не повторяя уже сделанное.',
    'Выбрать один приоритет и объяснить, чем придётся пожертвовать ради цели.',
    `Понаблюдать за обстановкой, ничего не меняя${place ? ` на ${place}` : ''}.`,
    Array.isArray(session.state.inventory) && session.state.inventory.length
      ? `Собрать недостающее для следующего шага: ${(session.state.inventory as string[]).slice(-3).join(', ')}.`
      : 'Собрать то, чего не хватает для следующего шага, и решить, без чего можно обойтись.'
  ] : [
    quoted ? `Check what “${quoted}” changed and catch the consequence.` : 'Check by observation what the last step changed.',
    `Look around the current place for a new clue${place ? `: ${place}` : '.'}`,
    'Move toward the objective with your own plan, without repeating what is already done.',
    'Pick one priority and say what has to be sacrificed for the objective.',
    `Watch the situation without changing anything${place ? ` at ${place}` : ''}.`,
    Array.isArray(session.state.inventory) && session.state.inventory.length
      ? `Gather what the next step is missing: ${(session.state.inventory as string[]).slice(-3).join(', ')}.`
      : 'Gather what the next step is missing and decide what can be given up.'
  ];
  const offset = session.turns.length * 3 % pool.length;
  const ordered = pool.map((_, index) => pool[(index + offset) % pool.length]);
  const spent = spentIntents(game, session, language);
  const kept = dropDuplicateIntents([...ordered, ...spent]).filter(index => index < ordered.length);
  return kept.map(index => ({ type: 'free_text', text: ordered[index], icon: '✦' }));
}

export class GameRuntime {
  private readonly pending = new Set<string>();
  private readonly sessions = new Map<string, Session>();
  private readonly engines = new Map<string, StateEngine>();
  private readonly games: Map<string, GamePackage>;
  private readonly ai: AIProvider;
  private readonly saves: LocalSaveSystem;
  private publication:Record<string,boolean>={};
  private readonly publicationPath?:string;
  constructor(games: Map<string, GamePackage>, ai: AIProvider, saves: LocalSaveSystem, publicationPath?:string) {
    this.publicationPath=publicationPath;
    if(publicationPath&&existsSync(publicationPath))this.publication=JSON.parse(readFileSync(publicationPath,'utf8'));
    this.games = games; this.ai = ai;
    this.saves = saves;
    for (const [id, game] of games) { validateGamePackage(game); this.engines.set(id, new StateEngine(game)); }
    for (const session of saves.all()) if (this.games.has(session.gameId)) {
      const game = this.games.get(session.gameId)!;
      const needsMigration = session.packageVersion !== game.manifest.version || session.schemaVersion !== game.manifest.schemaVersion;
      const sameMajor = session.packageVersion.split('.')[0] === game.manifest.version.split('.')[0];
      const schemaUpgrade = Number(session.schemaVersion) < Number(game.manifest.schemaVersion);
      const oldVersion = session.packageVersion.split('.').map(Number), newVersion = game.manifest.version.split('.').map(Number);
      const compatiblePackageUpdate = session.schemaVersion === game.manifest.schemaVersion && oldVersion.length === 3 && newVersion.length === 3 && oldVersion.every(Number.isFinite) && newVersion.every(Number.isFinite) && newVersion[1] >= oldVersion[1] && newVersion[1] - oldVersion[1] <= 1 && newVersion[2] >= 0 && session.packageVersion !== game.manifest.version;
      const canMigrate = !!game.boundaries && sameMajor && (schemaUpgrade || compatiblePackageUpdate);
      if (needsMigration && !canMigrate) continue;
      let defaultsAdded = false;
      for (const [key, value] of Object.entries(game.state.initial)) if (!(key in session.state)) { session.state[key] = structuredClone(value); defaultsAdded = true; }
      if (canMigrate) {
        if (session.state.ended === true && game.goal?.completion) session.state[game.goal.completion.path] = game.goal.completion.value;
        session.packageVersion = game.manifest.version; session.schemaVersion = game.manifest.schemaVersion; defaultsAdded = true;
      }
      if (defaultsAdded) this.saves.save(session);
      if (session.state.goalProgress === undefined && game.goal?.actions) {
        let progress = 0;
        for (const turn of session.turns) { const expected = game.rules?.transitions[game.goal.actions[progress]]?.event; if (expected && turn.events.some(event => event.type === expected)) progress++; }
        session.state.goalProgress = progress; session.state.ended = progress === game.goal.actions.length; delete session.state.endedReason;
        session.state.pacing = 'normal'; this.saves.save(session);
      }
      this.sessions.set(session.id, session);
    }
  }
  listGames(includeUnpublished=false) { return [...this.games.values()].filter(game=>includeUnpublished||this.isPublished(game.manifest.id)).map(({ manifest, ui, actions, i18n, goal, map, opening }) => ({ manifest, ui, actions, i18n, goal, map, opening })); }
  isPublished(id:string){return this.publication[id]!==false}
  setPublished(id:string,published:boolean){const game=this.games.get(id);if(!game)throw Object.assign(new Error('Игра не найдена'),{status:404});if(published)validateGamePackage(game);const next={...this.publication,[id]:published};if(this.publicationPath){mkdirSync(dirname(this.publicationPath),{recursive:true,mode:0o700});writeFileSync(this.publicationPath+'.tmp',JSON.stringify(next,null,2),{mode:0o600});renameSync(this.publicationPath+'.tmp',this.publicationPath)}this.publication=next;return {id,published}}
  sessionPackage(id:string,ownerId?:string){const session=this.get(id,ownerId);return this.listGames(true).find(game=>game.manifest.id===session.gameId)!}
  gamePackage(id:string){return this.games.get(id)}
  validateGamePackageUpdate(id:string,game:GamePackage){if(!this.games.has(id)||game.manifest.id!==id)throw new Error('Игра не найдена');validateGamePackage(game);return true}
  replaceGamePackage(id:string,game:GamePackage){this.validateGamePackageUpdate(id,game);this.games.set(id,structuredClone(game));this.engines.set(id,new StateEngine(game));return this.games.get(id)!}
  listPopularGames(includeUnpublished=false) {
    const stats=new Map<string,{gameId:string;players:Set<string>;sessions:number;turns:number}>();
    for(const session of this.sessions.values()){const item=stats.get(session.gameId)||{gameId:session.gameId,players:new Set<string>(),sessions:0,turns:0};if(session.ownerId)item.players.add(session.ownerId);item.sessions++;item.turns+=session.turns.length;stats.set(session.gameId,item)}
    return [...this.games.keys()].filter(id=>includeUnpublished||this.isPublished(id)).map(gameId=>{const item=stats.get(gameId);return {gameId,players:item?.players.size||0,sessions:item?.sessions||0,turns:item?.turns||0}}).sort((a,b)=>b.players-a.players||b.sessions-a.sessions||b.turns-a.turns||a.gameId.localeCompare(b.gameId));
  }
  create(gameId: string, ownerId?: string) {
    const game = this.games.get(gameId); if (!game) throw Object.assign(new Error('Игра не найдена'),{status:404});if(!this.isPublished(gameId))throw Object.assign(new Error('Игра снята с публикации'),{status:409});
    const now = new Date().toISOString(); const session: Session = { id: randomUUID(), gameId, ownerId, packageVersion: game.manifest.version, schemaVersion: game.manifest.schemaVersion, state: { ...structuredClone(game.state.initial), ...(game.goal?.actions ? { goalProgress: 0 } : {}), engagement: 50, pacing: 'normal', location: game.map?.start || '' }, turns: [], createdAt: now, updatedAt: now };
    this.sessions.set(session.id, session); this.saves.save(session); return session;
  }
  get(id: string, ownerId?: string) { const session = this.sessions.get(id); if (!session || (!ownerId || session.ownerId !== ownerId)) throw new Error('Сессия не найдена'); return session; }
  listSessions(ownerId?: string) { return [...this.sessions.values()].filter(session => !!ownerId && session.ownerId === ownerId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(session => ({ id: session.id, gameId: session.gameId, turns: session.turns.length, updatedAt: session.updatedAt, completed: session.state.ended === true })); }
  adminSessions(){return [...this.sessions.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(({id,gameId,ownerId,packageVersion,schemaVersion,state,turns,createdAt,updatedAt})=>({id,gameId,ownerId,packageVersion,schemaVersion,state,turns,createdAt,updatedAt}))}
  adminSessionsPage(offset=0,limit=50){const items=this.adminSessions(),page=items.slice(offset,offset+limit);return {items:page,total:items.length,offset,limit,nextOffset:offset+page.length}}
  adminReplaceSession(id:string,session:Session){if(!this.sessions.has(id)||session.id!==id||!this.games.has(session.gameId)||!session.state||!Array.isArray(session.turns))throw new Error('Некорректная сессия');const game=this.games.get(session.gameId)!;if(session.schemaVersion!==game.manifest.schemaVersion||session.packageVersion!==game.manifest.version)throw new Error('Версия пакета сессии должна совпадать с текущей');if(Object.keys(session.state).length>300||session.turns.length>10000)throw new Error('Слишком большой документ сессии');const safe=structuredClone(session);safe.updatedAt=new Date().toISOString();this.saves.save(safe);this.sessions.set(id,safe);return structuredClone(safe)}
  async turn(id: string, action: Action, aiOverride?: AIProvider, ownerId?: string, options?: AIRequestOptions) {
    const session = this.get(id, ownerId); const game = this.games.get(session.gameId)!; const engine = this.engines.get(session.gameId)!;
    if (action.requestId) {
      const previous = session.turns.find(turn => turn.action.requestId === action.requestId);
      if (previous) return { session, narrative: previous.narrative, suggestions: [] };
    }
    if (this.pending.has(id)) throw new Error('Предыдущее действие ещё обрабатывается');
    this.pending.add(id);
    try {
      engine.validateAction(action, session.state);
      const provider = aiOverride || this.ai;
      let result: AIResult | undefined, next: Session | undefined, correction: string | undefined;
      let aiResponseMs = 0;
      const callAI = async (requestOptions?: AIRequestOptions) => {
        const startedAt = Date.now();
        try { return await provider.generate(game, session, action, correction, requestOptions); }
        finally { aiResponseMs += Date.now() - startedAt; }
      };
      const localController=options?.signal?undefined:new AbortController();
      const providerOptions={...options,signal:options?.signal||localController!.signal};
      let timer: ReturnType<typeof setTimeout>|undefined,response:AIResult|null;
      try{
        response=options?.signal?await callAI(providerOptions):await Promise.race([callAI(providerOptions).catch(error=>{if(error instanceof DonorUnavailableError)throw error;return null}),new Promise<null>(resolve=>{timer=setTimeout(()=>{localController!.abort(new Error('AI response deadline exceeded'));resolve(null)},30000)})]);
      }finally{if(timer)clearTimeout(timer)}
      if (response) {
        result = response;
        next = engine.apply(session, action, result.events, result.narrative, result.stateMutation || [], aiResponseMs);
      } else {
        const language = languageOf(action);
        const repetitions = session.turns.filter(turn => turn.action.type === action.type).length;
        result = { narrative: preparedFallbackNarrative(game, action, language, repetitions), events: [], stateMutation: [], suggestions: preparedFallbackSuggestions(game, session, language), source: 'local' };
        next = engine.apply(session, action, result.events, result.narrative, result.stateMutation, 8000);
      }
      if (!result || !next) throw new Error('Не удалось согласовать состояние с правилами мира');
      Object.assign(next.turns.at(-1)!, { source: result.source, stateMutation: result.stateMutation || [] });
      next.suggestions = distinctOptions(game, session, result.suggestions, action, languageOf(action));
      next.suggestionLanguage = action.language || 'ru';
      this.saves.save(next); this.sessions.set(id, next);
      return { session: next, narrative: result.narrative, suggestions: next.suggestions, source: result.source };
    } finally { this.pending.delete(id); }
  }

  save(id: string, ownerId?: string) { return structuredClone(this.get(id, ownerId)); }
}
