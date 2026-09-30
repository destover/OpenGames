import type { Action } from './types.ts';


const STOP_WORDS = new Set([
  'и','в','на','с','по','из','от','за','до','для','не','что','как','к','у','же','под','над','при','без','через','там','тут','здесь',
  'этот','эта','эти','это','тот','та','те','он','она','они','оно','мы','вы','её','ее','их','мой','моя','твой','свой','свои','своим','свою',
  'себя','себе','уже','ещё','еще','быть','есть','так','все','всё','весь','вся','очень','более','менее','снова','опять','если','чтобы',
  'после','перед','между','про','над','один','одна','одну','новый','нова','новое','старый','первый','следующий','каждый','другой','другая',
  'другую','сам','сама','самой','всех','всеми','каждого','нового','старого','который','которая','это','либо','чем','бы',
  'the','a','an','and','or','of','to','in','on','at','for','with','by','is','are','be','it','its','this','that','then','into','from','as','own','same','new','old','again','an','some'
]);

const FILLER_WORDS = new Set([
  'попытаться','попробовать','пытаться','попытаемся','начать','начинать','сделать','делать','можно','нужно','следует','стоит','имеет смысл',
  'имеет','смысл','получится','получилось','выглядит','кажется','похоже','стоит ли','try','attempt','start','begin','make','should','could','would','need'
]);

const FILLER_PHRASES = ['собственным планом', 'своим планом', 'новым наблюдением', 'в пределах', 'по возможности', 'если получится', 'стоит ли'];

const OBSERVE = ['осмотр','изуч','исслед','обслед','просмотр','пересмотр','провер','проверить','свер','сверить','уточн','сопостав','сравн','измер','замер','прислуш','послуш','выслуш','изуч','заглян','заглянуть','глянуть','смотреть','осматривать','контрол','тест','проверка','наблюд','наблюдать'];
const TALK = ['поговори','спрос','допрос','расспрос','обсуди','переговор','соглас','координ','координир','уведом','сообщ','пригласи','договори','спросить','вопрос','опрос'];
const DECIDE = ['реши','выбр','определ','приоритет','выбрать','остановить','остав'];
const MOVE = ['перенес','перемест','перевез','перестав','перестро','переключ','перевод','отправ','пройд','дойд','двинут','идти','пойд','покид','запират','вывести','выводить','рассредот','развести','разнести'];
const FIX = ['почин','ремонт','замен','восстанов','отремонт','устрани','починить','перебрать','собрать заново'];
const SECURE = ['изолир','опечат','оград','перекры','герметиз','закреп','защит','укреп','закры','заблокир','оцепить','оцеп'];
const RECORD = ['зафиксир','задокумент','сфотограф','фото','описать','записы','запис','внести','сделать запись','протокол'];
const COLLECT = ['собра','собир','набра','заготовить','запасти','добыть'];
const SEARCH = ['иска','поиск','найд','обыскат','обыск','розыск','разыска','выследить','выслеж'];
const SHARE = ['подел','раздел','передать','передав','отдать','выделить','обеспеч','снабж'];
const REST = ['отдох','отдых','передох','перерыв','поспа','успок'];
const WRITE = ['написа','состави','подгот','заполн','оформ','разработа','изгот'];
const MEASURE_NUM = ['посчита','подсчита','пересчита','сверить счет','норм'];
const REPAIR_LOC = ['подня','сложить','сложить в'];

const FAMILIES: string[][] = [OBSERVE, TALK, DECIDE, MOVE, FIX, SECURE, RECORD, COLLECT, SEARCH, SHARE, REST, WRITE, MEASURE_NUM, REPAIR_LOC];

const ENDINGS = [
  'ированием','ированию','ирование','ование','овать','ывание','ывать','аться','яться','иться','ться','ание','ать','ять','ить','еть','уть','ыть',
  'ился','илась','ились','ается','яется','ются','аются','ится','ется','ешь','ишь','ем','им','ом','ах','ях','ов','ев','ей','ой',
  'ый','ий','ая','яя','ое','ее','ые','ие','ам','ям','ую','юю','ла','ло','ли','ть','ок','ь','ы','и','у','ю','а','я','о','е'
];

const MIN_STEM = 4;

function stem(word: string): string {
  if (word.length <= MIN_STEM) return word;
  let value = word;
  for (const ending of ENDINGS) {
    if (value.length - ending.length >= MIN_STEM && value.endsWith(ending)) { value = value.slice(0, value.length - ending.length); break; }
  }
  return value;
}

function familyIndex(stems: Set<string>): number {
  for (let index = 0; index < FAMILIES.length; index++) for (const prefix of FAMILIES[index]) for (const value of stems) if (value.startsWith(prefix) || prefix.startsWith(value)) return index;
  return -1;
}

function cleanText(text: string): string {
  let value = text.toLocaleLowerCase().replace(/ё/g, 'е');
  value = value.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}\u{200D}]/gu, ' ');
  value = value.replace(/[«»"'“”‘’()\[\]{}<>*_`~—–-]+/g, ' ');
  for (const phrase of FILLER_PHRASES) value = value.split(phrase).join(' ');
  return value;
}

export interface IntentTokens { stems: Set<string>; family: number; text: string }

const QUOTED_SPAN = /[«»][^«»]*[«»]|[“"][^“”]*[“"]/g;

function tokens(text: string | undefined | null, keepQuotes = false): IntentTokens {
  const raw = typeof text === 'string' ? text : '';
  const cleaned = cleanText(keepQuotes ? raw : raw.replace(QUOTED_SPAN, ' '));
  const stems = new Set<string>();
  for (const word of cleaned.match(/[\p{L}\p{N}]+/gu) || []) {
    if (word.length < 3 || STOP_WORDS.has(word) || FILLER_WORDS.has(word)) continue;
    const value = stem(word);
    if (value.length >= 3) stems.add(value);
  }
  return { stems, family: familyIndex(stems), text: [...stems].sort().join(' ') };
}

export function intentTokens(text: string | undefined | null): IntentTokens { return tokens(text); }

function isFamilyStem(value: string): boolean {
  for (const family of FAMILIES) for (const prefix of family) if (value.startsWith(prefix) || prefix.startsWith(value)) return true;
  return false;
}

function sameStem(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length >= 5 && right.startsWith(left)) return true;
  return right.length >= 5 && left.startsWith(right);
}

export function intentSimilarity(left: string | undefined | null, right: string | undefined | null): number {
  const base = score(tokens(left), tokens(right));
  const mutualQuote = [left, right].every(text => typeof text === 'string' && /[«»]/.test(text));
  return mutualQuote ? Math.max(base, score(tokens(left, true), tokens(right, true))) : base;
}

function score(a: IntentTokens, b: IntentTokens): number {
  if (!a.stems.size || !b.stems.size) return a.text && a.text === b.text ? 1 : 0;
  const shared = [...a.stems].filter(value => [...b.stems].some(other => sameStem(value, other)));
  if (!shared.length) return 0;
  const union = a.stems.size + b.stems.size - shared.length;
  const jaccard = union ? shared.length / union : 0;
  const sameFamily = a.family >= 0 && a.family === b.family;
  const sharedObjects = shared.filter(value => !isFamilyStem(value));
  if (sharedObjects.length) return Math.min(1, shared.length / Math.min(a.stems.size, b.stems.size) + (sameFamily ? 0.3 : 0));
  if (jaccard < 0.35 || shared.length / Math.min(a.stems.size, b.stems.size) < 0.34) return 0;
  return Math.min(1, jaccard + (sameFamily ? 0.3 : 0));
}

export const DUPLICATE_INTENT = 0.55;
export const COVERS_BUTTON = 0.7;

export function sameIntent(left: string | undefined | null, right: string | undefined | null, threshold = DUPLICATE_INTENT): boolean {
  const a = typeof left === 'string' ? left.trim() : '', b = typeof right === 'string' ? right.trim() : '';
  if (!a || !b) return false;
  if (a.toLocaleLowerCase() === b.toLocaleLowerCase()) return true;
  return intentSimilarity(a, b) >= threshold;
}

export function sameVerbFamily(left: string | undefined | null, right: string | undefined | null): boolean {
  const a = tokens(left).family, b = tokens(right).family;
  return a < 0 || b < 0 || a === b;
}

export function coversIntent(suggestion: string | undefined | null, label: string | undefined | null): boolean {
  return sameVerbFamily(suggestion, label) && sameIntent(suggestion, label, COVERS_BUTTON);
}

export function exactKey(text: string | undefined | null): string {
  return cleanText(typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim();
}

export function selectDistinctOptions(list: Action[], spentNow: string[], spentBefore: string[] = [], limit = 3): Action[] {
  const blocked = new Set(spentBefore.map(exactKey).filter(Boolean));
  const pick = (source: Action[], spent: string[]) => {
    const result: Action[] = [];
    for (const index of dropDuplicateIntents(source.map(item => item.text || ''))) {
      if (result.length >= limit) break;
      if (spent.some(text => sameIntent(source[index].text || '', text))) continue;
      result.push(source[index]);
    }
    return result;
  };
  const strict = pick(list.filter(item => !blocked.has(exactKey(item.text || ''))), [...spentNow, ...spentBefore]);
  return strict.length || !spentBefore.length ? strict : pick(list, spentNow);
}

export function dropDuplicateIntents(texts: Array<string | undefined | null>, threshold = DUPLICATE_INTENT): number[] {
  const kept: number[] = [];
  for (let index = 0; index < texts.length; index++) {
    const text = (texts[index] || '').trim();
    if (!text) continue;
    const repeated = kept.some(position => sameIntent(text, texts[position] || '', threshold));
    if (!repeated) kept.push(index);
  }
  return kept;
}