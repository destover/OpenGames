import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const feedbackStatuses = ['open', 'answered', 'closed'] as const;
export const feedbackKinds = ['issue', 'rating'] as const;
type Status = typeof feedbackStatuses[number];
type Kind = typeof feedbackKinds[number];
type Snapshot = {
  sessionId: string; gameId: string; gameVersion: string; turnIndex?: number;
  source?: string; model?: string; action?: string; narrative?: string; error?: string;
};
type Ticket = {
  id: string; ownerId: string; kind: Kind; status: Status; rating: number | null;
  sessionId: string; gameId: string; turnIndex: number | null;
  createdAt: string; updatedAt: string;
};
type StoredTicket = Ticket & { context: string };
type Message = { id: string; author: 'player' | 'admin'; text: string; createdAt: string };
export type FeedbackFilter = { status?: Status; kind?: Kind; gameId?: string; offset?: number; limit?: number };

const columns = 'id, owner_id AS ownerId, kind, status, rating, session_id AS sessionId, game_id AS gameId, turn_index AS turnIndex, created_at AS createdAt, updated_at AS updatedAt';
const problem = (status: number, message: string) => Object.assign(new Error(message), {status});

export function feedbackText(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000) {
    throw problem(400, 'Укажите текст от 1 до 2000 символов');
  }
  return value.trim();
}

export class FeedbackStore {
  private readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('issue','rating')),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered','closed')),
        rating INTEGER CHECK(rating BETWEEN 1 AND 5), session_id TEXT NOT NULL, game_id TEXT NOT NULL,
        turn_index INTEGER, context TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK(kind='issue' OR (rating IS NOT NULL AND turn_index IS NOT NULL))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS feedback_turn_rating ON feedback(owner_id,session_id,turn_index) WHERE kind='rating';
      CREATE INDEX IF NOT EXISTS feedback_updated ON feedback(updated_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS feedback_player ON feedback(owner_id,updated_at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS feedback_messages (
        id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL REFERENCES feedback(id),
        author TEXT NOT NULL CHECK(author IN ('player','admin')), text TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS feedback_message_thread ON feedback_messages(feedback_id,created_at);
    `);
  }

  list(filters: FeedbackFilter, ownerId?: string) {
    const conditions: string[] = [], params: string[] = [];
    for (const [column, value] of [['owner_id',ownerId],['status',filters.status],['kind',filters.kind],['game_id',filters.gameId]]) {
      if (value) { conditions.push(column+'=?'); params.push(value); }
    }
    const where = conditions.length ? ' WHERE '+conditions.join(' AND ') : '';
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20)), offset = Math.max(0, filters.offset ?? 0);
    const rows = this.db.prepare(`SELECT ${columns} FROM feedback${where} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`)
      .all(...params,limit+1,offset) as Ticket[];
    return {items:rows.slice(0,limit),nextOffset:rows.length>limit?offset+limit:null};
  }

  get(id: string, ownerId?: string) {
    const row = this.db.prepare(`SELECT ${columns}, context FROM feedback WHERE id=?${ownerId?' AND owner_id=?':''}`)
      .get(...(ownerId?[id,ownerId]:[id])) as StoredTicket | undefined;
    if (!row) throw problem(404,'Обращение не найдено');
    const messages = this.db.prepare('SELECT id, author, text, created_at AS createdAt FROM feedback_messages WHERE feedback_id=? ORDER BY rowid')
      .all(id) as Message[];
    return {...row,context:JSON.parse(row.context) as Snapshot,messages};
  }

  private transaction<T>(write: () => T) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = write();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  create(ownerId: string, context: Snapshot, kind: Kind, value: unknown) {
    const id = randomUUID(), now = new Date().toISOString();
    if (kind === 'rating') {
      if (context.turnIndex === undefined || typeof value !== 'number' || !Number.isInteger(value) || value<1 || value>5) {
        throw problem(400,'Выберите завершённый ход и оценку от 1 до 5');
      }
      const row = this.db.prepare(`
        INSERT INTO feedback(id,owner_id,kind,rating,session_id,game_id,turn_index,context,created_at,updated_at)
        VALUES (?,?, 'rating',?,?,?,?,?,?,?)
        ON CONFLICT(owner_id,session_id,turn_index) WHERE kind='rating' DO UPDATE
        SET rating=excluded.rating,updated_at=CASE WHEN rating<>excluded.rating THEN excluded.updated_at ELSE updated_at END
        RETURNING id`).get(id,ownerId,value,context.sessionId,context.gameId,context.turnIndex,JSON.stringify(context),now,now) as {id:string};
      return this.get(row.id,ownerId);
    }
    const text = feedbackText(value);
    this.transaction(()=>{
      const since = new Date(Date.now()-86_400_000).toISOString();
      const {total} = this.db.prepare("SELECT count(*) AS total FROM feedback WHERE owner_id=? AND kind='issue' AND created_at>=?")
        .get(ownerId,since) as {total:number};
      if (total>=30) throw problem(429,'Достигнут суточный лимит обращений');
      this.db.prepare("INSERT INTO feedback(id,owner_id,kind,session_id,game_id,turn_index,context,created_at,updated_at) VALUES (?,?,'issue',?,?,?,?,?,?)")
        .run(id,ownerId,context.sessionId,context.gameId,context.turnIndex??null,JSON.stringify(context),now,now);
      this.addMessage(id,'player',text,now);
    });
    return this.get(id,ownerId);
  }

  private addMessage(id: string, author: Message['author'], text: string, now: string) {
    this.db.prepare('INSERT INTO feedback_messages VALUES (?,?,?,?,?)').run(randomUUID(),id,author,text,now);
  }

  reply(id: string, value: unknown, ownerId?: string) {
    const text = feedbackText(value), now = new Date().toISOString();
    this.transaction(()=>{
      const ticket = this.get(id,ownerId);
      if (ticket.status==='closed') throw problem(409,'Обращение закрыто');
      if (ticket.messages.length>=100) throw problem(409,'Достигнут лимит сообщений в обращении');
      this.addMessage(id,ownerId?'player':'admin',text,now);
      this.db.prepare('UPDATE feedback SET status=?,updated_at=? WHERE id=?').run(ownerId?'open':'answered',now,id);
    });
    return this.get(id,ownerId);
  }

  setStatus(id: string, value: unknown) {
    if (value!=='open' && value!=='closed') throw problem(400,'Выберите «Открыто» или «Закрыто»');
    if (!this.db.prepare('UPDATE feedback SET status=?,updated_at=? WHERE id=?').run(value,new Date().toISOString(),id).changes) {
      throw problem(404,'Обращение не найдено');
    }
    return this.get(id);
  }
}
