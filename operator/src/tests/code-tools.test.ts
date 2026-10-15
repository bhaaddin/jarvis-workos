import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOperator} from '../server.js';
import type {Config} from '../config.js';
import type {Actor, Invocation, ToolContext} from '../contracts.js';
import {codeWorkspace} from '../code-tools.js';

const tools = ['jarvis_code', 'jarvis_code_read'];

async function fixture(work: (runtime: Awaited<ReturnType<typeof createOperator>>, context: Invocation, project: string) => Promise<void>) {
  const root = fileURLToPath(new URL('../../../runtime/operator-tests/', import.meta.url));
  await mkdir(root, {recursive: true});
  const folder = await mkdtemp(path.join(root, 'code-'));
  const project = path.join(folder, 'demo');
  await mkdir(project, {recursive: true});
  await writeFile(path.join(project, 'notes.txt'), 'line one\nneedle here\nline three\n');
  await writeFile(path.join(project, 'dup.txt'), 'repeat block repeat block\n');
  await writeFile(path.join(project, 'bad.js'), 'function run(query) { return eval(query); }\nrun("1+1");\n');
  process.env.JARVIS_CODE_CONFIG = path.join(folder, 'code.json');
  await writeFile(process.env.JARVIS_CODE_CONFIG, JSON.stringify({projects: [{id: 'demo', path: project},
    {id: 'closed', path: project, access: 'off'}]}));
  const config: Config = {environment: 'staging', tenantId: 'code-' + randomUUID(), timezone: 'Europe/Prague',
    host: '127.0.0.1', port: 18801, origin: 'http://127.0.0.1:18801', databasePath: path.join(folder, 'state.sqlite'),
    dataKey: randomBytes(32).toString('hex'), callbackKey: randomBytes(32).toString('hex'),
    adminPassword: randomBytes(32).toString('hex'), gatewayUrl: new URL('http://127.0.0.1:18809'),
    gatewayToken: 'synthetic', skillsRoot: fileURLToPath(new URL('../../skills/', import.meta.url)),
    enabledTools: tools, providerMode: 'fixture', maxAgentSteps: 4, maxToolCalls: 6,
    configurationHash: 'code-test', environmentValues: {}};
  const runtime = await createOperator(config, {complete: async () => ({text: 'Synthetic test', calls: []})}, {background: false});
  await runtime.app.ready();
  const actor = await runtime.store.call<Actor>('actor.get', {tenantId: config.tenantId, actorId: 'owner'});
  const conversationId = randomUUID();
  await runtime.store.call('conversation.create', {tenantId: actor.tenantId, actorId: actor.id, id: conversationId, now: Date.now()});
  const context: Invocation = {actor, environment: 'staging', conversationId, intentId: randomUUID(),
    channel: 'web', secure: true, confidence: 'high', source: 'user', signal: new AbortController().signal};
  try { await work(runtime, context, 'demo'); }
  finally { delete process.env.JARVIS_CODE_CONFIG; await runtime.app.close(); await rm(folder, {recursive: true, force: true}); }
}

function toolContext(context: Invocation): ToolContext {
  return {...context, actionId: randomUUID(), idempotencyKey: randomUUID(),
    assertCurrent: async () => {}, services: {invoke: async () => { throw new Error('unbound'); }}};
}

test('code reads are paged and jailed to the working root', async () => fixture(async (runtime, context, project) => {
  assert.equal(runtime.registry.list().find(skill => skill.id === 'jarvis_code')?.state, 'ready');
  const stub = toolContext(context);
  const codeOf = (error: unknown) => (error as {code?: string}).code === undefined ? false : (error as {code?: string}).code;
  const page = await codeWorkspace({operation: 'read', project, path: 'notes.txt', start: 2, limit: 1}, stub);
  assert.deepEqual(page.lines, ['needle here']);
  assert.equal(page.totalLines, 4);
  await assert.rejects(codeWorkspace({operation: 'read', project, path: '../outside.txt'}, stub),
    (error: unknown) => codeOf(error) === 'CODE_PATH_INVALID');
  await assert.rejects(codeWorkspace({operation: 'read', project: project, path: '.'}, stub),
    (error: unknown) => codeOf(error) === 'CODE_PATH_INVALID');
  await assert.rejects(codeWorkspace({operation: 'read', project: 'unknown', path: 'notes.txt'}, stub),
    (error: unknown) => codeOf(error) === 'CODE_PROJECT_UNKNOWN');
  await assert.rejects(codeWorkspace({operation: 'read', project, path: '.env'}, stub),
    (error: unknown) => codeOf(error) === 'CODE_SECRET_REFUSED');
}));

test('switched-off projects refuse all code operations', async () => fixture(async (runtime, context, project) => {
  const stub = toolContext(context);
  await assert.rejects(codeWorkspace({operation: 'read', project: 'closed', path: 'notes.txt'}, stub),
    (error: unknown) => (error as {code?: string}).code === 'CODE_PROJECT_DISABLED');
}));

test('code edits require exactly one match and record a hash', async () => fixture(async (runtime, context, project) => {
  const stub = toolContext(context);
  const ambiguous = (error: unknown) => (error as {code?: string}).code === 'CODE_EDIT_AMBIGUOUS';
  await assert.rejects(codeWorkspace({operation: 'edit', project, path: 'notes.txt', oldText: 'absent block here!!', newText: 'x'}, stub), ambiguous);
  await assert.rejects(codeWorkspace({operation: 'edit', project, path: 'dup.txt', oldText: 'repeat block', newText: 'x'}, stub), ambiguous);
  const done = await codeWorkspace({operation: 'edit', project, path: 'notes.txt', oldText: 'needle here', newText: 'needle replaced'}, stub);
  assert.equal(done.replacements, 1);
  assert.match(String(done.sha256), /^[a-f0-9]{64}$/);
  const again = await codeWorkspace({operation: 'read', project, path: 'notes.txt'}, stub);
  assert.ok((again.lines as string[]).join('\n').includes('needle replaced'));
}));

test('code runs execute bounded commands and refuse destructive ones', async () => fixture(async (runtime, context, project) => {
  const stub = toolContext(context);
  const ok = await codeWorkspace({operation: 'run', project, command: 'Write-Output hello-code'}, stub);
  assert.equal(ok.exitCode, 0);
  assert.ok(String(ok.stdout).includes('hello-code'));
  const refused = (error: unknown) => (error as {code?: string}).code === 'CODE_COMMAND_REFUSED';
  await assert.rejects(codeWorkspace({operation: 'run', project, command: 'rm -rf / --no-preserve-root'}, stub), refused);
  await assert.rejects(codeWorkspace({operation: 'run', project, command: 'git push origin main --force'}, stub), refused);
  await assert.rejects(codeWorkspace({operation: 'run', project, command: 'git reset --hard HEAD'}, stub), refused);
  const git = await codeWorkspace({operation: 'run', project, command: 'git status --short'}, stub) as {exitCode: number};
  assert.ok(typeof git.exitCode === 'number', 'plain git commands pass validation and execute');
}));

test('code scans report rule findings inside the working root only', async () => fixture(async (runtime, context, project) => {
  const stub = toolContext(context);
  const rule = 'rules:\n  - id: test-dangerous-eval\n    patterns:\n      - pattern: eval(...)\n    message: Test eval use\n    severity: WARNING\n    languages: [javascript]\n';
  const folder = path.dirname(process.env.JARVIS_CODE_CONFIG as string);
  const rulePath = path.join(folder, 'test-rule.yaml');
  await writeFile(rulePath, rule);
  process.env.JARVIS_SEMGREP_CONFIG = rulePath;
  try {
    const report = await codeWorkspace({operation: 'scan', project}, stub) as
      {findingCount: number; findings: Array<{rule: string; path: string}>};
    assert.ok(report.findingCount >= 1);
    assert.ok(report.findings.some(finding => finding.rule.endsWith('test-dangerous-eval') && finding.path.endsWith('bad.js')));
    await assert.rejects(codeWorkspace({operation: 'scan', project, workdir: '../outside'}, stub),
      (error: unknown) => (error as {code?: string}).code === 'CODE_PATH_INVALID');
  } finally {
    delete process.env.JARVIS_SEMGREP_CONFIG;
  }
}));

test('code edits need approval first, then run once after tap-approve', async () => fixture(async (runtime, context, project) => {
  const proposed = await runtime.owner.invoke('jarvis_code',
    {operation: 'edit', project, path: 'notes.txt', oldText: 'needle here', newText: 'approved edit', _confidence: 'high'}, context);
  assert.equal(proposed.ok, true);
  assert.equal(proposed.status, 'approval_required');
  const action = proposed.action as {id: string; inputHash: string; fingerprint: string};
  const decided = await runtime.actions.decide({...context, conversationId: ''}, action.id, 'approve',
    action.inputHash, action.fingerprint, randomUUID());
  assert.equal(decided.state, 'queued');
  const completed = await runtime.actions.runOne(action.id, context.actor.tenantId);
  assert.equal(completed?.state, 'succeeded', JSON.stringify({errorCode: completed?.errorCode, result: completed?.result}));
  const read = await runtime.owner.invoke('jarvis_code_read',
    {project, path: 'notes.txt'}, context);
  assert.equal(read.ok, true, JSON.stringify(read).slice(0, 800));
  assert.ok(JSON.stringify(read).includes('approved edit'));
}));
