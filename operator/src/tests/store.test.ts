import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Store} from '../store.js';
import type {Action, Actor, ObjectValue, ToolManifest} from '../contracts.js';
import {Seal} from '../privacy.js';
import {DatabaseSync} from 'node:sqlite';
import type {ClaimedScheduledJob, Schedule, ScheduledJob} from '../schedule-contracts.js';
import {nextOccurrence} from '../store-schedules.js';

const permissions = ['operator.chat','memory.read','memory.write','actions.read','actions.approve','actions.cancel','settings.write','users.manage','audit.read','sample.send','sample.read','schedule.manage'];
const manifest: ToolManifest = {manifestVersion: 1, id: 'jarvis_sample_send', version: '1.0.0', description: 'Synthetic write',
  handler: 'handler.mjs', environments: ['staging'], permissions: ['sample.send'], risk: 'external_write', serviceOperations: ['fixture.send'], sensitivity: 'internal', requires: [],
  inputSchema: {type: 'object'}, outputSchema: {type: 'object'}, idempotent: false, supportsUndo: false, publicProjection: false, timeoutMs: 5000};
const descriptor = {manifest: JSON.parse(JSON.stringify(manifest)) as ObjectValue, artifactHash: 'artifact-v1', fingerprint: 'tool-v1',
  health: {id: manifest.id, version: '1.0.0', fingerprint: 'tool-v1', enabled: true, state: 'ready', mode: 'fixture', missing: []}};
const base = {tenantId: 'clinic-a', actorId: 'owner', now: 1000000};

async function fixture(run: (store: Store, database: string, key: string) => Promise<void>): Promise<void> {
  const directory = fileURLToPath(new URL('../../../runtime/operator-tests/', import.meta.url));
  await mkdir(directory, {recursive: true});
  const folder = await mkdtemp(path.join(directory, 'case-'));
  const database = path.join(folder, 'state.sqlite'), key = randomBytes(32).toString('hex');
  const store = new Store({path: database, key, environment: 'staging'});
  try {
    await store.ready;
    await store.call('bootstrap', {...base, id: 'owner', login: 'owner', displayName: 'Synthetic Owner',
      roles: ['owner'], permissions, language: 'en', timezone: 'Europe/Prague', passwordHash: 'synthetic-hash'});
    await store.call('conversation.create', {...base, id: 'conversation-a'});
    await store.call('skill.sync', {skills: [descriptor]});
    await run(store, database, key);
  } finally { await store.close(); await rm(folder, {recursive: true, force: true}); }
}

async function propose(store: Store, submissionKey = 'submission-1'): Promise<Action> {
  return store.call<Action>('action.propose', {tool: manifest.id, now: base.now, input: {recipient: 'synthetic@example.test', body: 'Synthetic message'}, submissionKey,
    scope: {...base, conversationId: 'conversation-a', intentId: 'intent-1', channel: 'web', secure: true, confidence: 'high', source: 'user'}});
}

async function approve(store: Store, action: Action): Promise<Action> {
  const result = await store.call<Action>('action.decide', {...base, id: action.id, decision: 'approve', eventKey: 'button-' + action.id,
    inputHash: action.inputHash, fingerprint: action.fingerprint, secure: true});
  await store.call('action.enqueue', {...base, id: action.id});
  return result;
}

test('external effects require a bound approval, are deduplicated, and claim once', async () => fixture(async store => {
  const action = await propose(store);
  assert.equal(action.state, 'awaiting_approval');
  assert.equal((await propose(store)).id, action.id);
  await assert.rejects(store.call('action.enqueue', {...base, id: action.id}), /Approval is required/);
  await assert.rejects(store.call('action.decide', {...base, id: action.id, decision: 'approve', eventKey: 'bad', inputHash: 'stale', fingerprint: action.fingerprint, secure: true}), /stale/);
  await approve(store, action);
  const claims = await Promise.all([1,2].map(() => store.call<Action | null>('action.claim', {now: base.now + 10001, leaseMs: 30000})));
  assert.equal(claims.filter(Boolean).length, 1);
  const claimed = claims.find((value): value is Action => value !== null)!;
  await store.call('action.authorize', {...base, now: base.now + 10002, id: claimed.id, leaseToken: claimed.leaseToken, dispatch: true});
  const done = await store.call<Action>('action.complete', {...base, now: base.now + 10003, id: claimed.id, leaseToken: claimed.leaseToken,
    outcome: 'success', result: {data: {providerId: 'synthetic-1'}, sensitivity: 'internal'}, receipt: {id: 'synthetic-1'}});
  assert.equal(done.state, 'succeeded');
  const replay = await store.call<Action>('action.decide', {...base, id: action.id, decision: 'approve', eventKey: 'button-' + action.id,
    inputHash: action.inputHash, fingerprint: action.fingerprint, secure: true});
  assert.equal(replay.state, 'succeeded');
}));

test('revocation after approval fences execution', async () => fixture(async store => {
  const action = await propose(store); await approve(store, action);
  await store.call('actor.update', {...base, id: 'owner', permissions: permissions.filter(value => value !== 'sample.send')});
  assert.equal(await store.call('action.claim', {now: base.now + 10001, leaseMs: 30000}), null);
  assert.equal((await store.call<Action>('action.get', {...base, id: action.id, secure: true})).state, 'denied');
}));

test('crash after dispatch becomes uncertain; a stale worker cannot overwrite it', async () => fixture(async store => {
  const action = await propose(store); await approve(store, action);
  const claim = await store.call<Action>('action.claim', {now: base.now + 10001, leaseMs: 1000});
  await store.call('action.authorize', {...base, now: base.now + 10002, id: claim.id, leaseToken: claim.leaseToken, dispatch: true});
  assert.equal(await store.call('action.claim', {now: base.now + 12000, leaseMs: 1000}), null);
  await assert.rejects(store.call('action.complete', {...base, now: base.now + 12001, id: claim.id, leaseToken: claim.leaseToken,
    attemptId: claim.attemptId, outcome: 'success', result: {data: {}, sensitivity: 'internal'}}), /late result/);
  assert.equal((await store.call<Action>('action.get', {...base, id: action.id, secure: true})).state, 'uncertain');
}));

test('expiry transition commits even when approval is rejected', async () => fixture(async store => {
  const action = await propose(store);
  await assert.rejects(store.call('action.decide', {...base, now: action.expiresAt + 1, id: action.id, secure: true,
    decision: 'approve', eventKey: 'expired', inputHash: action.inputHash, fingerprint: action.fingerprint}), /no longer authorized/);
  assert.equal((await store.call<Action>('action.get', {...base, id: action.id, secure: true})).state, 'expired');
}));

test('private memory persists across restart but is ciphertext on disk and tenant-scoped', async () => fixture(async (store, database, key) => {
  const privateValue = 'SYNTHETIC_PERSON_8496 recurring preference';
  await store.call('memory.put', {...base, secure: true, kind: 'fact', key: 'Recurring contact', value: privateValue, sensitivity: 'pii'});
  await assert.rejects(store.call('memory.search', {...base, secure: false, query: 'recurring'}), /secure application/);
  await store.call('bootstrap', {...base, tenantId: 'clinic-b', id: 'owner', login: 'owner', displayName: 'Other synthetic owner',
    roles: ['owner'], permissions, language: 'en', timezone: 'Europe/Prague', passwordHash: 'synthetic-hash'});
  assert.deepEqual(await store.call('memory.search', {...base, tenantId: 'clinic-b', secure: true, query: 'recurring'}), []);
  await store.close();
  assert.equal((await readFile(database)).includes(Buffer.from(privateValue)), false);
  const resumed = new Store({path: database, key, environment: 'staging'});
  try {
    await resumed.ready;
    const matches = await resumed.call<Array<{record: {value: string}}>>('memory.search', {...base, secure: true, query: 'recurring'});
    assert.equal(matches[0]?.record.value, privateValue);
  } finally { await resumed.close(); }
}));

test('skill code cannot silently change under the same version across restarts', async () => fixture(async store => {
  const changed = {...descriptor, artifactHash: 'modified-code', fingerprint: 'modified-tool'};
  for (let index = 0; index < 2; index++) {
    const health = await store.call<Array<{state: string}>>('skill.sync', {skills: [changed]});
    assert.equal(health[0]?.state, 'changed_without_version');
  }
  const bumped = {...changed, manifest: {...descriptor.manifest, version: '1.0.1'}};
  const health = await store.call<Array<{state: string}>>('skill.sync', {skills: [bumped]});
  assert.equal(health[0]?.state, 'ready');
}));

test('authenticated encryption rejects cross-record binding and nonfinite payloads', () => {
  const seal = new Seal(randomBytes(32));
  const sealed = seal.seal({private: 'synthetic'}, 'tenant-a:record-1');
  assert.throws(() => seal.open(sealed, 'tenant-b:record-1'), /could not be verified/);
  assert.throws(() => seal.seal({amount: Number.NaN}, 'record'), /Finite/);
});

test('a pending interruption notice survives restart and is recorded exactly once',async()=>fixture(async(store,database,key)=>{
  const id='interrupted-run';
  await store.call('run.accept',{...base,id,conversationId:'conversation-a',message:'Synthetic interrupted task'});
  await store.call('run.claim',{now:base.now});
  await store.call('message.append',{...base,conversationId:'conversation-a',role:'user',message:{role:'user',content:'Synthetic interrupted task'},sensitivity:'pii'});
  await store.call('run.cancel',{...base,conversationId:'conversation-a',id});
  await store.close();
  const resumed=new Store({path:database,key,environment:'staging'});
  try{
    await resumed.ready;
    await resumed.call('run.recover',{now:base.now+1});
    await resumed.call('run.recover',{now:base.now+2});
    const history=await resumed.call<Array<{message:{role:string;content:string}}>>('message.history',{...base,conversationId:'conversation-a',secure:true});
    assert.equal(history.length,2);assert.equal(history[1]?.message.role,'system');
    assert(history[1]?.message.content.includes('Do not resume it'));
    assert.equal((await resumed.call<ObjectValue>('run.get',{...base,id,secure:true})).state,'cancelled');
  }finally{await resumed.close();}
}));

async function schedule(store:Store):Promise<Schedule> {
  const read={...descriptor,manifest:{...descriptor.manifest,id:'jarvis_sample_read',risk:'read',permissions:['sample.read']},
    fingerprint:'read-v1',artifactHash:'read-artifact-v1',health:{...descriptor.health,id:'jarvis_sample_read',fingerprint:'read-v1'}};
  await store.call('skill.sync',{skills:[descriptor,read]});
  return store.call('schedule.put',{...base,id:'schedule-a',expectedRevision:0,tool:'jarvis_sample_read',fingerprint:'read-v1',
    input:{query:'SYNTHETIC_SCHEDULE_PRIVATE_8362'},cron:'*/5 * * * *',timezone:'Europe/Prague',enabled:true,secure:true});
}

test('schedule admission is read-only, revision-bound and minute-resolution; cron honors Czech daylight saving',async()=>fixture(async store=>{
  const created=await schedule(store);
  const change={...base,id:created.id,expectedRevision:created.revision,tool:created.tool,fingerprint:created.fingerprint,input:created.input,
    cron:created.cron,timezone:created.timezone,enabled:true,secure:true};
  await assert.rejects(store.call('schedule.put',{...change,tool:manifest.id,fingerprint:'tool-v1'}),/read-only/);
  await assert.rejects(store.call('schedule.put',{...change,expectedRevision:0}),/Reload the schedule/);
  await assert.rejects(store.call('schedule.put',{...change,cron:'* * * * * *'}),/five-field/);
  assert.equal(new Date(nextOccurrence('0 9 * * *','Europe/Prague',Date.parse('2026-03-28T08:00:00Z'),'fixed')).toISOString(),'2026-03-29T07:00:00.000Z');
  assert.equal(new Date(nextOccurrence('0 9 * * *','Europe/Prague',Date.parse('2026-10-24T07:00:00Z'),'fixed')).toISOString(),'2026-10-25T08:00:00.000Z');
}));

test('schedule triggers coalesce downtime and overlapping ticks; restart fences stale read workers',async()=>fixture(async(store,database,key)=>{
  const created=await schedule(store),now=created.nextRun+3600000;
  const triggered=await Promise.all([1,2].map(()=>store.call<{created:number}>('schedule.dispatch',{now})));
  assert.equal(triggered.reduce((sum,value)=>sum+value.created,0),1);
  const claimed=await store.call<ClaimedScheduledJob>('schedule.claim',{now});
  assert.equal(await store.call('schedule.claim',{now}),null);
  assert.deepEqual(await store.call('schedule.dispatch',{now:now+300000}),{created:0});
  await store.close();
  assert.equal((await readFile(database)).includes(Buffer.from('SYNTHETIC_SCHEDULE_PRIVATE_8362')),false);
  const resumed=new Store({path:database,key,environment:'staging'});
  try {
    await resumed.ready;
    const current=await resumed.call<ClaimedScheduledJob>('schedule.claim',{now:now+120001});
    assert.equal(current.job.id,claimed.job.id);assert.notEqual(current.job.leaseToken,claimed.job.leaseToken);assert.equal(current.job.attempts,2);
    await assert.rejects(resumed.call('schedule.complete',{tenantId:base.tenantId,id:claimed.job.id,leaseToken:claimed.job.leaseToken,now:now+120002,result:{ok:true}}),/no longer owns/);
    const completed=await resumed.call<ScheduledJob>('schedule.complete',{tenantId:base.tenantId,id:current.job.id,leaseToken:current.job.leaseToken,now:now+120002,result:{ok:true,value:'SYNTHETIC_SCHEDULE_PRIVATE_8362'}});
    assert.equal(completed.state,'completed');
    const notes=await resumed.call<Array<{id:string;sequence:number;data:ObjectValue}>>('notification.list',{...base,now});
    assert.equal(notes.length,1);assert(!JSON.stringify(notes).includes('SYNTHETIC_SCHEDULE_PRIVATE_8362'));
    await resumed.call('notification.ack',{...base,id:notes[0]!.id});
    assert.deepEqual(await resumed.call('notification.list',{...base,after:notes[0]!.sequence}),[]);
  }finally{await resumed.close();}
}));

test('schedule edits fence in-flight results and revoked owners pause future checks',async()=>fixture(async store=>{
  const created=await schedule(store),now=created.nextRun;
  await store.call('schedule.dispatch',{now});
  const claimed=await store.call<ClaimedScheduledJob>('schedule.claim',{now});
  const edited=await store.call<Schedule>('schedule.put',{...base,now:now+1,id:created.id,expectedRevision:created.revision,tool:created.tool,fingerprint:created.fingerprint,
    input:created.input,cron:created.cron,timezone:created.timezone,enabled:false,secure:true});
  await assert.rejects(store.call('schedule.authorize',{tenantId:base.tenantId,id:claimed.job.id,leaseToken:claimed.job.leaseToken,now:now+2}),/no longer owns/);
  const late=await store.call<ScheduledJob>('schedule.complete',{tenantId:base.tenantId,id:claimed.job.id,leaseToken:claimed.job.leaseToken,now:now+2,result:{ok:true,private:'late result'}});
  assert.equal(late.state,'cancelled');assert.equal(late.result,null);
  const enabled=await store.call<Schedule>('schedule.put',{...base,now:now+3,id:created.id,expectedRevision:edited.revision,tool:created.tool,fingerprint:created.fingerprint,
    input:created.input,cron:created.cron,timezone:created.timezone,enabled:true,secure:true});
  await store.call('actor.update',{...base,id:'owner',permissions:permissions.filter(permission=>permission!=='sample.read')});
  assert.deepEqual(await store.call('schedule.dispatch',{now:enabled.nextRun}),{created:0});
  const list=await store.call<Schedule[]>('schedule.list',{...base,secure:true});
  assert.equal(list[0]?.enabled,false);assert.equal(list[0]?.reason,'authority_or_skill_changed');
}));

test('a private effect result raises durable action sensitivity and cannot be retrieved on an insecure channel',async()=>fixture(async store=>{
  const proposed=await propose(store);await approve(store,proposed);
  const claimed=await store.call<Action>('action.claim',{now:base.now+10001,leaseMs:30000});
  await store.call('action.authorize',{...base,now:base.now+10002,id:claimed.id,leaseToken:claimed.leaseToken,dispatch:true});
  const completed=await store.call<Action>('action.complete',{...base,now:base.now+10003,id:claimed.id,leaseToken:claimed.leaseToken,
    outcome:'success',result:{data:{synthetic:'classified result'},sensitivity:'phi'}});
  assert.equal(completed.sensitivity,'phi');
  await assert.rejects(store.call('action.get',{...base,id:completed.id,secure:false}),/secure application/);
}));

for(const missingRuns of [false,true])test(`owned legacy v1 migration preserves encrypted memory (runs missing: ${missingRuns})`,async()=>fixture(async(store,database,key)=>{
  await store.call('memory.put',{...base,secure:true,kind:'fact',key:'Migration check',value:'Synthetic preserved fact',sensitivity:'pii'});
  await store.close();
  const legacy=new DatabaseSync(database);
  try {
    legacy.exec(`DROP TABLE scheduled_jobs;DROP TABLE notifications;DROP TABLE schema_migrations;DROP INDEX schedules_due;
      ${missingRuns?'DROP TABLE runs;':'DROP INDEX runs_queued;'}UPDATE metadata SET value='1' WHERE key='schema';`);
  }finally{legacy.close();}
  const reopened=new Store({path:database,key,environment:'staging'});
  try {
    await reopened.ready;assert.equal((await reopened.call<{schema:number}>('ready',{})).schema,2);
    assert.equal((await reopened.call<Array<{record:{value:string}}>>('memory.search',{...base,secure:true,query:'migration'}))[0]?.record.value,'Synthetic preserved fact');
    assert.deepEqual(await reopened.call('notification.list',base),[]);
  }finally{await reopened.close();}
}));
