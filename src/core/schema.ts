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
