import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOperator} from '../server.js';
import type {Config} from '../config.js';
import type {Actor, Invocation} from '../contracts.js';
import {ResilientHttp} from '../resilience.js';
import {matchStops, parsePlan, planAnswer, transitPlan} from '../transit.js';

const tools = ['jarvis_transit'];

const groups = [
  {name: 'Slaný,aut.nádr.', avgLat: 50.228508, avgLon: 14.0884485,
    stops: [{altIdosName: 'Slaný,aut.nádr.', lines: [{name: '627'}]}]},
  {name: 'Smečno', avgLat: 50.1887131, avgLon: 14.0428543,
    stops: [{altIdosName: 'Smečno', lines: [{name: '300'}, {name: '627'}]}]},
  {name: 'Smečno,Na Kopaninách', avgLat: 50.16876, avgLon: 14.0164928,
    stops: [{altIdosName: 'Smečno,Na Kopaninách', lines: [{name: '324'}]}]},
];

const planFixture = {itineraries: [{legs: [
  {mode: 'WALK', from: {name: 'START'}, to: {name: 'Smečno'}, startTime: '2026-10-13T19:12:00Z', endTime: '2026-10-13T19:13:00Z'},
  {mode: 'BUS', routeShortName: '627', from: {name: 'Smečno'}, to: {name: 'Slaný,aut.nádr.'}, startTime: '2026-10-13T19:13:00Z', endTime: '2026-10-13T19:37:00Z'},
]}]};

function stubHttp(body: string): ResilientHttp {
  return new ResilientHttp(undefined, (async () => new Response(body, {status: 200})) as unknown as typeof fetch,
    () => 0);
}

async function fixture(work: (runtime: Awaited<ReturnType<typeof createOperator>>, context: Invocation) => Promise<void>) {
  const root = fileURLToPath(new URL('../../../runtime/operator-tests/', import.meta.url));
  await mkdir(root, {recursive: true});
  const folder = await mkdtemp(path.join(root, 'transit-'));
  const index = path.join(folder, 'stops.json');
  await writeFile(index, JSON.stringify({downloadedAt: Date.now(), groups}));
  process.env.JARVIS_TRANSIT_STOPS = index;
  const config: Config = {environment: 'staging', tenantId: 'transit-' + randomUUID(), timezone: 'Europe/Prague',
    host: '127.0.0.1', port: 18801, origin: 'http://127.0.0.1:18801', databasePath: path.join(folder, 'state.sqlite'),
    dataKey: randomBytes(32).toString('hex'), callbackKey: randomBytes(32).toString('hex'),
    adminPassword: randomBytes(32).toString('hex'), gatewayUrl: new URL('http://127.0.0.1:18809'),
    gatewayToken: 'synthetic', skillsRoot: fileURLToPath(new URL('../../skills/', import.meta.url)),
    enabledTools: tools, providerMode: 'fixture', maxAgentSteps: 4, maxToolCalls: 6,
    configurationHash: 'transit-test', environmentValues: {}};
  const runtime = await createOperator(config, {complete: async () => ({text: 'Synthetic test', calls: []})}, {background: false});
  await runtime.app.ready();
  const actor = await runtime.store.call<Actor>('actor.get', {tenantId: config.tenantId, actorId: 'owner'});
  const conversationId = randomUUID();
  await runtime.store.call('conversation.create', {tenantId: actor.tenantId, actorId: actor.id, id: conversationId, now: Date.now()});
  const context: Invocation = {actor, environment: 'staging', conversationId, intentId: randomUUID(),
    channel: 'web', secure: true, confidence: 'high', source: 'user', signal: new AbortController().signal};
  try { await work(runtime, context); }
  finally { delete process.env.JARVIS_TRANSIT_STOPS; await runtime.app.close(); await rm(folder, {recursive: true, force: true}); }
}

test('stop matching tolerates diacritics and refuses to guess ambiguous names', () => {
  assert.deepEqual(matchStops(groups, 'Slaný autobusové nádraží').map(stop => stop.name), ['Slaný,aut.nádr.']);
  assert.deepEqual(matchStops(groups, 'smecno').map(stop => stop.name), ['Smečno']);
  assert.deepEqual(matchStops(groups, 'Smečno,Na').map(stop => stop.name), ['Smečno,Na Kopaninách']);
  assert.deepEqual(matchStops(groups, 'Xyzqwx'), []);
  assert.throws(() => matchStops(groups, 'x'),
    (error: unknown) => (error as {code?: string}).code === 'TRANSIT_QUERY_INVALID');
});

test('plan answers in one sentence with line, times and a deep link', async () => {
  const plans = parsePlan(planFixture);
  const answer = planAnswer({name: 'Smečno', lat: 50.18, lon: 14.04, lines: []},
    {name: 'Slaný,aut.nádr.', lat: 50.22, lon: 14.08, lines: []}, plans);
  assert.ok(String(answer.answer).includes('627'));
  assert.ok(String(answer.answer).includes('21:13'));
  assert.ok(String(answer.deepLink).includes('google.com/maps/dir'));
  assert.equal(answer.status, 'ready');
});

test('the full path resolves, plans and falls back honestly', async () => fixture(async (runtime, context) => {
  assert.equal(runtime.registry.list().find(skill => skill.id === 'jarvis_transit')?.state, 'ready');
  const http = stubHttp(JSON.stringify(planFixture));
  const done = await transitPlan({from: 'Smečno', to: 'Slaný autobusové nádraží'}, new AbortController().signal, http);
  assert.equal(done.status, 'ready');
  assert.ok(String(done.answer).includes('627'));
  const ambiguous = await transitPlan({from: 'Slaný autobusové nádraží', to: 'Smečn'}, new AbortController().signal, http);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.ok((ambiguous.candidates as {to: string[]}).to.length >= 2);
  const unknown = await transitPlan({from: 'Xyzqwx', to: 'Slaný'}, new AbortController().signal, http);
  assert.equal(unknown.status, 'unknown_stop');
  const empty = await transitPlan({from: 'Smečno', to: 'Slaný autobusové nádraží'}, new AbortController().signal,
    stubHttp(JSON.stringify({itineraries: []})));
  assert.equal(empty.status, 'no_connection');
  assert.ok(String(empty.deepLink).includes('google.com/maps/dir'));
}));
