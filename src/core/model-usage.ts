import { chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { TokenUsage } from './ai.ts';
import { modelInfo } from './generation.ts';

const dayMs = 86_400_000;
const dayStart = () => Math.floor(Date.now() / dayMs) * dayMs;
const prices: Record<string, [number, number]> = {
  'anthropic/claude-haiku-4-5': [1, 5],
  'anthropic/claude-haiku-4-5-20251001': [1, 5],
  'gemini/gemini-2.5-flash': [0.3, 2.5],
  'openai/gpt-4o-mini': [0.15, 0.60],
  'openai/gpt-4.1-mini': [0.40, 1.60]
};

export class ModelUsageStore {
  private db: DatabaseSync;
  private limits: Record<string, number>;
  constructor(file: string, limits = process.env.OPENGAME_MODEL_DAILY_LIMITS) {
    this.limits = limits ? JSON.parse(limits) : {};
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS model_calls(
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, model TEXT NOT NULL, day INTEGER NOT NULL,
        input INTEGER, output INTEGER, usd REAL, finished INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS model_calls_day ON model_calls(user_id, model, day);
      CREATE INDEX IF NOT EXISTS model_calls_report ON model_calls(day, model);
      CREATE TABLE IF NOT EXISTS model_limits(model TEXT PRIMARY KEY, daily INTEGER NOT NULL CHECK(daily>=0));`);
  }

  dailyLimit(provider: string, model: string) {
    const key = provider + '/' + model;
    const row = this.db.prepare('SELECT daily FROM model_limits WHERE model=?').get(key) as {daily:number} | undefined;
    const configured = this.limits[key];
    const baseline = Number.isSafeInteger(configured) && configured >= 0 ? configured : modelInfo(provider, model)?.dailyLimit ?? 100;
    return { limit:row?.daily ?? baseline, baseline, override:row?.daily ?? null };
  }

  setDailyLimit(provider: string, model: string, limit: number | null) {
    const key = provider + '/' + model;
    if (limit === null) this.db.prepare('DELETE FROM model_limits WHERE model=?').run(key);
    else this.db.prepare('INSERT INTO model_limits(model,daily) VALUES(?,?) ON CONFLICT(model) DO UPDATE SET daily=excluded.daily').run(key,limit);
    return this.dailyLimit(provider,model);
  }

  today(userId: string, provider: string, model: string) {
    const day = dayStart(), limit = this.dailyLimit(provider, model).limit;
    const totals = this.db.prepare(`SELECT count(*) AS calls, sum(input) AS inputTokens, sum(output) AS outputTokens,
      sum(usd) AS costUsd, count(*) - count(usd) AS unpriced FROM model_calls WHERE user_id=? AND model=? AND day=?`)
      .get(userId, provider + '/' + model, day) as { calls: number; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; unpriced: number };
    return { ...totals, limit, remaining: Math.max(0, limit - totals.calls), resetAt: day + dayMs };
  }

  dailyReport() {
    const day = dayStart();
    const rows = this.db.prepare(`SELECT model, count(*) AS calls, sum(input) AS inputTokens, sum(output) AS outputTokens,
      sum(usd) AS costUsd, count(*) FILTER(WHERE finished=1 AND usd IS NULL) AS unpriced,
      count(*) FILTER(WHERE finished=0) AS pending FROM model_calls WHERE day=? GROUP BY model`).all(day) as {
        model:string; calls:number; inputTokens:number|null; outputTokens:number|null; costUsd:number|null; unpriced:number; pending:number
      }[];
    return { resetAt:day + dayMs, byModel:Object.fromEntries(rows.map(({model,...usage})=>[model,usage])) };
  }

  begin(userId: string, provider: string, model: string, unlimited=false) {
    const id = randomUUID(), day = dayStart(), key = provider + '/' + model;
    const result = this.db.prepare(`INSERT INTO model_calls(id, user_id, model, day)
      SELECT ?, ?, ?, ? WHERE (SELECT count(*) FROM model_calls WHERE user_id=? AND model=? AND day=?) < ?`)
      .run(id, userId, key, day, userId, key, day, unlimited?Number.MAX_SAFE_INTEGER:this.dailyLimit(provider, model).limit);
    if (!result.changes) throw Object.assign(new Error('Суточный лимит запросов к модели исчерпан'), { status: 429, resetAt: day + dayMs });
    return (usage?: TokenUsage) => {
      const price = prices[key];
      const usd = usage?.costUsd ?? (usage && price ? (usage.promptTokens * price[0] + usage.completionTokens * price[1]) / 1e6 : null);
      this.db.prepare('UPDATE model_calls SET input=?, output=?, usd=?, finished=1 WHERE id=?')
        .run(usage?.promptTokens ?? null, usage?.completionTokens ?? null, usd, id);
    };
  }
}
