import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOperator} from '../server.js';
import type {Config} from '../config.js';
import type {Actor, Invocation} from '../contracts.js';
import {armyRoster} from '../army.js';

const tools = ['jarvis_army'];

async function fixture(work: (runtime: Awaited<ReturnType<typeof createOperator>>, context: Invocation) => Promise<void>) {
  const root = fileURLToPath(new URL('../../../runtime/operator-tests/', import.meta.url));
  await mkdir(root, {recursive: true});
  const folder = await mkdtemp(path.join(root, 'army-'));
  const config: Config = {environment: 'staging', tenantId: 'army-' + randomUUID(), timezone: 'Europe/Prague',
    host: '127.0.0.1', port: 18801, origin: 'http://127.0.0.1:18801', databasePath: path.join(folder, 'state.sqlite'),
    dataKey: randomBytes(32).toString('hex'), callbackKey: randomBytes(32).toString('hex'),
    adminPassword: randomBytes(32).toString('hex'), gatewayUrl: new URL('http://127.0.0.1:18809'),
    gatewayToken: 'synthetic', skillsRoot: fileURLToPath(new URL('../../skills/', import.meta.url)),
    enabledTools: tools, providerMode: 'fixture', maxAgentSteps: 4, maxToolCalls: 6,
    configurationHash: 'army-test', environmentValues: {}};
  const runtime = await createOperator(config, {complete: async () => ({text: 'Synthetic test', calls: []})}, {background: false});
  await runtime.app.ready();
  const actor = await runtime.store.call<Actor>('actor.get', {tenantId: config.tenantId, actorId: 'owner'});
  const conversationId = randomUUID();
  await runtime.store.call('conversation.create', {tenantId: actor.tenantId, actorId: actor.id, id: conversationId, now: Date.now()});
  const context: Invocation = {actor, environment: 'staging', conversationId, intentId: randomUUID(),
    channel: 'web', secure: true, confidence: 'high', source: 'user', signal: new AbortController().signal};
  try { await work(runtime, context); }
  finally { await runtime.app.close(); await rm(folder, {recursive: true, force: true}); }
}

test('army roster lists the five installed specialists', async () => {
  const roster = await armyRoster();
  assert.deepEqual(roster.map(entry => entry.name), ['analyzer', 'coder', 'mailer', 'researcher', 'scout']);
  assert.ok(roster.every(entry => entry.role.length > 10));
});

test('army spawn needs approval, creates queued children, collect reports honestly', async () => fixture(async (runtime, context) => {
  assert.equal(runtime.registry.list().find(skill => skill.id === 'jarvis_army')?.state, 'ready');
  const refused = await runtime.owner.invoke('jarvis_army', {operation: 'spawn', assignments: []}, context);
  assert.equal(refused.ok, false);
  const proposed = await runtime.owner.invoke('jarvis_army', {operation: 'spawn', assignments: [
    {specialist: 'researcher', task: 'synthetic research assignment'},
    {specialist: 'coder', task: 'synthetic code assignment'}], _confidence: 'high'}, context);
  assert.equal(proposed.ok, true);
  assert.equal(proposed.status, 'approval_required');
  const action = proposed.action as {id: string; inputHash: string; fingerprint: string};
  const decided = await runtime.actions.decide({...context, conversationId: ''}, action.id, 'approve',
    action.inputHash, action.fingerprint, randomUUID());
  assert.equal(decided.state, 'queued');
  const completed = await runtime.actions.runOne(action.id, context.actor.tenantId);
  assert.equal(completed?.state, 'succeeded', JSON.stringify({errorCode: completed?.errorCode}));
  const data = (completed?.result as {data?: {children?: Array<{specialist: string; conversationId: string; runId: string}>}}).data;
  assert.equal(data?.children?.length, 2);
  assert.equal(data?.children?.[0]?.specialist, 'researcher');
  const child = data?.children?.[0]!;
  assert.match(child.conversationId, /^[0-9a-f-]{36}$/i);
  const collected = await runtime.owner.invoke('jarvis_army',
    {operation: 'collect', conversationId: child.conversationId, runId: child.runId}, context);
  assert.equal(collected.ok, true);
}));
