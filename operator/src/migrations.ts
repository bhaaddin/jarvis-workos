import type {DatabaseSync} from 'node:sqlite';
import {assert} from './errors.js';

export const schemaVersion = 2;

// Version 1 existed briefly both before and after runs were introduced. Preserve
// either owned variant, including its private records, in this additive upgrade.
const version2 = `
CREATE TABLE IF NOT EXISTS runs(tenant TEXT NOT NULL,owner TEXT NOT NULL,id TEXT NOT NULL,conversation TEXT NOT NULL,state TEXT NOT NULL,input_hash TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(tenant,id),FOREIGN KEY(tenant,owner) REFERENCES actors(tenant,id),FOREIGN KEY(tenant,conversation) REFERENCES conversations(tenant,id));
CREATE INDEX runs_queued ON runs(state,created);
CREATE INDEX schedules_due ON schedules(enabled,next_run);
CREATE TABLE scheduled_jobs(tenant TEXT NOT NULL,owner TEXT NOT NULL,id TEXT NOT NULL,schedule TEXT NOT NULL,revision INTEGER NOT NULL,due INTEGER NOT NULL,state TEXT NOT NULL,lease_expires INTEGER,payload TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(tenant,id),UNIQUE(tenant,schedule,revision,due),FOREIGN KEY(tenant,schedule) REFERENCES schedules(tenant,id));
CREATE INDEX scheduled_jobs_pending ON scheduled_jobs(state,created);
CREATE TABLE notifications(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,tenant TEXT NOT NULL,owner TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,acknowledged INTEGER,FOREIGN KEY(tenant,owner) REFERENCES actors(tenant,id));
CREATE INDEX notifications_owner ON notifications(tenant,owner,seq);
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
`;

export function migrate(db: DatabaseSync): void {
  const version = Number(db.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value);
  assert(Number.isInteger(version) && version >= 1 && version <= schemaVersion,
    'SCHEMA_UNSUPPORTED', 'This database requires a compatible operator version.', 503);
  if (version === schemaVersion) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(version2);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(2, Date.now());
    db.prepare("UPDATE metadata SET value=? WHERE key='schema'").run(String(schemaVersion));
    db.exec('COMMIT');
  } catch (error) {db.exec('ROLLBACK');throw error;}
}
