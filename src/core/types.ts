export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface GamePackage {
  manifest: { id: string; title: string; description: string; version: string; schemaVersion: string; isNew?: boolean; setting?: string; categoryRu?: string; background?: string; music?: string; durationMinutes?: number[] };
  state: { initial: Record<string, Json> };
  actions: Record<string, { label: string; input?: boolean; icon?: string }>;
  rules?: { transitions: Record<string, { event: string; value?: Json; effects?: Record<string, Json>; narrative: string }> };
  world?: { constants: Record<string, Json>; knowledgeGraph: { facts: Array<{ id: string; text: string }> } };
  boundaries?: { mutationPaths: string[]; immutablePaths?: string[]; numericBounds?: Record<string, { min: number; max: number }>; allowedValues?: Record<string, Json[]>; maxArrayItems?: Record<string, number>; maxStringLengths?: Record<string, number>; stateChangeRules?: Array<{ path: string; maxIncrease?: number; increaseRequires?: { path: string; oneOf: Json[] } }>; instructions?: string[] };
  ui: { accent: string; stateLabels: Record<string, string> };
  goal?: { actions?: string[]; label?: { ru: string; en: string }; description?: { ru: string; en: string }; completion?: { path: string; value: Json; terminalValues?: Json[] } };
  map?: { start: string; locations: Record<string, { ru: string; en: string }>; destinations?: Record<string, string> };
  opening?: { ru: string; en: string };
  i18n?: Record<string, Record<string, Record<string, string>>>;
}

export interface Action { type: string; text?: string; icon?: string; requestId?: string; language?: 'ru' | 'en'; covers?: string[] }
export interface Event { type: string; payload?: Record<string, Json> }
export type StateMutationProposal =
  | { op: 'set'; path: string; value: Json }
  | { op: 'increment'; path: string; amount: number }
  | { op: 'append'; path: string; value: Json }
  | { op: 'remove'; path: string; value: Json };
export interface TurnRecord { index: number; action: Action; events: Event[]; narrative: string; at: string; location?: string; source?: string; stateMutation?: StateMutationProposal[] }
export interface Session {
  id: string; gameId: string; ownerId?: string; packageVersion: string; schemaVersion: string;
  suggestions?: Action[]; suggestionLanguage?: string; state: Record<string, Json>; turns: TurnRecord[]; createdAt: string; updatedAt: string;
}
