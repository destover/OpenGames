import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const feedbackStatuses = ['open', 'answered', 'closed'] as const;
export const feedbackKinds = ['issue', 'rating'] as const;
export const feedbackRequestTypes=['refund_voluntary','refund_service','account_deletion'] as const;
export type FeedbackRequestType = typeof feedbackRequestTypes[number];
export const feedbackRequestDays:Record<FeedbackRequestType,number>={refund_voluntary:7,refund_service:10,account_deletion:30};
type Status = typeof feedbackStatuses[number];
type Kind = typeof feedbackKinds[number];
type Snapshot = {
  sessionId: string; gameId: string; gameVersion: string; turnIndex?: number;
  source?: string; model?: string; action?: string; narrative?: string; error?: string;
};
type Ticket = {
  id: string; ownerId: string; kind: Kind; status: Status; rating: number | null;
  sessionId: string | null; gameId: string | null; turnIndex: number | null;
  requestType: FeedbackRequestType | null; deadlineDays: number | null;
  createdAt: string; updatedAt: string;
};
type StoredTicket = Ticket & { context: string };
type Message = { id: string; author: 'player' | 'admin'; text: string; createdAt: string };
export type FeedbackFilter = { status?: Status; kind?: Kind; requestType?:FeedbackRequestType; gameId?: string; offset?: number; limit?: number };

const columns = "id, owner_id AS ownerId, kind, status, rating, NULLIF(session_id,'') AS sessionId, NULLIF(game_id,'') AS gameId, turn_index AS turnIndex, created_at AS createdAt, updated_at AS updatedAt, r.request_type AS requestType, r.deadline_days AS deadlineDays";
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
      CREATE TABLE IF NOT EXISTS feedback_requests (
        feedback_id TEXT PRIMARY KEY REFERENCES feedback(id),
        request_type TEXT NOT NULL CHECK(request_type IN ('refund_voluntary','refund_service','account_deletion')),
        deadline_days INTEGER NOT NULL, payment_id TEXT,
        mail_attempts INTEGER NOT NULL DEFAULT 0, mail_next_at INTEGER NOT NULL DEFAULT 0, mail_sent_at TEXT
      );
      CREATE INDEX IF NOT EXISTS feedback_requests_mail ON feedback_requests(mail_next_at) WHERE mail_sent_at IS NULL;

    `);
  }

  list(filters: FeedbackFilter, ownerId?: string) {
    const conditions: string[] = [], params: string[] = [];
    for (const [column, value] of [['owner_id',ownerId],['status',filters.status],['kind',filters.kind],['r.request_type',filters.requestType],['game_id',filters.gameId]]) {
      if (value) { conditions.push(column+'=?'); params.push(value); }
    }
    const where = conditions.length ? ' WHERE '+conditions.join(' AND ') : '';
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20)), offset = Math.max(0, filters.offset ?? 0);
    const rows = this.db.prepare(`SELECT ${columns} FROM feedback LEFT JOIN feedback_requests r ON r.feedback_id=feedback.id${where} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`)
      .all(...params,limit+1,offset) as Ticket[];
    return {items:rows.slice(0,limit),nextOffset:rows.length>limit?offset+limit:null};
  }

  get(id: string, ownerId?: string) {
    const row = this.db.prepare(`SELECT ${columns}, context FROM feedback LEFT JOIN feedback_requests r ON r.feedback_id=feedback.id WHERE id=?${ownerId?' AND owner_id=?':''}`)
      .get(...(ownerId?[id,ownerId]:[id])) as StoredTicket | undefined;
    if (!row) throw problem(404,'Обращение не найдено');
    const messages = this.db.prepare('SELECT id, author, text, created_at AS createdAt FROM feedback_messages WHERE feedback_id=? ORDER BY rowid')
      .all(id) as Message[];
    return {...row,context:JSON.parse(row.context) as Snapshot|{paymentId?:string},messages};
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

  createRequest(ownerId:string,type:FeedbackRequestType,value:unknown,paymentId?:string){
    const text=feedbackText(value), id=randomUUID(), now=new Date().toISOString();
    this.transaction(()=>{
      const duplicate=this.db.prepare(`
        SELECT 1 FROM feedback_requests r JOIN feedback f ON f.id=r.feedback_id
        WHERE f.owner_id=? AND f.status<>'closed'
          AND ((r.request_type='account_deletion' AND ?='account_deletion') OR
            (r.request_type<>'account_deletion' AND ?<>'account_deletion' AND r.payment_id IS ?))
        LIMIT 1`).get(ownerId,type,type,paymentId??null);
      if(duplicate)throw problem(409,'Такая заявка уже открыта. Откройте её в разделе «Мои обращения».');
      this.db.prepare("INSERT INTO feedback(id,owner_id,kind,session_id,game_id,context,created_at,updated_at) VALUES (?,?,'issue','','',?,?,?)")
        .run(id,ownerId,JSON.stringify({paymentId}),now,now);
      this.addMessage(id,'player',text,now);
      this.db.prepare('INSERT INTO feedback_requests(feedback_id,request_type,deadline_days,payment_id) VALUES (?,?,?,?)')
        .run(id,type,feedbackRequestDays[type],paymentId??null);
    });
    return this.get(id,ownerId);
  }

  pendingRequestEmails(now=Date.now()){
    return this.db.prepare(`SELECT feedback_id AS id,request_type AS type,mail_attempts AS attempts
      FROM feedback_requests WHERE mail_sent_at IS NULL AND mail_next_at<=? ORDER BY mail_next_at, rowid LIMIT 10`)
      .all(now) as {id:string;type:FeedbackRequestType;attempts:number}[];
  }

  markRequestEmail(id:string,attempts:number,sent:boolean){
    const nextAt=Date.now()+Math.min(3_600_000,30_000*2**Math.min(attempts,7));
    this.db.prepare('UPDATE feedback_requests SET mail_attempts=?,mail_next_at=?,mail_sent_at=? WHERE feedback_id=? AND mail_sent_at IS NULL')
      .run(attempts+1,nextAt,sent?new Date().toISOString():null,id);
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
