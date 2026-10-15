import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {existsSync, mkdirSync, statSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Actor, Environment, Json, ObjectValue, PolicyRule, Sensitivity, ToolManifest} from './contracts.js';
import {assert, OperatorError} from './errors.js';
import {canonical, Seal} from './privacy.js';
import {migrate} from './migrations.js';

export function json(value: unknown): Json {
  // Internal records have explicitly declared JSON fields. Reject, rather than
  // silently dropping, anything that cannot be represented in the durable wire.
  const seen = new Set<object>();
  const visit = (item: unknown, depth: number): Json => {
    if (depth > 32) throw new OperatorError('INVALID_JSON', 'Data nesting is too deep.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || seen.has(item)) throw new OperatorError('INVALID_JSON', 'Finite acyclic JSON data is required.');
    seen.add(item);
    let result: Json;
    if (Array.isArray(item)) result = item.map(value => visit(value, depth + 1));
    else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new OperatorError('INVALID_JSON', 'Plain JSON objects are required.');
      const record: ObjectValue = Object.create(null) as ObjectValue;
      for (const [key, value] of Object.entries(item)) record[key] = visit(value, depth + 1);
      result = record;
    }
    seen.delete(item);
    return result;
  };
  return visit(value, 0);
}

export function object(value: unknown): ObjectValue {
  const result = json(value);
  assert(result !== null && typeof result === 'object' && !Array.isArray(result), 'INVALID_INPUT', 'An object is required.');
  return result;
}
export function text(value: unknown, maximum = 10000): string {
  assert(typeof value === 'string' && value.length > 0 && value.length <= maximum, 'INVALID_INPUT', 'A bounded text value is required.');
  return value;
}
export function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'INVALID_INPUT', 'A bounded integer is required.');
  return value;
}
export function strings(value: unknown): string[] {
  assert(Array.isArray(value) && value.every(item => typeof item === 'string'), 'INVALID_INPUT', 'A string list is required.');
  return value.map(item => text(item, 150));
}

export class RecordedRejection extends OperatorError {}

const schema = `
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE actors(tenant TEXT NOT NULL,id TEXT NOT NULL,login TEXT NOT NULL,revision INTEGER NOT NULL,active INTEGER NOT NULL,profile TEXT NOT NULL,password_hash TEXT NOT NULL,PRIMARY KEY(tenant,id),UNIQUE(tenant,login));
CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,tenant TEXT NOT NULL,actor TEXT NOT NULL,csrf_hash TEXT NOT NULL,expires INTEGER NOT NULL,FOREIGN KEY(tenant,actor) REFERENCES actors(tenant,id));
CREATE TABLE conversations(tenant TEXT NOT NULL,owner TEXT NOT NULL,id TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(tenant,id),FOREIGN KEY(tenant,owner) REFERENCES actors(tenant,id));
CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT NOT NULL,owner TEXT NOT NULL,conversation TEXT NOT NULL,role TEXT NOT NULL,sensitivity TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,FOREIGN KEY(tenant,conversation) REFERENCES conversations(tenant,id));
CREATE TABLE memory(tenant TEXT NOT NULL,owner TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,key_hash TEXT NOT NULL,sensitivity TEXT NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(tenant,owner,id),UNIQUE(tenant,owner,kind,key_hash),FOREIGN KEY(tenant,owner) REFERENCES actors(tenant,id));
CREATE TABLE memory_terms(tenant TEXT NOT NULL,owner TEXT NOT NULL,memory_id TEXT NOT NULL,term TEXT NOT NULL,PRIMARY KEY(tenant,owner,memory_id,term),FOREIGN KEY(tenant,owner,memory_id) REFERENCES memory(tenant,owner,id) ON DELETE CASCADE);
CREATE TABLE skills(id TEXT PRIMARY KEY,version TEXT NOT NULL,fingerprint TEXT NOT NULL,artifact_hash TEXT NOT NULL,manifest TEXT NOT NULL,health TEXT NOT NULL);
CREATE TABLE policies(tenant TEXT NOT NULL,owner TEXT NOT NULL,tool TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(tenant,owner,tool),FOREIGN KEY(tenant,owner) REFERENCES actors(tenant,id));
CREATE TABLE actions(tenant TEXT NOT NULL,owner TEXT NOT NULL,id TEXT NOT NULL,submission_key TEXT NOT NULL,state TEXT NOT NULL,tool TEXT NOT NULL,created INTEGER NOT NULL,not_before INTEGER NOT NULL,expires INTEGER NOT NULL,lease_expires INTEGER,payload TEXT NOT NULL,PRIMARY KEY(tenant,id),UNIQUE(tenant,owner,submission_key),FOREIGN KEY(tenant,owner) REFERENCES actors(tenant,id));
CREATE INDEX actions_due ON actions(state,not_before,created);
CREATE TABLE approvals(tenant TEXT NOT NULL,id TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,event_key TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(tenant,id),UNIQUE(tenant,event_key),FOREIGN KEY(tenant,action) REFERENCES actions(tenant,id));
CREATE TABLE attempts(tenant TEXT NOT NULL,id TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(tenant,id),FOREIGN KEY(tenant,action) REFERENCES actions(tenant,id));
CREATE TABLE late_receipts(tenant TEXT NOT NULL,id TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(tenant,id));
CREATE TABLE usage_reservations(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,owner TEXT NOT NULL,tool TEXT NOT NULL,action TEXT NOT NULL,created INTEGER NOT NULL);
CREATE INDEX usage_window ON usage_reservations(tenant,owner,tool,created);
CREATE TABLE audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,tenant TEXT NOT NULL,actor TEXT NOT NULL,kind TEXT NOT NULL,created INTEGER NOT NULL,summary TEXT NOT NULL,payload TEXT NOT NULL,previous_hash TEXT NOT NULL,hash TEXT NOT NULL);
CREATE TABLE effects(tenant TEXT NOT NULL,action TEXT NOT NULL,operation TEXT NOT NULL,input_hash TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(tenant,action,operation));
CREATE TABLE records(tenant TEXT NOT NULL,owner TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(tenant,owner,kind,id));
CREATE TABLE schedules(tenant TEXT NOT NULL,owner TEXT NOT NULL,id TEXT NOT NULL,enabled INTEGER NOT NULL,next_run INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(tenant,id),FOREIGN KEY(tenant,owner) REFERENCES actors(tenant,id));
CREATE TABLE inbox(tenant TEXT NOT NULL,channel TEXT NOT NULL,provider_id TEXT NOT NULL,payload_hash TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(tenant,channel,provider_id));
CREATE TABLE runs(tenant TEXT NOT NULL,owner TEXT NOT NULL,id TEXT NOT NULL,conversation TEXT NOT NULL,state TEXT NOT NULL,input_hash TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(tenant,id),FOREIGN KEY(tenant,owner) REFERENCES actors(tenant,id),FOREIGN KEY(tenant,conversation) REFERENCES conversations(tenant,id));
`;

export class StoreContext {
  readonly db: DatabaseSync;
  readonly seal: Seal;
  readonly environment: Environment;
  private transactionDepth = 0;
  constructor(options: {path: string; key: string; environment: Environment}) {
    this.environment = options.environment;
    this.seal = new Seal(Buffer.from(options.key, 'hex'));
    if (options.path !== ':memory:') {
      mkdirSync(dirname(options.path), {recursive: true});
      if (existsSync(options.path) && statSync(options.path).size > 0) {
        const existing = new DatabaseSync(options.path, {readOnly: true});
        try {
          const owner = existing.prepare("SELECT value FROM metadata WHERE key='owner'").get();
          assert(owner?.value === 'jarvis-operator', 'STORE_NOT_OWNED', 'This database belongs to another application.', 503);
        } catch {
          throw new OperatorError('STORE_NOT_OWNED', 'Existing database ownership could not be verified.', 503);
        } finally { existing.close(); }
      }
    }
    this.db = new DatabaseSync(options.path);
    try {
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
    const exists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'").get();
    if (!exists) this.transaction(() => {
      this.db.exec(schema);
      for (const [key, value] of Object.entries({owner: 'jarvis-operator', schema: '1', environment: this.environment,
        key_check: this.seal.seal('jarvis-operator-key-check', 'metadata:key-check')})) this.run('INSERT INTO metadata VALUES(?,?)', key, value);
    });
    assert(this.get("SELECT value FROM metadata WHERE key='environment'")?.value === this.environment, 'ENVIRONMENT_MISMATCH', 'Do not reuse staging data as production data.', 503);
    assert(this.seal.open(text(this.get("SELECT value FROM metadata WHERE key='key_check'")?.value), 'metadata:key-check') === 'jarvis-operator-key-check', 'KEY_MISMATCH', 'The data key does not match this database.', 503);
    this.db.exec('PRAGMA journal_mode=WAL;');
    migrate(this.db);
    } catch (error) {this.db.close();throw error;}
  }

  get(sql: string, ...args: SQLInputValue[]): Record<string, unknown> | undefined { return this.db.prepare(sql).get(...args); }
  all(sql: string, ...args: SQLInputValue[]): Record<string, unknown>[] { return this.db.prepare(sql).all(...args); }
  run(sql: string, ...args: SQLInputValue[]): void { this.db.prepare(sql).run(...args); }
  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work();
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth++;
    try {
      const result = work();
      assert(!(result instanceof Promise), 'INVALID_TRANSACTION', 'Asynchronous work cannot run inside a write transaction.', 500);
      this.db.exec('COMMIT'); return result;
    }
    catch (error) { this.db.exec(error instanceof RecordedRejection ? 'COMMIT' : 'ROLLBACK'); throw error; }
    finally { this.transactionDepth--; }
  }

  actor(tenant: string, id: string, active = true): Actor {
    const row = this.get('SELECT * FROM actors WHERE tenant=? AND id=?', tenant, id);
    assert(row, 'ACTOR_NOT_FOUND', 'The account is unavailable.', 403);
    const profile = object(this.seal.open(text(row.profile), `actor:${tenant}:${id}:${row.revision}:${row.active}`));
    const language = profile.language === 'cs' ? 'cs' : 'en';
    const actor: Actor = {id, tenantId: tenant, displayName: text(profile.displayName, 100), roles: strings(profile.roles),
      permissions: strings(profile.permissions), revision: integer(row.revision, 1), active: row.active === 1,
      language, timezone: text(profile.timezone, 100)};
    assert(!active || actor.active, 'ACTOR_INACTIVE', 'The account is inactive.', 403);
    return actor;
  }

  require(tenant: string, id: string, permissions: string[]): Actor {
    const actor = this.actor(tenant, id);
    assert(permissions.every(permission => actor.permissions.includes(permission)), 'FORBIDDEN', 'This account lacks the required permission.', 403);
    return actor;
  }

  saveActor(actor: Actor, login: string, passwordHash: string): void {
    const profile = this.seal.seal(json({displayName: actor.displayName, roles: actor.roles,
      permissions: actor.permissions, language: actor.language, timezone: actor.timezone}),
      `actor:${actor.tenantId}:${actor.id}:${actor.revision}:${actor.active ? 1 : 0}`);
    this.run('INSERT INTO actors VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET revision=excluded.revision,active=excluded.active,profile=excluded.profile,password_hash=excluded.password_hash',
      actor.tenantId, actor.id, login, actor.revision, actor.active ? 1 : 0, profile, passwordHash);
  }

  conversation(tenant: string, owner: string, id: string): void {
    this.actor(tenant, owner);
    assert(this.get('SELECT id FROM conversations WHERE tenant=? AND owner=? AND id=?', tenant, owner, id), 'NOT_FOUND', 'Conversation not found.', 404);
  }

  skill(id: string): {manifest: ToolManifest; fingerprint: string; ready: boolean} {
    const row = this.get('SELECT * FROM skills WHERE id=?', id);
    assert(row, 'TOOL_UNAVAILABLE', 'The requested skill is unavailable.', 409);
    const manifest = JSON.parse(text(row.manifest, 100000)) as ToolManifest;
    const health = object(JSON.parse(text(row.health, 10000)));
    return {manifest, fingerprint: text(row.fingerprint), ready: health.state === 'ready'};
  }

  policy(tenant: string, owner: string, tool: string, fingerprint: string): PolicyRule {
    const row = this.get('SELECT * FROM policies WHERE tenant=? AND owner=? AND tool=?', tenant, owner, tool);
    if (!row) return {tenantId: tenant, ownerId: owner, environment: this.environment, tool, fingerprint,
      automatic: false, revision: 0, maxPerMinute: 5, maxPerDay: 100};
    return this.seal.open(text(row.payload), `policy:${tenant}:${owner}:${tool}:${row.revision}`) as unknown as PolicyRule;
  }

  audit(tenant: string, actor: string, kind: string, payload: Json, now: number, sensitivity: Sensitivity = 'internal'): string {
    const id = randomUUID();
    const previous = String(this.get('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1')?.hash ?? 'genesis');
    const summary = this.seal.redacted(payload, sensitivity);
    const sealed = this.seal.seal(payload, `audit:${tenant}:${actor}:${id}`);
    const hash = this.seal.digest({id, tenant, actor, kind, now, summary, sealed, previous});
    this.run('INSERT INTO audit(id,tenant,actor,kind,created,summary,payload,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?,?)',
      id, tenant, actor, kind, now, canonical(summary), sealed, previous, hash);
    return id;
  }

  notify(tenant: string, owner: string, kind: string, data: ObjectValue, now: number): string {
    const id = randomUUID();
    this.run('INSERT INTO notifications(id,tenant,owner,kind,payload,created) VALUES(?,?,?,?,?,?)', id, tenant, owner, kind,
      this.seal.seal(data, `notification:${tenant}:${owner}:${id}`), now);
    return id;
  }
}
