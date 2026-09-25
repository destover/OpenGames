import type { Action, Event, GamePackage, Json, Session, StateMutationProposal } from './types.ts';

function record(value: unknown): value is Record<string, Json> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function readPath(value: Record<string, Json>, path: string): Json | undefined { return path.split('.').reduce<any>((node, key) => record(node) ? node[key] : undefined, value); }
function writePath(value: Record<string, Json>, path: string, update: (current: Json | undefined) => Json) {
  const parts = path.split('.'); let node = value;
  for (const key of parts.slice(0, -1)) { if (!record(node[key])) node[key] = {}; node = node[key] as Record<string, Json>; }
  const key = parts.at(-1)!; node[key] = update(node[key]);
}

export class StateEngine {
  private readonly game: GamePackage;
  constructor(game: GamePackage) { this.game = game; }

  validateAction(action: Action, state: Record<string, Json>) {
    if (!action || typeof action.type !== 'string' || action.type.length > 80) throw new Error('Действие имеет неверный формат');
    if (state.ended === true) throw new Error('Игра уже завершена');
    const definition = this.game.actions[action.type];
    if (this.game.rules?.transitions && !definition) throw new Error(`Действие не поддерживается: ${action.type}`);
    if (definition?.input && (!action.text || !action.text.trim())) throw new Error('Введите текст действия');
    if (action.type === 'free_text' && (!action.text || !action.text.trim() || action.text.length > 1000)) throw new Error('Опишите действие (не более 1000 символов)');
    if (!definition && (!action.text || !action.text.trim() || action.text.length > 1000)) throw new Error('Опишите действие (не более 1000 символов)');
  }

  private ruleForEvent(type: string) {
    const transitions = this.game.rules?.transitions || {};
    return transitions[type] || Object.values(transitions).find(rule => rule.event === type);
  }

  private applyMutations(state: Record<string, Json>, mutations: StateMutationProposal[], previous: Record<string, Json>) {
    const boundaries = this.game.boundaries!;
    const protectedPaths = new Set(['ended', 'endedReason', 'goalProgress', 'engagement', 'pacing', 'lastEvent']);
    for (const mutation of mutations) {
      const path = mutation.path;
      const allowed = boundaries.mutationPaths.some(rule => rule.endsWith('.*') ? path.startsWith(rule.slice(0, -1)) : path === rule);
      if (!allowed || protectedPaths.has(path.split('.')[0]) || boundaries.immutablePaths?.some(item => path === item || path.startsWith(item + '.'))) throw new Error(`Изменение состояния вне границ пакета: ${path}`);
      writePath(state, path, current => {
        if (mutation.op === 'set') return structuredClone(mutation.value);
        if (mutation.op === 'increment') {
          if (typeof current !== 'number') throw new Error(`Нельзя изменить нечисловое поле: ${path}`);
          return current + mutation.amount;
        }
        if (!Array.isArray(current)) throw new Error(`Поле должно быть списком: ${path}`);
        const items = structuredClone(current);
        if (mutation.op === 'append') items.push(structuredClone(mutation.value));
        else { const index = items.findIndex(item => JSON.stringify(item) === JSON.stringify(mutation.value)); if (index >= 0) items.splice(index, 1); }
        return items;
      });
    }
    this.validateState(state);
    for (const rule of boundaries.stateChangeRules || []) {
      const before = readPath(previous, rule.path), after = readPath(state, rule.path);
      if (typeof before !== 'number' || typeof after !== 'number' || after <= before) continue;
      if (rule.increaseRequires) {
        const prerequisite = readPath(state, rule.increaseRequires.path);
        if (!rule.increaseRequires.oneOf.some(value => JSON.stringify(value) === JSON.stringify(prerequisite))) throw new Error(`Увеличение ${rule.path} недоступно при текущем значении ${rule.increaseRequires.path}`);
      }
      if (rule.maxIncrease !== undefined && after - before > rule.maxIncrease) throw new Error(`Превышено допустимое увеличение ${rule.path}: максимум ${rule.maxIncrease} за ход`);
    }
  }

  private validateState(state: Record<string, Json>) {
    const boundaries = this.game.boundaries!;
    for (const [path, { min, max }] of Object.entries(boundaries.numericBounds || {})) {
      const value = readPath(state, path);
      if (typeof value !== 'number' || value < min || value > max) throw new Error(`Нарушено ограничение состояния: ${path} (${min}–${max})`);
    }
    for (const [path, values] of Object.entries(boundaries.allowedValues || {})) {
      if (path.endsWith('[]')) continue;
      const value = readPath(state, path);
      if (!values.some(item => JSON.stringify(item) === JSON.stringify(value))) throw new Error(`Недопустимое значение состояния: ${path}`);
    }
    for (const [path, limit] of Object.entries(boundaries.maxArrayItems || {})) {
      const value = readPath(state, path);
      if (!Array.isArray(value) || value.length > limit) throw new Error(`Превышен размер списка: ${path}`);
      const allowedItems = boundaries.allowedValues?.[path + '[]'];
      if (allowedItems && value.some(item => !allowedItems.some(allowed => JSON.stringify(allowed) === JSON.stringify(item)))) throw new Error(`В списке есть неизвестное значение: ${path}`);
    }
    for (const [path, limit] of Object.entries(boundaries.maxStringLengths || {})) {
      const value = readPath(state, path);
      if (value !== undefined && (typeof value !== 'string' || value.length > limit)) throw new Error(`Превышена длина поля: ${path}`);
    }
  }

  validateEvents(events: Event[]) {
    if (!Array.isArray(events)) throw new Error('AI вернул неверный список событий');
    for (const event of events) {
      if (!record(event) || typeof event.type !== 'string') throw new Error('Некорректное событие');
      if (event.payload && Object.keys(event.payload).length) throw new Error('Изменения состояния от сценариста запрещены');
      if (!this.ruleForEvent(event.type)) throw new Error(`Событие не разрешено: ${event.type}`);
    }
  }

  apply(session: Session, action: Action, events: Event[], narrative: string, mutations: StateMutationProposal[] = [], aiResponseMs = 60_000): Session {
    this.validateAction(action, session.state);
    const nextState = structuredClone(session.state);
    if (this.game.boundaries) this.applyMutations(nextState, mutations, session.state);
    else {
      this.validateEvents(events);
      for (const event of events) {
        const rule = this.ruleForEvent(event.type)!;
        nextState.lastEvent = event.type;
        if (rule.value !== undefined) nextState[event.type] = rule.value;
        if (rule.effects) Object.assign(nextState, structuredClone(rule.effects));
      }
    }
    const sequence = this.game.goal?.actions || [];
    let progress = Number(session.state.goalProgress || 0);
    const expected = sequence[progress];
    if (expected && events.some(event => event.type === this.game.rules?.transitions[expected]?.event)) progress++;
    if (sequence.length) { nextState.goalProgress = progress; nextState.ended = progress === sequence.length; }
    if (this.game.goal?.completion) {
      const { path, value, terminalValues = [value] } = this.game.goal.completion;
      nextState.ended = terminalValues.some(terminal => JSON.stringify(readPath(nextState, path)) === JSON.stringify(terminal));
    }
    delete nextState.endedReason;
    const elapsed = Math.max(5, Math.min(180, aiResponseMs / 1000));
    const activity = Math.round(100 * (180 - elapsed) / 175);
    nextState.engagement = Math.round(Number(session.state.engagement ?? 50) * .65 + activity * .35);
    nextState.pacing = Number(nextState.engagement) >= 70 ? 'fast' : Number(nextState.engagement) <= 35 ? 'slow' : 'normal';
    if (!this.game.boundaries) nextState.location = this.game.map?.destinations?.[action.type] || session.state.location || this.game.map?.start || '';
    const now = new Date().toISOString();
    return { ...session, state: nextState, turns: [...session.turns, { index: session.turns.length + 1, action, events, narrative, at: now, location: String(nextState.location || '') }], updatedAt: now };
  }
}
