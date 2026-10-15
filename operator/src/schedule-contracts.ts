import type {Actor, ObjectValue} from './contracts.js';

export interface Schedule {
  id: string; tenantId: string; ownerId: string; revision: number; enabled: boolean;
  tool: string; input: ObjectValue; fingerprint: string; actorRevision: number;
  cron: string; timezone: string; conversationId: string; nextRun: number;
  createdAt: number; updatedAt: number; reason: string;
}

export interface ScheduledJob {
  id: string; tenantId: string; ownerId: string; schedule: Schedule; dueAt: number;
  state: 'queued'|'running'|'completed'|'failed'|'cancelled'; attempts: number;
  leaseToken: string|null; leaseExpires: number|null; result: ObjectValue|null;
  createdAt: number; updatedAt: number;
}

export interface ClaimedScheduledJob {job: ScheduledJob; actor: Actor}
