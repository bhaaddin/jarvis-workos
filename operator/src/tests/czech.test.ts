import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOperator} from '../server.js';
import type {Config} from '../config.js';
import type {Actor, Invocation} from '../contracts.js';
import {ResilientHttp} from '../resilience.js';
import {aresLookup, cnbRates, czechCalc, czechHolidays, czechToIban, icoCheckDigit, parseAres, parseCnb, qrPlatba, validateIban, validateIco, workingDays} from '../czech.js';

const tools = ['jarvis_ares', 'jarvis_cnb', 'jarvis_czech_calc', 'jarvis_owner_todo'];

async function fixture(work: (runtime: Awaited<ReturnType<typeof createOperator>>, context: Invocation) => Promise<void>) {
  const root = fileURLToPath(new URL('../../../runtime/operator-tests/', import.meta.url));
  await mkdir(root, {recursive: true});
  const folder = await mkdtemp(path.join(root, 'czech-'));
  const config: Config = {environment: 'staging', tenantId: 'czech-' + randomUUID(), timezone: 'Europe/Prague',
    host: '127.0.0.1', port: 18801, origin: 'http://127.0.0.1:18801', databasePath: path.join(folder, 'state.sqlite'),
    dataKey: randomBytes(32).toString('hex'), callbackKey: randomBytes(32).toString('hex'),
    adminPassword: randomBytes(32).toString('hex'), gatewayUrl: new URL('http://127.0.0.1:18809'),
    gatewayToken: 'synthetic', skillsRoot: fileURLToPath(new URL('../../skills/', import.meta.url)),
    enabledTools: tools, providerMode: 'fixture', maxAgentSteps: 4, maxToolCalls: 6,
    configurationHash: 'czech-test', environmentValues: {}};
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

const codeIs = (code: string) => (error: unknown) => (error as {code?: string}).code === code;

test('IČO checksum follows the ČSÚ algorithm on real identifiers', () => {
  assert.equal(icoCheckDigit('4524478'), 2); // Česká spořitelna
  assert.equal(icoCheckDigit('2559664'), 1); // published example
  assert.deepEqual(validateIco('45244782'), {valid: true, expected: 2});
  assert.deepEqual(validateIco('25596641'), {valid: true, expected: 1});
  assert.equal(validateIco('12345678').valid, false);
  assert.throws(() => validateIco('123'), codeIs('ICO_FORMAT_INVALID'));
});

test('IBAN round-trips between Czech account and validated IBAN', () => {
  assert.deepEqual(czechToIban('0800', '19', '2000145399'), {iban: 'CZ6508000000192000145399'});
  assert.deepEqual(validateIban('CZ6508000000192000145399'), {valid: true, normalized: 'CZ6508000000192000145399'});
  assert.equal(validateIban('CZ6508000000192000145398').valid, false);
  assert.throws(() => validateIban('not-an-iban'), codeIs('IBAN_FORMAT_INVALID'));
  assert.throws(() => czechToIban('08', '', '1'), codeIs('CZ_ACCOUNT_INVALID'));
});

test('QR platba builds a SPAYD payload and strips diacritics', () => {
  assert.deepEqual(qrPlatba({iban: 'CZ6508000000192000145399', amount: 450.5, currency: 'CZK', vs: '123'}),
    {payload: 'SPD*1.0*ACC:CZ6508000000192000145399*AM:450.50*CC:CZK*X-VS:123'});
  assert.ok(qrPlatba({iban: 'CZ6508000000192000145399', amount: 1, message: 'Příliš žluťoučký'}).payload.endsWith('*MSG:Prilis zlutoucky'));
  assert.throws(() => qrPlatba({iban: 'CZ6508000000192000145399', amount: -1}), codeIs('QR_AMOUNT_INVALID'));
});

test('Czech calendar counts working days around Easter 2026', () => {
  assert.deepEqual(czechHolidays(2026).filter(day => day.startsWith('2026-04')), ['2026-04-03', '2026-04-06']);
  assert.deepEqual(workingDays('2026-10-12', '2026-10-19'), {from: '2026-10-12', to: '2026-10-19', workingDays: 5});
  assert.deepEqual(workingDays('2026-04-02', '2026-04-08'),
    {from: '2026-04-02', to: '2026-04-08', workingDays: 2});
  assert.throws(() => workingDays('2026-10-19', '2026-10-12'), codeIs('DATE_RANGE_INVALID'));
});

const aresFixture = {obchodniJmeno: 'Česká spořitelna, a.s.',
  sidlo: {textovaAdresa: 'Olbrachtova 1929/62, Krč, 14000 Praha 4'}, pravniForma: '121',
  czNace: ['64190'], seznamRegistraci: {stavZdrojeRos: 'AKTIVNI', stavZdrojeDph: 'NEEXISTUJICI'},
  dicSkDph: 'CZ699001261', datumVzniku: '1991-12-30', datumAktualizace: '2026-08-20'};

const cnbFixture = '13.10.2026 #197\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|24,375\nUSA|dolar|1|USD|21,788\n';

function stubHttp(body: string, status = 200): ResilientHttp {
  return new ResilientHttp(undefined, (async () => new Response(body, {status})) as unknown as typeof fetch,
    () => 0);
}

test('ARES responses project to bounded company records', async () => {
  const record = parseAres('45244782', aresFixture);
  assert.equal(record.name, 'Česká spořitelna, a.s.');
  assert.equal(record.vatPayer, true);
  assert.equal(record.active, true);
  assert.equal(record.checksumValid, true);
  const observed = await aresLookup({ico: '45244782'}, new AbortController().signal, stubHttp(JSON.stringify(aresFixture)));
  assert.equal((observed as {name: string}).name, 'Česká spořitelna, a.s.');
  await assert.rejects(aresLookup({ico: '00000000'}, new AbortController().signal, stubHttp('{}', 404)), codeIs('ARES_NOT_FOUND'));
  await assert.rejects(aresLookup({ico: '123'}, new AbortController().signal, stubHttp('{}')), codeIs('ICO_FORMAT_INVALID'));
});

test('CNB tables parse Czech decimals and filter currencies', async () => {
  const table = parseCnb(cnbFixture);
  assert.equal((table as {date: string}).date, '2026-10-13');
  assert.equal((table as {rates: Array<{code: string}>}).rates.length, 2);
  assert.deepEqual(parseCnb(cnbFixture, 'USD'),
    {date: '2026-10-13', base: 'CZK', country: 'USA', currency: 'dolar', amount: 1, code: 'USD', rateCzk: 21.788});
  assert.throws(() => parseCnb(cnbFixture, 'XXX'), codeIs('CURRENCY_NOT_FOUND'));
  const observed = await cnbRates({currency: 'EUR'}, new AbortController().signal, stubHttp(cnbFixture));
  assert.equal((observed as {rateCzk: number}).rateCzk, 24.375);
});

test('Czech tools are registered and the owner checklist stays secret-free', async () => fixture(async (runtime, context) => {
  for (const id of tools) assert.equal(runtime.registry.list().find(skill => skill.id === id)?.state, 'ready', id);
  const calc = await runtime.owner.invoke('jarvis_czech_calc', {operation: 'holidays', year: 2026}, context);
  assert.equal(calc.ok, true);
  assert.ok(JSON.stringify(calc).includes('2026-04-06'));
  const todo = await runtime.owner.invoke('jarvis_owner_todo', {}, context);
  assert.equal(todo.ok, true);
  const data = (todo.result as {data: {credentialSteps: Array<{integration: string; need: string}>}}).data;
  assert.ok(data.credentialSteps.length >= 5);
  assert.ok(!/(gho_|sk-|AKIA|Bearer [A-Za-z0-9])/ .test(JSON.stringify(todo)));
}));
