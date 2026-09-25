import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { Session } from './types.ts';

export class LocalSaveSystem {
  private readonly directory: string;
  constructor(directory: string) { this.directory = directory; mkdirSync(directory, { recursive: true }); }
  save(session: Session) { const path = join(this.directory, `${session.id}.json`); writeFileSync(path + '.tmp', JSON.stringify(session, null, 2)); renameSync(path + '.tmp', path); }
  all() { return readdirSync(this.directory).filter(file => file.endsWith('.json')).flatMap(file => { try { return [JSON.parse(readFileSync(join(this.directory, file), 'utf8')) as Session]; } catch { return []; } }); }
  get(id: string) { const path = join(this.directory, `${id}.json`); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Session : undefined; }
}
