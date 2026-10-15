import {parentPort, workerData} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import type {Actor, Environment, Json, ObjectValue, PolicyRule, Sensitivity} from './contracts.js';
import {assert, OperatorError} from './errors.js';
import {ActionStore} from './store-actions.js';
import {StoreContext, integer, json, object, strings, text} from './store-context.js';
import {canonical} from './privacy.js';
import {schemaVersion} from './migrations.js';
import {ScheduleStore} from './store-schedules.js';
import {cancelledRequestNotice} from './working-memory.js';
import {socialRead,socialCommit} from './social-store.js';

const config = object(workerData);
const environment = text(config.environment) as Environment;
assert(['dev','staging','prod'].includes(environment), 'CONFIG_INVALID', 'Unknown environment.');
const store = new StoreContext({path: text(config.path), key: text(config.key, 64), environment});
const actions = new ActionStore(store);
const schedules = new ScheduleStore(store);
let reminderCursor=0;

function scope(args: ObjectValue, permissions: string[] = []): {tenant: string; actor: Actor; now: number} {
  const tenant = text(args.tenantId, 150);
  return {tenant, actor: store.require(tenant, text(args.actorId, 150), permissions), now: integer(args.now)};
}

function sensitivity(value: unknown): Sensitivity {
  assert(['public','internal','pii','phi'].includes(String(value)), 'INVALID_INPUT', 'Unknown data sensitivity.');
  return value as Sensitivity;
}

function words(value: string): string[] {
  return [...new Set(value.normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}_-]+/gu) ?? [])].slice(0, 256);
}

const cancellationNoticeKind = 'run_cancel_notice';
function finishCancellationNotice(tenant: string, owner: string, id: string, now: number): void {
  const row = store.get('SELECT * FROM records WHERE tenant=? AND owner=? AND kind=? AND id=?', tenant, owner, cancellationNoticeKind, id);
  if (!row) return;
  const pending = object(store.seal.open(text(row.payload, 1000000), `record:${tenant}:${owner}:${cancellationNoticeKind}:${id}:1`));
  const conversation = text(pending.conversation), role = 'system', privacy = 'internal';
  const message = {recordId:randomUUID(),role,notice:'request_cancelled',content:cancelledRequestNotice};
  store.run('INSERT INTO messages(tenant,owner,conversation,role,sensitivity,payload,created) VALUES(?,?,?,?,?,?,?)',
    tenant, owner, conversation, role, privacy, store.seal.seal(message, `message:${tenant}:${owner}:${conversation}:${role}:${privacy}`), now);
  store.run('UPDATE conversations SET updated=? WHERE tenant=? AND owner=? AND id=?', now, tenant, owner, conversation);
  store.run('DELETE FROM records WHERE tenant=? AND owner=? AND kind=? AND id=?', tenant, owner, cancellationNoticeKind, id);
}

function handle(operation: string, args: ObjectValue): Json {
  if (operation === 'ready') return {environment, schema: schemaVersion};
  if(operation==='work.active')return {runs:Number(store.get("SELECT COUNT(*) total FROM runs WHERE state IN ('queued','running')")?.total??0),
    actions:Number(store.get("SELECT COUNT(*) total FROM actions WHERE state IN ('queued','running')")?.total??0)};
  if (operation === 'close') { store.db.close(); return null; }
  if (operation === 'bootstrap') return store.transaction(() => {
    const tenant = text(args.tenantId, 150), id = text(args.id, 150), now = integer(args.now);
    if (store.get('SELECT id FROM actors WHERE tenant=? AND id=?', tenant, id)) return json(store.actor(tenant, id, false));
    assert(!store.get('SELECT id FROM actors WHERE tenant=? LIMIT 1', tenant), 'BOOTSTRAP_COMPLETE', 'Initial tenant provisioning is already complete.', 409);
    const actor: Actor = {id, tenantId: tenant, displayName: text(args.displayName, 100), roles: strings(args.roles),
      permissions: strings(args.permissions), revision: 1, active: true, language: args.language === 'cs' ? 'cs' : 'en', timezone: text(args.timezone, 100)};
    store.saveActor(actor, text(args.login, 100), text(args.passwordHash, 300));
    store.audit(tenant, id, 'identity.bootstrap', {actorId: id, roles: json(actor.roles)}, now);
    return json(actor);
  });
  if (operation === 'actor.get') return json(store.actor(text(args.tenantId), text(args.actorId)));
  if (operation === 'actor.create') return store.transaction(() => {
    const {tenant, actor: administrator, now} = scope(args, ['users.manage']);
    const permissions = strings(args.permissions);
    assert(permissions.every(permission => administrator.permissions.includes(permission)), 'FORBIDDEN', 'You cannot delegate permissions you lack.', 403);
    const actor: Actor = {id: text(args.id, 150), tenantId: tenant, displayName: text(args.displayName, 100),
      roles: strings(args.roles), permissions, revision: 1, active: true, language: args.language === 'cs' ? 'cs' : 'en', timezone: text(args.timezone, 100)};
    assert(!store.get('SELECT id FROM actors WHERE tenant=? AND id=?', tenant, actor.id), 'ACCOUNT_EXISTS', 'This account already exists.', 409);
    store.saveActor(actor, text(args.login, 100), text(args.passwordHash, 300));
    store.audit(tenant, administrator.id, 'identity.created', {actorId: actor.id}, now);
    return json(actor);
  });
  if (operation === 'actor.login') {
    const tenant = text(args.tenantId), row = store.get('SELECT id,password_hash FROM actors WHERE tenant=? AND login=?', tenant, text(args.login, 100));
    return row ? {actor: json(store.actor(tenant, text(row.id))), passwordHash: text(row.password_hash, 300)} : null;
  }
  if (operation === 'actor.update') return store.transaction(() => {
    const {tenant, actor: administrator, now} = scope(args, ['users.manage']);
    const id = text(args.id), current = store.actor(tenant, id, false);
    const permissions = args.permissions === undefined ? current.permissions : strings(args.permissions);
    assert(permissions.every(permission => administrator.permissions.includes(permission)), 'FORBIDDEN', 'You cannot delegate permissions you do not hold.', 403);
    const updated: Actor = {...current, permissions, roles: args.roles === undefined ? current.roles : strings(args.roles),
      active: args.active === undefined ? current.active : args.active === true, revision: current.revision + 1};
    const row = store.get('SELECT login,password_hash FROM actors WHERE tenant=? AND id=?', tenant, id);
    store.saveActor(updated, text(row?.login), text(row?.password_hash, 300));
    store.audit(tenant, administrator.id, 'identity.changed', {actorId: id, revision: updated.revision, active: updated.active}, now);
    return json(updated);
  });
  if (operation === 'session.create') {
    const {tenant, actor} = scope(args);
    store.run('INSERT INTO auth_sessions VALUES(?,?,?,?,?)', text(args.tokenHash, 100), tenant, actor.id, text(args.csrfHash, 100), integer(args.expires));
    return null;
  }
  if (operation === 'session.resolve') {
    const row = store.get('SELECT * FROM auth_sessions WHERE token_hash=? AND expires>?', text(args.tokenHash, 100), integer(args.now));
    return row ? {actor: json(store.actor(text(row.tenant), text(row.actor))), csrfHash: text(row.csrf_hash), expires: integer(row.expires)} : null;
  }
  if (operation === 'session.revoke') { store.run('DELETE FROM auth_sessions WHERE token_hash=?', text(args.tokenHash, 100)); return null; }
  if (operation === 'conversation.create') {
    const {tenant, actor, now} = scope(args, ['operator.chat']);
    const id = text(args.id, 150);
    store.run('INSERT INTO conversations VALUES(?,?,?,?,?)', tenant, actor.id, id, now, now);
    return {id, tenantId: tenant, ownerId: actor.id, createdAt: now};
  }
  if (operation === 'conversation.list') {
    const {tenant, actor} = scope(args, ['operator.chat']);
    return json(store.all('SELECT id,created,updated FROM conversations WHERE tenant=? AND owner=? ORDER BY updated DESC LIMIT 100', tenant, actor.id));
  }
  if (operation === 'conversation.require') {
    store.conversation(text(args.tenantId), text(args.actorId), text(args.conversationId));
    return null;
  }
  if (operation === 'message.append') return store.transaction(() => {
    const {tenant, actor, now} = scope(args, ['operator.chat']);
    const conversation = text(args.conversationId, 150);
    store.conversation(tenant, actor.id, conversation);
    const role = text(args.role, 20);
    assert(['user','assistant','tool','system'].includes(role), 'INVALID_INPUT', 'Unknown message role.');
    const privacy = sensitivity(args.sensitivity);
    const payload = object(args.message);
    assert(payload.role === role, 'INVALID_INPUT', 'Stored message role must match its admitted role.');
    const recordId = randomUUID();
    const wrapped = {recordId, ...payload};
    store.run('INSERT INTO messages(tenant,owner,conversation,role,sensitivity,payload,created) VALUES(?,?,?,?,?,?,?)',
      tenant, actor.id, conversation, role, privacy, store.seal.seal(wrapped, `message:${tenant}:${actor.id}:${conversation}:${role}:${privacy}`), now);
    store.run('UPDATE conversations SET updated=? WHERE tenant=? AND id=?', now, tenant, conversation);
    return {recordId};
  });
  if (operation === 'message.history') {
    const {tenant, actor} = scope(args, ['operator.chat']);
    const conversation = text(args.conversationId, 150);
    store.conversation(tenant, actor.id, conversation);
    const rows = store.all('SELECT * FROM messages WHERE tenant=? AND owner=? AND conversation=? ORDER BY id DESC LIMIT ?', tenant, actor.id, conversation, integer(args.limit ?? 40, 1, 100)).reverse();
    return rows.map(row => {
      const privacy = sensitivity(row.sensitivity), role = text(row.role);
      if (args.secure !== true && (privacy === 'pii' || privacy === 'phi')) {
        return {role, content: '[Protected context is available only in the secure application.]', sensitivity: privacy};
      }
      return {message: store.seal.open(text(row.payload, 1000000), `message:${tenant}:${actor.id}:${conversation}:${role}:${privacy}`), sensitivity: privacy};
    });
  }
  if (operation === 'memory.put') return store.transaction(() => {
    const {tenant, actor, now} = scope(args, ['memory.write']);
    assert(args.secure === true, 'SECURE_CHANNEL_REQUIRED', 'Use the secure application to store private long-term facts.', 403);
    const kind = text(args.kind, 50), key = text(args.key, 200);
    assert(['preference','fact','vendor','instruction'].includes(kind), 'INVALID_INPUT', 'Unknown memory category.');
    const keyHash = store.seal.digest({kind, key: key.normalize('NFKC').toLocaleLowerCase('en')});
    const existing = store.get('SELECT id,revision FROM memory WHERE tenant=? AND owner=? AND kind=? AND key_hash=?', tenant, actor.id, kind, keyHash);
    const id = existing ? text(existing.id) : randomUUID(), revision = existing ? integer(existing.revision, 1) + 1 : 1;
    const value = args.value ?? null, privacy = sensitivity(args.sensitivity ?? 'pii');
    const payload = {key, value, provenance: args.provenance ?? {source: 'user'}, trustedInstruction: false};
    store.run('INSERT INTO memory VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant,owner,id) DO UPDATE SET payload=excluded.payload,sensitivity=excluded.sensitivity,revision=excluded.revision,updated=excluded.updated',
      tenant, actor.id, id, kind, keyHash, privacy, store.seal.seal(payload, `memory:${tenant}:${actor.id}:${id}:${revision}:${privacy}`), revision, now);
    store.run('DELETE FROM memory_terms WHERE tenant=? AND owner=? AND memory_id=?', tenant, actor.id, id);
    for (const word of words(key + ' ' + canonical(value))) store.run('INSERT INTO memory_terms VALUES(?,?,?,?)', tenant, actor.id, id, store.seal.digest(word));
    store.audit(tenant, actor.id, 'memory.updated', {memoryId: id, kind, revision, input: payload}, now, privacy);
    return {id, kind, revision, saved: true};
  });
  if (operation === 'memory.search') {
    const {tenant, actor} = scope(args, ['memory.read']);
    assert(args.secure === true, 'SECURE_CHANNEL_REQUIRED', 'Private facts require the secure application.', 403);
    const query = typeof args.query === 'string' ? args.query : '';
    const terms = words(query).slice(0, 12).map(word => store.seal.digest(word));
    const rows = terms.length
      ? store.all(`SELECT m.* FROM memory m JOIN memory_terms t ON t.tenant=m.tenant AND t.owner=m.owner AND t.memory_id=m.id WHERE m.tenant=? AND m.owner=? AND t.term IN (${terms.map(() => '?').join(',')}) GROUP BY m.id ORDER BY COUNT(*) DESC,m.updated DESC LIMIT 20`, tenant, actor.id, ...terms)
      : store.all('SELECT * FROM memory WHERE tenant=? AND owner=? ORDER BY updated DESC LIMIT 20', tenant, actor.id);
    return rows.map(row => ({id: text(row.id), kind: text(row.kind), revision: integer(row.revision),
      record: store.seal.open(text(row.payload, 100000), `memory:${tenant}:${actor.id}:${row.id}:${row.revision}:${row.sensitivity}`)}));
  }
  if (operation === 'skill.sync') return store.transaction(() => {
    assert(Array.isArray(args.skills), 'INVALID_INPUT', 'Skill descriptors are required.');
    const seen = new Set<string>();
    for (const raw of args.skills) {
      const skill = object(raw), manifest = object(skill.manifest), health = object(skill.health);
      const id = text(manifest.id, 100), version = text(manifest.version, 40), artifact = text(skill.artifactHash, 100);
      seen.add(id);
      const current = store.get('SELECT * FROM skills WHERE id=?', id);
      if (current && current.version === version && current.artifact_hash !== artifact) {
        health.state = 'changed_without_version'; health.enabled = false; health.reason = 'The handler or schema changed without a skill version change.';
      }
      const acceptedArtifact = current && current.version === version ? text(current.artifact_hash) : artifact;
      store.run('INSERT INTO skills VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,fingerprint=excluded.fingerprint,artifact_hash=excluded.artifact_hash,manifest=excluded.manifest,health=excluded.health',
        id, version, text(skill.fingerprint, 100), acceptedArtifact, canonical(manifest), canonical(health));
    }
    for (const row of store.all('SELECT id,health FROM skills')) if (!seen.has(text(row.id))) {
      const health = object(JSON.parse(text(row.health)));
      health.state = 'disabled'; health.enabled = false; health.reason = 'The installed skill was removed.';
      store.run('UPDATE skills SET health=? WHERE id=?', canonical(health), text(row.id));
    }
    return store.all('SELECT health FROM skills').map(row => json(JSON.parse(text(row.health))));
  });
  if (operation === 'skill.list') return store.all('SELECT health FROM skills ORDER BY id').map(row => json(JSON.parse(text(row.health))));
  if (operation === 'skill.health') {
    store.run('UPDATE skills SET health=? WHERE id=? AND fingerprint=?',canonical(object(args.health)),text(args.id),text(args.fingerprint));
    return null;
  }
  if (operation === 'policy.get') {
    const {tenant, actor} = scope(args);
    const tool = store.skill(text(args.tool));
    return json(store.policy(tenant, actor.id, tool.manifest.id, tool.fingerprint));
  }
  if (operation === 'policy.set') return store.transaction(() => {
    const {tenant, actor, now} = scope(args, ['settings.write']);
    const tool = store.skill(text(args.tool));
    assert(tool.ready, 'TOOL_UNAVAILABLE', 'Only ready skills can be permitted.', 409);
    assert(tool.manifest.permissions.every(permission => actor.permissions.includes(permission)), 'FORBIDDEN', 'You cannot grant an action permission you lack.', 403);
    const current = store.policy(tenant, actor.id, tool.manifest.id, tool.fingerprint);
    const updated: PolicyRule = {...current, fingerprint: tool.fingerprint, automatic: args.automatic === true,
      revision: current.revision + 1, maxPerMinute: integer(args.maxPerMinute ?? 5, 1, 10), maxPerDay: integer(args.maxPerDay ?? 100, 1, 500)};
    store.run('INSERT INTO policies VALUES(?,?,?,?,?) ON CONFLICT(tenant,owner,tool) DO UPDATE SET revision=excluded.revision,payload=excluded.payload',
      tenant, actor.id, tool.manifest.id, updated.revision,
      store.seal.seal(json(updated), `policy:${tenant}:${actor.id}:${tool.manifest.id}:${updated.revision}`));
    store.audit(tenant, actor.id, 'policy.changed', json(updated), now);
    return json(updated);
  });
  if (operation === 'action.propose') return json(actions.propose(args));
  if (operation === 'action.decide') return json(actions.decide(args));
  if (operation === 'action.enqueue') return json(actions.enqueue(args));
  if (operation === 'action.claim') return json(actions.claim(args));
  if (operation === 'action.authorize') return json(actions.authorize(args));
  if (operation === 'action.complete') return json(actions.complete(args));
  if (operation === 'action.cancel') return json(actions.cancel(args));
  if (operation === 'action.get') return json(actions.visible(args));
  if (operation === 'action.inspect') return json(actions.load(text(args.tenantId), text(args.id)));
  if (operation === 'action.list') {
    const {tenant, actor} = scope(args, ['actions.read']);
    return store.all('SELECT id FROM actions WHERE tenant=? AND owner=? ORDER BY created DESC LIMIT 100', tenant, actor.id)
      .map(row => json(actions.visible({...args, id: text(row.id)})));
  }
  if (operation === 'record.list') {
    const {tenant, actor} = scope(args);
    return store.all('SELECT * FROM records WHERE tenant=? AND owner=? AND kind=? ORDER BY updated DESC LIMIT 100', tenant, actor.id, text(args.kind, 100))
      .map(row => ({id: text(row.id), revision: integer(row.revision), data: store.seal.open(text(row.payload, 1000000), `record:${tenant}:${actor.id}:${row.kind}:${row.id}:${row.revision}`)}));
  }
  if(operation==='social.contacts'||operation==='social.searches')return json(socialRead(store,operation,args));
  if(operation==='social.commit')return json(socialCommit(store,actions,args));
  if(operation==='connection.save')return store.transaction(()=>{
    const {tenant,actor,now}=scope(args,['connections.manage']),id=text(args.id,100);
    const prior=store.get("SELECT revision FROM records WHERE tenant=? AND owner=? AND kind='connection' AND id=?",tenant,actor.id,id);
    const revision=Number(prior?.revision??0)+1;
    store.run("INSERT INTO records VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant,owner,kind,id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated=excluded.updated",
      tenant,actor.id,'connection',id,store.seal.seal(args.value??null,`record:${tenant}:${actor.id}:connection:${id}:${revision}`),revision,now);
    const account=store.get('SELECT login,password_hash FROM actors WHERE tenant=? AND id=?',tenant,actor.id);
    store.saveActor({...actor,revision:actor.revision+1},text(account?.login),text(account?.password_hash,300));
    store.audit(tenant,actor.id,'connection.updated',{connection:id},now);return null;
  });
  if(operation==='connection.get'){
    const {tenant,actor}=scope(args),id=text(args.id,100);
    const row=store.get("SELECT * FROM records WHERE tenant=? AND owner=? AND kind='connection' AND id=?",tenant,actor.id,id);
    return row?store.seal.open(text(row.payload,100000),`record:${tenant}:${actor.id}:connection:${id}:${row.revision}`):null;
  }
  if (operation === 'artifact.get') {
    const {tenant,actor}=scope(args,['files.read']);
    assert(args.secure===true,'SECURE_CHANNEL_REQUIRED','Open documents in the secure application.',403);
    const id=text(args.id),row=store.get("SELECT * FROM records WHERE tenant=? AND owner=? AND kind='artifact' AND id=?",tenant,actor.id,id);
    assert(row,'NOT_FOUND','Artifact not found.',404);
    return store.seal.open(text(row.payload,1000000),`record:${tenant}:${actor.id}:artifact:${id}:${row.revision}`);
  }
  if (operation === 'effect.record') return store.transaction(()=>{
    const {tenant,actor,now}=scope(args),action=actions.authorize({tenantId:tenant,id:text(args.actionId),leaseToken:text(args.leaseToken),now,dispatch:false});
    const name=text(args.operation),input=object(args.input),result=object(args.result),hash=store.seal.digest(input);
    assert(action.ownerId===actor.id&&action.dispatchedAt!==null,'DISPATCH_NOT_RECORDED','Current dispatch authority is required.',409);
    assert(store.skill(action.tool).manifest.serviceOperations.includes(name),'EFFECT_NOT_DECLARED','The effect was not declared.',403);
    const prior=store.get('SELECT input_hash FROM effects WHERE tenant=? AND action=? AND operation=?',tenant,action.id,name);
    if(prior){assert(prior.input_hash===hash,'IDEMPOTENCY_CONFLICT','Effect input changed.',409);return null;}
    assert(['documents.create','sandbox.execute','mail.send','mail.attachment','browser.run','code.workspace'].includes(name),'OPERATION_UNAVAILABLE','Unsupported effect receipt.');
    if(name==='documents.create'||name==='mail.attachment'){
      assert(result.id===action.id,'ARTIFACT_ID_INVALID','Artifact must belong to its action.',409);
      store.run('INSERT INTO records VALUES(?,?,?,?,?,?,?)',tenant,actor.id,'artifact',action.id,
        store.seal.seal(result,`record:${tenant}:${actor.id}:artifact:${action.id}:1`),1,now);
    }
    store.run('INSERT INTO effects VALUES(?,?,?,?,?,?)',tenant,action.id,name,hash,store.seal.seal(result,`effect:${tenant}:${action.id}:${name}`),now);
    store.audit(tenant,actor.id,'effect.committed',{actionId:action.id,operation:name,result},now,action.sensitivity);
    return null;
  });
  if (operation === 'reminders.dispatch') return store.transaction(()=>{
    const now=integer(args.now);let fired=0;
    const dueCandidates=store.all("SELECT rowid scan_id,* FROM records WHERE kind='task' AND rowid>? ORDER BY rowid LIMIT 250",reminderCursor);
    reminderCursor=dueCandidates.length===250?integer(dueCandidates.at(-1)?.scan_id):0;
    for(const row of dueCandidates){
      const tenant=text(row.tenant),owner=text(row.owner),id=text(row.id),revision=integer(row.revision);
      const task=object(store.seal.open(text(row.payload,100000),`record:${tenant}:${owner}:task:${id}:${revision}`));
      if(task.state!=='open'||typeof task.dueAt!=='number'||task.dueAt>now||task.notifiedAt)continue;
      try{store.require(tenant,owner,['tasks.read']);}catch{continue;}
      task.notifiedAt=now;
      store.run("UPDATE records SET payload=?,revision=?,updated=? WHERE tenant=? AND owner=? AND kind='task' AND id=?",
        store.seal.seal(task,`record:${tenant}:${owner}:task:${id}:${revision+1}`),revision+1,now,tenant,owner,id);
      store.notify(tenant,owner,'task.due',{taskId:id,state:'due'},now);fired++;
    }
    return {fired};
  });
  if (operation === 'schedule.put') return json(schedules.put(args));
  if (operation === 'schedule.list') return json(schedules.list(args));
  if (operation === 'schedule.jobs') return json(schedules.jobs(args));
  if (operation === 'schedule.dispatch') return {created:schedules.dispatch(integer(args.now))};
  if (operation === 'schedule.claim') return json(schedules.claim(integer(args.now)));
  if (operation === 'schedule.complete') return json(schedules.complete(args));
  if (operation === 'schedule.authorize') {schedules.authorize(args);return null;}
  if (operation === 'notification.list') {
    const {tenant,actor}=scope(args,['operator.chat']);
    return store.all('SELECT * FROM notifications WHERE tenant=? AND owner=? AND seq>? ORDER BY seq LIMIT 100',tenant,actor.id,integer(args.after??0))
      .map(row=>({id:text(row.id),sequence:integer(row.seq),kind:text(row.kind),at:integer(row.created),acknowledged:row.acknowledged!==null,
        data:store.seal.open(text(row.payload,100000),`notification:${tenant}:${actor.id}:${row.id}`)}));
  }
  if (operation === 'notification.ack') {
    const {tenant,actor,now}=scope(args,['operator.chat']),id=text(args.id);
    assert(store.get('SELECT id FROM notifications WHERE tenant=? AND owner=? AND id=?',tenant,actor.id,id),'NOT_FOUND','Notification not found.',404);
    store.run('UPDATE notifications SET acknowledged=COALESCE(acknowledged,?) WHERE tenant=? AND owner=? AND id=?',now,tenant,actor.id,id);
    return {id,acknowledged:true};
  }
  if (operation === 'run.accept') return store.transaction(() => {
    const {tenant, actor, now} = scope(args, ['operator.chat']);
    const id = text(args.id, 150), conversation = text(args.conversationId, 150), message = text(args.message, 12000);
    store.conversation(tenant, actor.id, conversation);
    const hash = store.seal.digest({conversation, message, owner: actor.id, channel: args.channel ?? 'web',
      secure: args.secure === true, source: args.source ?? 'user'});
    const prior = store.get('SELECT * FROM runs WHERE tenant=? AND id=?', tenant, id);
    if (prior) {
      assert(prior.owner === actor.id && prior.conversation === conversation, 'IDEMPOTENCY_CONFLICT', 'The request identity was reused for different input.', 409);
      const payload = object(store.seal.open(text(prior.payload, 1000000), `run:${tenant}:${actor.id}:${id}`));
      if (prior.state === 'cancelled' && payload.cancelledBeforeAdmission === true) {
        // A scoped cancellation can arrive before the original HTTP request.
        // Bind its first late input identity, but never enqueue or execute it.
        payload.cancelledBeforeAdmission = false;
        store.run('UPDATE runs SET input_hash=?,payload=?,updated=? WHERE tenant=? AND owner=? AND id=?', hash,
          store.seal.seal(payload, `run:${tenant}:${actor.id}:${id}`), now, tenant, actor.id, id);
        return {id, state: 'cancelled', conversationId: conversation};
      }
      assert(prior.input_hash === hash, 'IDEMPOTENCY_CONFLICT', 'The request identity was reused for different input.', 409);
      return {id, state: text(prior.state), conversationId: conversation};
    }
    const queued = Number(store.get("SELECT COUNT(*) total FROM runs WHERE tenant=? AND owner=? AND state IN ('queued','running')", tenant, actor.id)?.total ?? 0);
    assert(queued < 8, 'REQUEST_QUEUE_FULL', 'Too many requests are already waiting.', 429);
    const payload = {message, channel: args.channel ?? 'web', secure: args.secure === true, source: args.source ?? 'user', actorRevision: actor.revision, result: null, error: null};
    store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)', tenant, actor.id, id, conversation, 'queued', hash,
      store.seal.seal(payload, `run:${tenant}:${actor.id}:${id}`), now, now);
    store.audit(tenant, actor.id, 'agent.queued', {runId: id, conversationId: conversation, message}, now, 'pii');
    return {id, state: 'queued', conversationId: conversation};
  });
  if (operation === 'run.claim') return store.transaction(() => {
    const now = integer(args.now);
    const row = store.get("SELECT * FROM runs WHERE state='queued' ORDER BY created LIMIT 1");
    if (!row) return null;
    const tenant = text(row.tenant), owner = text(row.owner), id = text(row.id);
    const payload = object(store.seal.open(text(row.payload, 1000000), `run:${tenant}:${owner}:${id}`));
    let actor: Actor;
    try { actor = store.require(tenant, owner, ['operator.chat']); }
    catch {
      store.run("UPDATE runs SET state='cancelled',updated=? WHERE tenant=? AND id=?", now, tenant, id);
      return null;
    }
    if (actor.revision !== payload.actorRevision) {
      store.run("UPDATE runs SET state='cancelled',updated=? WHERE tenant=? AND id=?", now, tenant, id);
      return null;
    }
    store.run("UPDATE runs SET state='running',updated=? WHERE tenant=? AND id=?", now, tenant, id);
    return {id, conversationId: text(row.conversation), actor: json(actor), ...payload};
  });
  if (operation === 'run.finish') return store.transaction(() => {
    const tenant = text(args.tenantId), owner = text(args.actorId), id = text(args.id), now = integer(args.now);
    const row = store.get('SELECT * FROM runs WHERE tenant=? AND owner=? AND id=?', tenant, owner, id);
    assert(row, 'NOT_FOUND', 'The run was not found.', 404);
    if (row.state === 'cancelled') {
      // Append the authoritative notice after the interrupted core settles, so
      // it follows any already-recorded user/tool messages. Lost acks are safe.
      finishCancellationNotice(tenant, owner, id, now);
      return {id, state: 'cancelled'};
    }
    const payload = object(store.seal.open(text(row.payload, 1000000), `run:${tenant}:${owner}:${id}`));
    const resultHash = store.seal.digest({result: args.result ?? null, error: args.error ?? null});
    if (row.state !== 'running') {
      assert(payload.resultHash === resultHash, 'RUN_NOT_ACTIVE', 'The run already has a different terminal result.', 409);
      return {id, state: text(row.state)};
    }
    payload.resultHash = resultHash;
    payload.result = args.result ?? null; payload.error = args.error ?? null;
    const state = args.error ? 'failed' : 'completed';
    store.run('UPDATE runs SET state=?,payload=?,updated=? WHERE tenant=? AND id=?', state,
      store.seal.seal(payload, `run:${tenant}:${owner}:${id}`), now, tenant, id);
    return {id, state};
  });
  if (operation === 'run.cancel') return store.transaction(() => {
    const {tenant, actor, now} = scope(args, ['operator.chat']);
    const conversation = text(args.conversationId);
    store.conversation(tenant, actor.id, conversation);
    const requestId = args.id === undefined ? null : text(args.id, 150);
    const prior = requestId ? store.get('SELECT * FROM runs WHERE tenant=? AND id=?', tenant, requestId) : undefined;
    if (requestId && !prior) {
      const payload = {cancelledBeforeAdmission:true,result:null,error:{code:'CANCELLED',message:'The request was cancelled before admission.'}};
      store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)', tenant, actor.id, requestId, conversation, 'cancelled',
        store.seal.digest({conversation,owner:actor.id,cancelledBeforeAdmission:true}),
        store.seal.seal(payload, `run:${tenant}:${actor.id}:${requestId}`), now, now);
      store.audit(tenant, actor.id, 'agent.cancelled', {runId:requestId,conversationId:conversation,beforeAdmission:true}, now);
      return {id:requestId,state:'cancelled',cancelled:1};
    }
    if (prior) assert(prior.owner === actor.id && prior.conversation === conversation, 'NOT_FOUND', 'Request not found.', 404);
    const rows = store.all("SELECT * FROM runs WHERE tenant=? AND owner=? AND conversation=? AND state IN ('queued','running')" + (requestId ? ' AND id=?' : ''),
      tenant, actor.id, conversation, ...(requestId ? [requestId] : []));
    for (const row of rows) {
      const id = text(row.id), payload = object(store.seal.open(text(row.payload, 1000000), `run:${tenant}:${actor.id}:${id}`));
      if (row.state === 'running') store.run('INSERT OR IGNORE INTO records VALUES(?,?,?,?,?,?,?)', tenant, actor.id, cancellationNoticeKind, id,
        store.seal.seal({conversation}, `record:${tenant}:${actor.id}:${cancellationNoticeKind}:${id}:1`), 1, now);
      payload.error = {code:'CANCELLED',message:'The request was cancelled. Already admitted actions retain their own recorded state.'};
      store.run("UPDATE runs SET state='cancelled',payload=?,updated=? WHERE tenant=? AND id=?",
        store.seal.seal(payload, `run:${tenant}:${actor.id}:${id}`), now, tenant, id);
      store.audit(tenant, actor.id, 'agent.cancelled', {runId:id,conversationId:conversation}, now);
    }
    return {cancelled:rows.length,...(requestId ? {id:requestId,state:rows.length?'cancelled':text(prior!.state)} : {})};
  });
  if (operation === 'run.get') {
    const {tenant, actor} = scope(args, ['operator.chat']);
    const row = store.get('SELECT * FROM runs WHERE tenant=? AND owner=? AND id=?', tenant, actor.id, text(args.id));
    assert(row, 'NOT_FOUND', 'Request not found.', 404);
    const payload = object(store.seal.open(text(row.payload, 1000000), `run:${tenant}:${actor.id}:${row.id}`));
    if (args.secure !== true) return {id: text(row.id), state: text(row.state), privateDetails: true};
    return {id: text(row.id), state: text(row.state), result: payload.result ?? null, error: payload.error ?? null};
  }
  if (operation === 'run.recover') return store.transaction(() => {
    for (const row of store.all('SELECT tenant,owner,id FROM records WHERE kind=? ORDER BY updated', cancellationNoticeKind))
      finishCancellationNotice(text(row.tenant), text(row.owner), text(row.id), integer(args.now));
    for (const row of store.all("SELECT * FROM runs WHERE state='running'")) {
      const tenant = text(row.tenant), owner = text(row.owner), id = text(row.id);
      const payload = object(store.seal.open(text(row.payload, 1000000), `run:${tenant}:${owner}:${id}`));
      payload.error = {code: 'RUN_INTERRUPTED', message: 'The process restarted. Review recorded actions before retrying.'};
      store.run("UPDATE runs SET state='failed',payload=?,updated=? WHERE tenant=? AND id=?",
        store.seal.seal(payload, `run:${tenant}:${owner}:${id}`), integer(args.now), tenant, id);
    }
    return null;
  });
  if (operation === 'effect.apply') return store.transaction(() => {
    const {tenant, actor, now} = scope(args);
    const action = actions.authorize({tenantId: tenant, id: text(args.actionId), leaseToken: text(args.leaseToken), now, dispatch: false});
    assert(action.ownerId === actor.id && action.dispatchedAt !== null, 'DISPATCH_NOT_RECORDED', 'A current authorized action is required.', 409);
    const name = text(args.operation, 100), input = object(args.input), inputHash = store.seal.digest(input);
    const skill = store.skill(action.tool);
    assert(skill.manifest.serviceOperations.includes(name), 'EFFECT_NOT_DECLARED', 'This skill cannot invoke that operation.', 403);
    const existing = store.get('SELECT * FROM effects WHERE tenant=? AND action=? AND operation=?', tenant, action.id, name);
    if (existing) {
      assert(existing.input_hash === inputHash, 'IDEMPOTENCY_CONFLICT', 'Effect arguments changed under the same action.', 409);
      return store.seal.open(text(existing.result, 1000000), `effect:${tenant}:${action.id}:${name}`);
    }
    let result: Json;
    if (name === 'memory.put') result = handle('memory.put', {...input, tenantId: tenant, actorId: actor.id, secure: action.secure, now});
    else if (name === 'fixture.send') {
      assert(store.environment !== 'prod', 'FIXTURE_FORBIDDEN', 'Synthetic effects cannot run in production.', 403);
      store.require(tenant, actor.id, ['fixture.send']);
      const id = action.id;
      store.run('INSERT INTO records VALUES(?,?,?,?,?,?,?)', tenant, actor.id, 'fixture_delivery', id,
        store.seal.seal(input, `record:${tenant}:${actor.id}:fixture_delivery:${id}:1`), 1, now);
      result = {id, simulation: true, externallySent: false};
    } else if(name==='tasks.save') {
      store.require(tenant,actor.id,['tasks.write']);
      const id=input.action==='complete'?text(input.id):action.id;
      let revision=1,task:ObjectValue;
      if(input.action==='complete'){
        const prior=store.get("SELECT * FROM records WHERE tenant=? AND owner=? AND kind='task' AND id=?",tenant,actor.id,id);
        assert(prior,'NOT_FOUND','Task not found.',404);revision=integer(prior.revision)+1;
        task=object(store.seal.open(text(prior.payload,100000),`record:${tenant}:${actor.id}:task:${id}:${prior.revision}`));task.state='completed';task.completedAt=now;
      }else{
        const dueAt=typeof input.delayMinutes==='number'?now+integer(input.delayMinutes,1,10080)*60000:typeof input.dueAt==='string'?Date.parse(input.dueAt):null;
        assert(dueAt===null||Number.isFinite(dueAt)&&dueAt>now,'TASK_DATE_INVALID','Choose a future reminder time.');
        task={id,title:text(input.title,300),notes:typeof input.notes==='string'?input.notes:'',state:'open',dueAt,
          dueAtLocal:dueAt===null?null:new Intl.DateTimeFormat('en-GB',{timeZone:actor.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(dueAt)),
          timezone:actor.timezone,createdAt:now,notifiedAt:null};
      }
      store.run("INSERT INTO records VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant,owner,kind,id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated=excluded.updated",
        tenant,actor.id,'task',id,store.seal.seal(task,`record:${tenant}:${actor.id}:task:${id}:${revision}`),revision,now);
      result=task;
    } else throw new OperatorError('OPERATION_UNAVAILABLE', 'The effect operation is not registered.', 409);
    store.run('INSERT INTO effects VALUES(?,?,?,?,?,?)', tenant, action.id, name, inputHash,
      store.seal.seal(result, `effect:${tenant}:${action.id}:${name}`), now);
    store.audit(tenant, actor.id, 'effect.committed', {actionId: action.id, operation: name, input, result}, now, action.sensitivity);
    return result;
  });
  if (operation === 'audit.append') return store.transaction(() => {
    const {tenant, actor, now} = scope(args);
    return {id: store.audit(tenant, actor.id, text(args.kind, 100), args.payload ?? null, now, sensitivity(args.sensitivity ?? 'internal'))};
  });
  if (operation === 'audit.record') return store.transaction(() => ({id: store.audit(text(args.tenantId), text(args.actorId),
    text(args.kind, 100), args.payload ?? null, integer(args.now), sensitivity(args.sensitivity ?? 'internal'))}));
  if (operation === 'audit.list') {
    const {tenant, actor} = scope(args, ['audit.read']);
    return store.all('SELECT id,kind,created,summary,hash FROM audit WHERE tenant=? AND actor=? ORDER BY seq DESC LIMIT ?',
      tenant, actor.id, integer(args.limit ?? 10, 1, 100)).map(row => ({id: text(row.id), kind: text(row.kind), at: integer(row.created), summary: json(JSON.parse(text(row.summary))), hash: text(row.hash)}));
  }
  if (operation === 'table.observation') {
    const {tenant,actor,now}=scope(args,['files.read']);
    assert(args.secure===true,'SECURE_CHANNEL_REQUIRED','Table source data requires the secure application.',403);
    const row=store.get("SELECT * FROM audit WHERE tenant=? AND actor=? AND id=? AND kind='tool.completed'",tenant,actor.id,text(args.id));
    assert(row,'NOT_FOUND','Table observation not found.',404);
    const result=object(store.seal.open(text(row.payload,1000000),`audit:${tenant}:${actor.id}:${row.id}`));
    assert(result.tool==='jarvis_table_query'&&object(result.result).ok===true,'TABLE_REFERENCE_INVALID','Choose a successful table-query observation.');
    store.audit(tenant,actor.id,'table.source_read',{auditId:text(row.id)},now);
    return result;
  }
  if (operation === 'audit.detail') {
    const {tenant, actor, now} = scope(args, ['audit.read']);
    assert(args.secure === true, 'SECURE_CHANNEL_REQUIRED', 'Detailed audit payloads require the secure application.', 403);
    const row = store.get('SELECT * FROM audit WHERE tenant=? AND actor=? AND id=?', tenant, actor.id, text(args.id));
    assert(row, 'NOT_FOUND', 'Audit record not found.', 404);
    const result = store.seal.open(text(row.payload, 1000000), `audit:${tenant}:${actor.id}:${row.id}`);
    store.audit(tenant, actor.id, 'audit.payload_read', {auditId: text(row.id)}, now);
    return result;
  }
  throw new OperatorError('INVALID_STORE_OPERATION', 'Unknown internal storage operation.', 500);
}

parentPort?.on('message', (message: {id: number; operation: string; args: ObjectValue}) => {
  try {
    const value = handle(message.operation, object(message.args));
    parentPort?.postMessage({id: message.id, ok: true, value});
  } catch (error) {
    const known = error instanceof OperatorError;
    parentPort?.postMessage({id: message.id, ok: false, error: {code: known ? error.code : 'STORE_ERROR',
      message: known ? error.message : 'The storage operation could not finish.', status: known ? error.httpStatus : 500}});
  }
});
