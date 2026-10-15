import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createOperator} from '../server.js';
import type {Config} from '../config.js';
import type {AgentMessage, Model, ModelResponse, ObjectValue} from '../contracts.js';

class QuietModel implements Model {
  async complete(_messages: AgentMessage[], _tools: ObjectValue[], _signal: AbortSignal): Promise<ModelResponse> {
    return {text: 'synthetic', calls: []};
  }
}

const firm = {tenant: 'stage-firm', displayName: 'Synthetic firm', industry: 'trades', languages: ['cs', 'en'],
  tone: 'Short bullets.', workingHours: {timezone: 'Europe/Prague'}, approvalDefaults: {external: 'ask', money: 'never'},
  fieldPacks: ['office'], branding: {symbol: 'J'}, billingNote: 'Pilot invoicing is manual.'};

async function runtime(run: (value: Awaited<ReturnType<typeof createOperator>>, config: Config) => Promise<void>, withFirm: boolean): Promise<void> {
  const base = fileURLToPath(new URL('../../../runtime/operator-tests/', import.meta.url));
  await mkdir(base, {recursive: true});
  const folder = await mkdtemp(path.join(base, 'firm-'));
  const config: Config = {environment: 'staging', tenantId: 'stage-firm', timezone: 'Europe/Prague', host: '127.0.0.1', port: 18801,
    origin: 'http://127.0.0.1:18801', databasePath: path.join(folder, 'state.sqlite'), dataKey: randomBytes(32).toString('hex'),
    callbackKey: randomBytes(32).toString('hex'), adminPassword: randomBytes(32).toString('hex'),
    gatewayUrl: new URL('http://127.0.0.1:18809'), gatewayToken: 'unused',
    skillsRoot: fileURLToPath(new URL('../../skills/', import.meta.url)), enabledTools: [], providerMode: 'fixture',
    maxAgentSteps: 4, maxToolCalls: 6, configurationHash: 'firm-test', environmentValues: {}, ...(withFirm ? {firm} : {})};
  const value = await createOperator(config, new QuietModel(), {background: false});
  try { await value.app.ready(); await run(value, config); } finally { await value.app.close(); await rm(folder, {recursive: true, force: true}); }
}

async function login(value: Awaited<ReturnType<typeof createOperator>>, config: Config) {
  const response = await value.app.inject({method: 'POST', url: '/api/auth/login', headers: {origin: config.origin}, payload: {login: 'matko', password: config.adminPassword}});
  assert.equal(response.statusCode, 200, response.body);
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  return {cookie, origin: config.origin, 'x-csrf-token': response.json().csrf as string};
}

test('firm profile serves the configured tenant profile without secrets', async () => runtime(async (value, config) => {
  assert.equal((await value.app.inject('/api/firm/profile')).statusCode, 401);
  const headers = await login(value, config);
  const response = await value.app.inject({method: 'GET', url: '/api/firm/profile', headers});
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json() as {firm: typeof firm | null; tenant: string};
  assert.equal(body.tenant, 'stage-firm');
  assert.equal(body.firm?.displayName, 'Synthetic firm');
  assert.deepEqual(body.firm?.languages, ['cs', 'en']);
  assert.deepEqual(body.firm?.fieldPacks, ['office']);
  const serialized = JSON.stringify(body);
  assert(!serialized.includes(config.dataKey) && !serialized.includes(config.callbackKey) && !serialized.includes(config.adminPassword));
}, true));

test('firm profile reports null when no firm is configured', async () => runtime(async (value, config) => {
  const headers = await login(value, config);
  const response = await value.app.inject({method: 'GET', url: '/api/firm/profile', headers});
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().firm, null);
}, false));
