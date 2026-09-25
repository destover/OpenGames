import type { GamePackage } from './types.ts';

export function validateGamePackage(game: GamePackage) {
  if (!game?.manifest?.id || !game.manifest.title || !game.manifest.version || !game.manifest.schemaVersion) throw new Error('Игровой пакет: отсутствует манифест');
  if (game.manifest.music && (!game.manifest.music.startsWith('/assets/music/') || !/\.(wav|ogg|mp3|m4a)$/i.test(game.manifest.music))) throw new Error(`${game.manifest.id}: некорректный путь музыкального фона`);
  if (!game.state?.initial || typeof game.state.initial !== 'object') throw new Error(`${game.manifest.id}: отсутствует initial state`);
  if (!game.actions || Object.keys(game.actions).length === 0) throw new Error(`${game.manifest.id}: отсутствуют actions`);
  for (const [action, definition] of Object.entries(game.actions)) {
    if (!definition.label) throw new Error(`${game.manifest.id}: у действия ${action} отсутствует label`);
  }
  if (game.rules?.transitions) for (const [action, transition] of Object.entries(game.rules.transitions)) if (!transition.event || !transition.narrative) throw new Error(`${game.manifest.id}: некорректный transition ${action}`);
  if (game.goal?.actions && (!game.goal.actions.length || game.goal.actions.some(type => !game.actions[type]))) throw new Error('Игровой пакет: некорректная цель');
  if (game.world && (!game.world.constants || !Array.isArray(game.world.knowledgeGraph?.facts))) throw new Error(`${game.manifest.id}: некорректное описание мира`);
  if (game.preparedBranches) for (const branch of game.preparedBranches) {
    if (!branch.id || !branch.narrative?.ru || !branch.narrative?.en || !branch.actions?.length || branch.actions.some(action => !game.actions[action]) || (branch.minTurns !== undefined && (!Number.isInteger(branch.minTurns) || branch.minTurns < 0))) throw new Error(`${game.manifest.id}: некорректная подготовленная ветка ${branch.id}`);
    for (const [action, response] of Object.entries(branch.responses || {})) {
      if (!branch.actions.includes(action) || !response.narrative?.ru || !response.narrative?.en) throw new Error(`${game.manifest.id}: некорректный ответ ветки ${branch.id}/${action}`);
      if (response.mutations?.some(mutation => !game.boundaries?.mutationPaths.some(path => path.endsWith('.*') ? mutation.path.startsWith(path.slice(0, -1)) : path === mutation.path))) throw new Error(`${game.manifest.id}: мутация подготовленной ветки вне границ`);
    }
    if (branch.responses) {
      const actions = branch.actions.filter(action => action !== 'free_text');
      if (actions.some(action => !branch.responses?.[action])) throw new Error(`${game.manifest.id}: в ветке ${branch.id} отсутствуют ответы на действия`);
      for (const language of ['ru','en'] as const) {
        const texts = actions.map(action => branch.responses![action].narrative[language].trim().toLocaleLowerCase());
        if (new Set(texts).size !== texts.length) throw new Error(`${game.manifest.id}: одинаковые ответы разных действий в ветке ${branch.id} (${language})`);
      }
    }
    if (branch.mutations?.some(mutation => !game.boundaries?.mutationPaths.some(path => path.endsWith('.*') ? mutation.path.startsWith(path.slice(0, -1)) : path === mutation.path))) throw new Error(`${game.manifest.id}: мутация подготовленной ветки вне границ`);
  }
  if (game.boundaries && (!Array.isArray(game.boundaries.mutationPaths) || !game.boundaries.mutationPaths.length)) throw new Error(`${game.manifest.id}: не заданы границы состояния`);
  if (!game.rules?.transitions && (!game.world || !game.boundaries)) throw new Error(`${game.manifest.id}: требуется world и boundaries либо legacy transitions`);
  if (game.map && (!game.map.locations[game.map.start] || Object.values(game.map.destinations || {}).some(id => !game.map!.locations[id]))) throw new Error('Игровой пакет: некорректная карта');
  for (const language of ['ru','en']) {
    const dict = game.i18n?.[language];
    if (!dict?.manifest?.title || !dict.manifest.category || !dict.manifest.description) throw new Error('Игровой пакет: отсутствует перевод манифеста');
    if (game.rules?.transitions) for (const [type, rule] of Object.entries(game.rules.transitions)) if (!dict.actions[type] || !dict.events[rule.event] || !dict.narratives[type]) throw new Error('Игровой пакет: отсутствует перевод действия');
  }
  return game;
}
