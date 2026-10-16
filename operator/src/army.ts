import {readdir, readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {ObjectValue, ToolContext} from './contracts.js';
import {assert} from './errors.js';
import {packageRoot} from './config.js';
import {object, text} from './store-context.js';
import type {Store} from './store.js';

// Coordinator fan-out over real child runs. The coordinator (model) plans,
// spawns up to 3 specialists per call, does other work, then collects.
// Children drain through the normal run worker; their non-read tool calls
// need owner approval exactly like any other run. v1 limits: spawns bypass
// the admission counter (cap is per-call), and collection is pull-based.
export const SPECIALISTS = ['analyzer', 'researcher', 'coder', 'mailer', 'scout'] as const;

export function specialistsDir(): string {
  return process.env.JARVIS_ARMY_DIR ?? path.join(packageRoot, 'skills', 'jarvis-army', 'specialists');
}

export async function armyRoster(dir?: string): Promise<Array<{name: string; role: string}>> {
  const root = dir ?? specialistsDir();
  let files: string[];
  try {
    files = (await readdir(root)).filter(name => name.endsWith('.md')).sort();
  } catch {
    return [];
  }
  const roster: Array<{name: string; role: string}> = [];
  for (const file of files.slice(0, 30)) {
    let first = '';
    try {
      first = (await readFile(path.join(root, file), 'utf8')).split('\n')[0]?.trim() ?? '';
    } catch {
      continue;
    }
    if (first.startsWith('#')) first = first.slice(1).trim();
    let [name, role] = first.split('—', 2).map(part => part.trim());
    if (!role) [name, role] = first.split('-', 2).map(part => part.trim());
    if (name) roster.push({name: name.slice(0, 60), role: (role ?? '').slice(0, 160)});
  }
  return roster;
}

async function specialistSlice(specialist: string, dir?: string): Promise<string> {
  const root = dir ?? specialistsDir();
  assert(SPECIALISTS.includes(specialist as (typeof SPECIALISTS)[number]),
    'ARMY_SPECIALIST_UNKNOWN', 'Choose analyzer, researcher, coder, mailer or scout.', 404);
  const file = path.join(root, specialist + '.md');
  let slice: string;
  try {
    slice = await readFile(file, 'utf8');
  } catch {
    throw new Error('The specialist roster is not installed.');
  }
  assert(slice.trim().length >= 20, 'ARMY_SPECIALIST_INVALID', 'The specialist definition is not usable.', 503);
  return slice.trim().slice(0, 4000);
}

export async function armyCoordinate(input: ObjectValue, context: ToolContext, store: Store,
  authorize?: () => Promise<void>): Promise<ObjectValue> {
  const operation = input.operation;
  assert(operation === 'roster' || operation === 'spawn' || operation === 'collect',
    'ARMY_OPERATION_INVALID', 'Choose roster, spawn or collect.');
  const base = {tenantId: context.actor.tenantId, actorId: context.actor.id, now: Date.now()};
  if (operation === 'roster') return {specialists: await armyRoster()};
  if (operation === 'collect') {
    const conversationId = input.conversationId, runId = input.runId;
    assert(typeof conversationId === 'string' && /^[0-9a-f-]{36}$/i.test(conversationId)
      && typeof runId === 'string' && /^[0-9a-f-]{36}$/i.test(runId),
      'ARMY_COLLECT_INVALID', 'Collect needs the child conversationId and runId from spawn.');
    const run = await store.call<ObjectValue>('run.get', {...base, id: runId, secure: context.secure});
    const result = object(run.result ?? {});
    const textResult = typeof result.text === 'string' ? result.text
      : typeof (result.result as ObjectValue)?.text === 'string' ? String((result.result as ObjectValue).text) : '';
    return {state: run.state ?? 'unknown', text: String(textResult).slice(0, 6000),
      conversationId, runId};
  }
  assert(typeof authorize === 'function', 'EFFECT_NOT_ADMITTED', 'Spawning specialists needs an admitted action.', 403);
  const assignments = input.assignments;
  assert(Array.isArray(assignments) && assignments.length >= 1 && assignments.length <= 3,
    'ARMY_SPAWN_INVALID', 'Spawn 1 to 3 specialist assignments per call.');
  await authorize();
  const children = [];
  for (const assignment of assignments) {
    const row = object(assignment);
    const specialist = text(row.specialist, 20), task = text(row.task, 2000);
    const slice = await specialistSlice(specialist);
    assert(task.trim().length >= 5, 'ARMY_SPAWN_INVALID', 'Each assignment needs a real task.');
    const conversationId = randomUUID(), runId = randomUUID();
    await store.call('conversation.create', {...base, id: conversationId});
    const message = slice + '\n\nAssignment from the coordinator (parent '
      + context.conversationId + '): ' + task.trim()
      + '\nWork it now. Report back in short bullets with evidence. Reads are free; '
      + 'anything consequential waits for owner approval.';
    await store.call('run.accept', {...base, id: runId, conversationId, message,
      channel: context.channel, secure: context.secure, source: context.source});
    children.push({specialist, conversationId, runId, state: 'spawned'});
  }
  return {children, collect: 'Call army coordinate collect with each child conversationId and runId. '
    + 'Merge verified results; report running children with their ids instead of inventing outcomes.'};
}
