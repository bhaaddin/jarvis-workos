import Fastify, {type FastifyRequest} from 'fastify';
import cookies from '@fastify/cookie';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import type {Actor, Invocation, Model, ObjectValue} from './contracts.js';
import type {Config} from './config.js';
import {Auth, digestToken} from './auth.js';
import {OperatorError, assert, publicError} from './errors.js';
import {Store} from './store.js';
import {Registry} from './registry.js';
import {Services} from './services.js';
import {ActionRunner, actionView} from './actions.js';
import {ToolOwner} from './tool-owner.js';
import {AgentCore} from './agent.js';
import {Runs} from './runs.js';
import {EventBus} from './events.js';
import {configuredModel} from './model-factory.js';
import {MeteredModel} from './model-metrics.js';
import {RuntimeControl} from './runtime-control.js';
import {Scheduler} from './scheduler.js';
import type {Schedule} from './schedule-contracts.js';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {actorArtifactRoot,containedFile,relativeFile,roots} from './files.js';

declare module 'fastify' {
  interface FastifyRequest {
    operatorSession: {actor: Actor; csrfHash: string; expires: number; token: string} | null;
    operatorExecution: {signal: AbortSignal; release: () => void} | null;
  }
}

const COOKIE = 'jarvis_operator_session';
const uuid = {type: 'string', format: 'uuid'};
const closed = (properties: ObjectValue, required: string[]) => ({type: 'object', properties, required, additionalProperties: false});

export async function createOperator(config: Config, suppliedModel?: Model, options: {background?: boolean} = {}) {
  const store = new Store({path: config.databasePath, key: config.dataKey, environment: config.environment});
  await store.ready;
  try {
  const auth = new Auth(store, config); await auth.bootstrap();
  const registry = new Registry({root: config.skillsRoot, environment: config.environment, enabled: config.enabledTools,
    configurationHash: config.configurationHash, environmentValues: config.environmentValues, store});
  await registry.load();
  const bus = new EventBus(), services = new Services(store, registry, config);
  const actions = new ActionRunner(store, registry, services, bus);
  const owner = new ToolOwner(store, registry, services, actions, bus);
  const inner = suppliedModel ?? configuredModel(config);
  const model = new MeteredModel(inner);
  const runtime = new RuntimeControl(config,store,inner,model);
  const core = new AgentCore(store, registry, owner, model, bus, config);
  const runs = new Runs(store, core, auth, config,runtime);
  actions.onSettled=async action=>{
    if(action.approvalKind!=='manual'||!['succeeded','failed'].includes(action.state))return;
    try{await store.call('run.get',{tenantId:action.tenantId,actorId:action.ownerId,id:action.intentId,now:Date.now(),secure:false});}
    catch(error){if(error instanceof OperatorError&&error.code==='NOT_FOUND')return;throw error;}
    const actor=await store.call<Actor>('actor.get',{tenantId:action.tenantId,actorId:action.ownerId});
    const hash=createHash('sha256').update('approved-action-followup:'+action.id).digest('hex');
    const id=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
    await runs.accept(`The action I approved (${action.id}) now has recorded state ${action.state}. Inspect its actual result using jarvis_action_result, then finish my preceding request. Do not repeat the executed action.`,
      {actor,environment:config.environment,conversationId:action.conversationId,intentId:id,channel:'web',secure:true,confidence:'high',source:'user',signal:new AbortController().signal});
  };
  const scheduler = new Scheduler(store, owner, auth, bus, config);
  const app = Fastify({logger: false, bodyLimit: 128 * 1024, requestTimeout: 20000, trustProxy: false,
    ajv: {customOptions: {removeAdditional: false, coerceTypes: false, useDefaults: false}}});
  await app.register(cookies);
  app.decorateRequest('operatorSession', null);
  app.decorateRequest('operatorExecution', null);

  const identity = (request: FastifyRequest) => {
    assert(request.operatorSession, 'AUTH_REQUIRED', 'Sign in to JARVIS.', 401);
    return request.operatorSession;
  };
  const invocation = (request: FastifyRequest, conversationId: string, intentId: string = randomUUID()): Invocation => ({
    actor: identity(request).actor, environment: config.environment, conversationId, intentId,
    channel: 'web', secure: true, confidence: 'unknown', source: 'user', signal: request.operatorExecution!.signal,
  });
  const base = (request: FastifyRequest) => ({tenantId: identity(request).actor.tenantId, actorId: identity(request).actor.id, now: Date.now()});

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return;
    if (!['GET','HEAD'].includes(request.method)) assert(request.headers.origin === config.origin, 'ORIGIN_REJECTED', 'This request must originate from the configured application.', 403);
    if (path === '/api/auth/login') return;
    const token = request.cookies[COOKIE];
    assert(token, 'AUTH_REQUIRED', 'Sign in to JARVIS.', 401);
    const session = await auth.resolve(token);
    request.operatorSession = {...session, token};
    const controller = new AbortController(), bound = auth.bind(session.actor, controller.signal);
    let leaveWork:(()=>void)|undefined;let released=false;
    const disconnect = () => {if (!reply.raw.writableEnded){controller.abort(new OperatorError('DISCONNECTED','The request connection closed.',409));request.operatorExecution?.release();}};
    request.raw.once('aborted', disconnect); reply.raw.once('close', disconnect);
    request.operatorExecution = {signal:bound.signal,release:()=>{
      if(released)return;released=true;
      request.raw.off('aborted',disconnect);reply.raw.off('close',disconnect);bound.release();leaveWork?.();
    }};
    if (!['GET','HEAD'].includes(request.method)) {
      const supplied = request.headers['x-csrf-token'];
      assert(typeof supplied === 'string' && supplied.length <= 200, 'CSRF_REJECTED', 'Refresh the session before this request.', 403);
      assert(timingSafeEqual(Buffer.from(digestToken(supplied), 'hex'), Buffer.from(session.csrfHash, 'hex')), 'CSRF_REJECTED', 'The request token is not valid for this session.', 403);
      if(!path.startsWith('/api/admin/')&&!path.startsWith('/api/auth/')&&!path.endsWith('/cancel'))leaveWork=runtime.enterWork();
    }
  });
  app.addHook('onResponse',async request=>{request.operatorExecution?.release();});
  app.addHook('onSend',async(request,reply,payload)=>{
    if(request.url.startsWith('/api/'))reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof OperatorError ? error.httpStatus : error instanceof Error && 'validation' in error ? 400 : 500;
    reply.code(status).send({ok: false, error: error instanceof OperatorError ? publicError(error)
      : {code: status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR', message: status === 400 ? 'The request did not match the API schema.' : 'The operation could not complete. Check its recorded state.', retryable: false}});
  });

  app.get('/health', async () => {await store.call('ready',{});return {service: 'jarvis-operator', pid:process.pid, environment: config.environment, storage: 'ready',
    agentQueue: runs.lastFailure ? 'degraded' : 'ready', actionQueue: actions.lastFailure ? 'degraded' : 'ready',
    scheduler: scheduler.lastFailure ? 'degraded' : 'ready', subscriberFailures: bus.subscriberFailures,buildSource:config.buildInfo?.source??null};});
  app.get('/health/ready',async(_request,reply)=>{
    try{await store.call('ready',{});}catch{reply.code(503);return {ready:false,storage:'unavailable'};}
    const state=await runtime.modelStatus();const ready=state.available===true&&runtime.canDrain();
    reply.header('Cache-Control','no-store').code(ready?200:503);return {ready,modelState:state.state,warm:state.warm};
  });
  app.get('/api/runtime',async request=>{
    assert(identity(request).actor.permissions.includes('users.manage'),'FORBIDDEN','Runtime diagnostics require operator management permission.',403);
    return runtime.snapshot();
  });
  app.post<{Body:{operation:'standby'|'wake'|'profile';profile?:'interactive'|'balanced'}}>('/api/admin/runtime',
    {schema:{body:closed({operation:{enum:['standby','wake','profile']},profile:{enum:['interactive','balanced']}},['operation'])}},async request=>{
      assert(identity(request).actor.permissions.includes('users.manage'),'FORBIDDEN','Resource management is not permitted.',403);
      return runtime.control(request.body.operation,request.body.profile,request.operatorExecution!.signal);
    });
  app.get('/', async () => ({service: 'JARVIS operational core', environment: config.environment, version: '0.1.0',
    interface: 'JARVIS Tasks: http://127.0.0.1:18791/#operator'}));
  app.post<{Body: {login: string; password: string}}>('/api/auth/login', {schema: {body: closed({login: {type:'string',minLength:1,maxLength:100}, password: {type:'string',minLength:1,maxLength:200}}, ['login','password'])}}, async (request, reply) => {
    const session = await auth.login(request.body.login, request.body.password, request.ip);
    reply.setCookie(COOKIE, session.token, {httpOnly: true, secure: config.origin.startsWith('https:'), sameSite: 'strict', path: '/', maxAge: 8 * 3600});
    return {actor: session.actor, csrf: session.csrf, expires: session.expires, environment: config.environment};
  });
  app.get('/api/session', async request => ({actor: identity(request).actor, csrf: auth.csrf(identity(request).token),
    expires: identity(request).expires, environment: config.environment}));
  app.post('/api/auth/logout', async (request, reply) => {await auth.revoke(identity(request).token);reply.clearCookie(COOKIE, {path:'/'});return {ok:true};});
  app.post('/api/admin/shutdown',{schema:{body:closed({},[])}},async request=>{
    assert(identity(request).actor.permissions.includes('users.manage'),'FORBIDDEN','Service management is not permitted.',403);
    const active=await store.call<{runs:number;actions:number}>('work.active',{});
    assert(active.runs===0&&active.actions===0,'WORK_ACTIVE','Wait for active or queued jobs to finish before restarting the operator.',409);
    assert(!services.social.hasPendingLogins(),'SOCIAL_LOGIN_ACTIVE','Finish or disconnect the open social sign-in windows before restarting.',409);
    setImmediate(()=>{void app.close();});return {stopping:true};
  });
  app.get('/api/skills', async request => {
    assert(identity(request).actor.permissions.includes('skills.read'), 'FORBIDDEN', 'Skill inspection is not permitted.', 403);
    return {skills: registry.list(), environment: config.environment,model:config.inference?{name:config.inference.model,transport:'ollama',reasoning:config.inference.think}:{name:'Gateway model',transport:'openclaw',reasoning:'high'}};
  });
  app.get('/api/conversations', async request => ({conversations: await store.call('conversation.list', base(request))}));
  app.post('/api/conversations', {schema: {body: closed({}, [])}}, async (request, reply) => {
    const id = randomUUID();
    const conversation = await store.call('conversation.create', {...base(request), id});
    reply.code(201);return conversation;
  });
  app.get<{Params: {id: string}}>('/api/conversations/:id/messages', {schema: {params: closed({id: uuid}, ['id'])}},
    async request => ({messages: await store.call('message.history', {...base(request), conversationId: request.params.id, secure: true, limit: 60})}));
  app.post<{Body: {conversationId: string; requestId: string; message: string; delivery?:'text'|'voice';waitMs?:number}}>('/api/chat', {schema: {body: closed({conversationId: uuid, requestId: uuid, message: {type:'string',minLength:1,maxLength:12000},delivery:{enum:['text','voice']},waitMs:{type:'integer',minimum:0,maximum:20000}}, ['conversationId','requestId','message'])}},
    async (request, reply) => {
      let run=await runs.accept(request.body.message,{...invocation(request,request.body.conversationId,request.body.requestId),channel:request.body.delivery==='voice'?'voice':'web'});
      const deadline=Date.now()+(request.body.waitMs??0);
      if(request.body.waitMs)void runs.drain().catch(error=>{runs.lastFailure=publicError(error);});
      while(['queued','running'].includes(String(run.state))&&Date.now()<deadline){
        await delay(Math.min(100,Math.max(1,deadline-Date.now())),undefined,{signal:request.operatorExecution!.signal});
        run=await store.call<ObjectValue>('run.get',{...base(request),id:request.body.requestId,secure:true});
      }
      if(request.body.waitMs){try{await auth.resolve(identity(request).token);}catch{throw new OperatorError('AUTHORITY_CHANGED','Account authority changed after admission. Sign in and inspect the recorded task.',403);}}
      reply.code(request.body.waitMs&&!['queued','running'].includes(String(run.state))?200:202);return run;
    });
  app.get<{Params: {id: string}}>('/api/runs/:id', {schema: {params: closed({id: uuid}, ['id'])}},
    async request => store.call('run.get', {...base(request), id: request.params.id, secure: true}));
  app.post<{Params: {id: string}}>('/api/conversations/:id/cancel', {schema: {params: closed({id: uuid}, ['id']), body: closed({}, [])}}, async request => {
    return runs.cancel(identity(request).actor, request.params.id);
  });
  app.post<{Params: {id: string; runId: string}}>('/api/conversations/:id/runs/:runId/cancel',
    {schema:{params:closed({id:uuid,runId:uuid},['id','runId']),body:closed({},[])}}, async request => {
      return runs.cancelRequest(identity(request).actor, request.params.id, request.params.runId);
    });
  app.post<{Body: {tool: string; input: ObjectValue; conversationId: string; requestId: string}}>('/api/tools/invoke', {schema: {body: closed({tool: {type:'string',pattern:'^jarvis_[a-z0-9_]+$'}, input: {type:'object'}, conversationId: uuid, requestId: uuid}, ['tool','input','conversationId','requestId'])}},
    async request => owner.invoke(request.body.tool, request.body.input, invocation(request, request.body.conversationId, request.body.requestId)));
  app.get('/api/actions', async request => ({actions: (await store.call<import('./contracts.js').Action[]>('action.list', {...base(request), secure: true})).map(actionView)}));
  app.get<{Params: {id: string}}>('/api/actions/:id', {schema: {params: closed({id: uuid}, ['id'])}}, async request => {
    const action = await store.call<import('./contracts.js').Action>('action.get', {...base(request), id: request.params.id, secure: true});
    return {...actionView(action), input: action.input, result: action.result};
  });
  app.post<{Params:{id:string}; Body:{decision:'approve'|'deny'; inputHash:string; fingerprint:string; eventKey:string}}>('/api/actions/:id/decision',
    {schema:{params:closed({id:uuid},['id']),body:closed({decision:{enum:['approve','deny']}, inputHash:{type:'string',pattern:'^[a-f0-9]{64}$'}, fingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'}, eventKey:uuid},['decision','inputHash','fingerprint','eventKey'])}},
    async request => actionView(await actions.decide(invocation(request, ''), request.params.id, request.body.decision,
      request.body.inputHash, request.body.fingerprint, request.body.eventKey)));
  app.post<{Params:{id:string}}>('/api/actions/:id/cancel', {schema:{params:closed({id:uuid},['id']),body:closed({},[])}},
    async request => actionView(await actions.cancel(invocation(request,''),request.params.id)));
  app.post<{Body:{query:string}}>('/api/memory/search', {schema:{body:closed({query:{type:'string',maxLength:200}},['query'])}},
    async request => ({memories:await store.call('memory.search',{...base(request),query:request.body.query,secure:true})}));
  app.get('/api/audit', async request => ({events:await store.call('audit.list',{...base(request),limit:100})}));
  app.get('/api/artifacts',async request=>{
    assert(identity(request).actor.permissions.includes('files.read'),'FORBIDDEN','Document access is not permitted.',403);
    const records=await store.call<Array<{data:ObjectValue}>>('record.list',{...base(request),kind:'artifact'});
    return {artifacts:records.map(({data})=>({id:data.id,name:data.name,format:data.format,bytes:data.bytes,sha256:data.sha256,url:data.url}))};
  });
  app.get<{Params:{id:string}}>('/api/artifacts/:id/download',{schema:{params:closed({id:uuid},['id'])}},async(request,reply)=>{
    const artifact=await store.call<ObjectValue>('artifact.get',{...base(request),id:request.params.id,secure:true});
    const location=await containedFile(actorArtifactRoot(identity(request).actor),String(artifact.relative)),data=await readFile(location);
    assert(createHash('sha256').update(data).digest('hex')===artifact.sha256,'ARTIFACT_CHANGED','The saved file no longer matches its receipt.',409);
    reply.header('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(String(artifact.name)));
    reply.type(({pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',md:'text/markdown',txt:'text/plain',json:'application/json'} as Record<string,string>)[String(artifact.format)]??'application/octet-stream');
    return data;
  });
  app.post<{Body:{name:string;data:string}}>('/api/files/upload',{bodyLimit:28*1024*1024,schema:{body:closed({name:{type:'string',maxLength:160},data:{type:'string',maxLength:28*1024*1024}},['name','data'])}},async request=>{
    const actor=identity(request).actor;assert(actor.permissions.includes('files.read'),'FORBIDDEN','Document access is not permitted.',403);
    const name=relativeFile(request.body.name);assert(!name.includes('/')&&/\.(pdf|docx|xlsx|csv|txt|md|json)$/i.test(name),'FILE_TYPE_UNSUPPORTED','Upload a document, spreadsheet or text file.');
    const bytes=Buffer.from(request.body.data,'base64');assert(bytes.length>0&&bytes.length<=20*1024*1024,'FILE_LIMIT','Upload up to 20 MiB.',413);
    const folder=path.join(roots(actor).inbox!,randomUUID());await mkdir(folder,{recursive:true});await writeFile(path.join(folder,name),bytes,{flag:'wx',mode:0o600});
    const relative=path.basename(folder)+'/'+name;await store.call('audit.append',{...base(request),kind:'file.uploaded',sensitivity:'pii',payload:{name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
    return {root:'inbox',path:relative,name,bytes:bytes.length};
  });
  app.get('/api/tasks',async request=>{assert(identity(request).actor.permissions.includes('tasks.read'),'FORBIDDEN','Task access is not permitted.',403);return {tasks:await store.call('record.list',{...base(request),kind:'task'})};});
  app.get('/api/firm/profile',async request=>{assert(identity(request).actor.tenantId===config.tenantId,'FORBIDDEN','This firm profile is not available.',403);return {firm:config.firm??null,tenant:config.tenantId};});
  app.get('/api/connections/clinic',async request=>services.clinic.status(identity(request).actor));
  app.get('/api/connections/mail',async request=>services.mail.status(identity(request).actor));
  app.get('/api/finance',{schema:{querystring:closed({},[])}},async request=>{
    const actor=identity(request).actor,descriptor=registry.descriptor('jarvis_finance');
    assert(descriptor.manifest.permissions.every(permission=>actor.permissions.includes(permission)),'FORBIDDEN','Finance read access is not permitted.',403);
    const value=await services.finance.read(actor,{action:'overview'},request.operatorExecution!.signal);
    const current=await auth.resolve(identity(request).token);request.operatorExecution!.signal.throwIfAborted();
    assert(current.actor.revision===actor.revision,'AUTHORITY_CHANGED','Account authority changed during the Finance read.',403);
    await store.call('audit.append',{...base(request),kind:'finance.read',sensitivity:'pii',payload:{action:'overview',status:value.status??null,elapsedMs:value.elapsedMs??null}});
    return value;
  });
  app.post<{Body:ObjectValue}>('/api/connections/mail',{schema:{body:closed({imapHost:{type:'string',maxLength:200},user:{type:'string',maxLength:200},password:{type:'string',maxLength:500},
    smtpHost:{type:'string',maxLength:200},smtpPort:{enum:[465,587]},from:{type:'string',format:'email',maxLength:200}},['imapHost','user','password'])}},async request=>
    services.mail.connect(identity(request).actor,request.body,request.operatorExecution!.signal));
  app.post<{Body:{email:string;password:string}}>('/api/connections/clinic',{schema:{body:closed({email:{type:'string',maxLength:200},password:{type:'string',maxLength:300}},['email','password'])}},async request=>
    services.clinic.login(identity(request).actor,request.body.email,request.body.password,request.operatorExecution!.signal));
  app.get('/api/schedules',async request=>({schedules:await store.call('schedule.list',{...base(request),secure:true})}));
  app.get('/api/social/connections',async request=>services.social.status(identity(request).actor));
  const socialParams=closed({platform:{enum:['instagram','tiktok']}},['platform']);
  app.post<{Params:{platform:string}}>('/api/social/connections/:platform/start',{schema:{params:socialParams,body:closed({},[])}},async request=>
    services.social.startLogin(identity(request).actor,request.params.platform));
  app.post<{Params:{platform:string};Body:{loginId:string;label?:string}}>('/api/social/connections/:platform/save',
    {schema:{params:socialParams,body:closed({loginId:uuid,label:{type:'string',maxLength:80}},['loginId'])}},async request=>
      services.social.saveLogin(identity(request).actor,request.params.platform,request.body.loginId,request.body.label));
  app.post<{Params:{platform:string}}>('/api/social/connections/:platform/disconnect',{schema:{params:socialParams,body:closed({},[])}},async request=>
    services.social.disconnect(identity(request).actor,request.params.platform));
  app.post<{Params:{platform:string};Body:{loginId:string}}>('/api/social/connections/:platform/close',
    {schema:{params:socialParams,body:closed({loginId:uuid},['loginId'])}},async request=>services.social.cancelLogin(identity(request).actor,request.params.platform,request.body.loginId));
  app.get('/api/social/contacts',async request=>services.social.contacts(identity(request).actor));
  app.get('/api/social/searches',async request=>services.social.searches(identity(request).actor));
  app.get('/api/social/contacts/export',async(request,reply)=>{
    const csv=await services.social.export(identity(request).actor);
    reply.header('Content-Disposition','attachment; filename="jarvis-social-contacts.csv"');reply.type('text/csv; charset=utf-8');return csv;
  });
  app.put<{Params:{id:string};Body:{expectedRevision:number;tool:string;input:ObjectValue;cron:string;timezone:string;enabled:boolean}}>(
    '/api/schedules/:id',{schema:{params:closed({id:uuid},['id']),body:closed({expectedRevision:{type:'integer',minimum:0},tool:{type:'string'},input:{type:'object'},
      cron:{type:'string',minLength:1,maxLength:150},timezone:{type:'string',minLength:1,maxLength:100},enabled:{type:'boolean'}},['expectedRevision','tool','input','cron','timezone','enabled'])}},async request=>{
      const descriptor=registry.descriptor(request.body.tool),parsed=registry.input(request.body.tool,request.body.input);
      const schedule=await store.call<Schedule>('schedule.put',{...base(request),...request.body,id:request.params.id,input:parsed.input,fingerprint:descriptor.fingerprint,secure:true});
      scheduler.changed(schedule);return schedule;
    });
  app.get<{Params:{id:string}}>('/api/schedules/:id/jobs',{schema:{params:closed({id:uuid},['id'])}},async request=>
    ({jobs:await store.call('schedule.jobs',{...base(request),id:request.params.id,secure:true})}));
  app.get<{Querystring:{after?:string}}>('/api/notifications',{schema:{querystring:closed({after:{type:'string',pattern:'^[0-9]{1,15}$'}},[])}},async request=>
    ({notifications:await store.call('notification.list',{...base(request),after:Number(request.query.after??0)})}));
  app.post<{Params:{id:string}}>('/api/notifications/:id/ack',{schema:{params:closed({id:uuid},['id']),body:closed({},[])}},async request=>
    store.call('notification.ack',{...base(request),id:request.params.id}));
  app.get<{Params:{id:string}}>('/api/audit/:id', {schema:{params:closed({id:uuid},['id'])}},
    async request => ({details:await store.call('audit.detail',{...base(request),id:request.params.id,secure:true})}));
  app.post<{Body:{tool:string;automatic:boolean;maxPerMinute:number;maxPerDay:number}}>('/api/permissions',
    {schema:{body:closed({tool:{type:'string'},automatic:{type:'boolean'},maxPerMinute:{type:'integer',minimum:1,maximum:10},maxPerDay:{type:'integer',minimum:1,maximum:500}},['tool','automatic','maxPerMinute','maxPerDay'])}},
    async request => store.call('policy.set',{...base(request),...request.body}));
  app.get('/api/events', async (request, reply) => {
    const session = identity(request);
    reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});
    const bound = auth.bind(session.actor, new AbortController().signal);
    const unsubscribe = bus.subscribe(session.actor.tenantId, session.actor.id, event => {
      if (!bound.signal.aborted && Date.now() < session.expires) reply.raw.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {if (bound.signal.aborted || Date.now() >= session.expires) reply.raw.end();else reply.raw.write(': heartbeat\n\n');},15000);
    reply.raw.on('close',()=>{clearInterval(heartbeat);unsubscribe();bound.release();});
  });
  await runs.start(options.background !== false); if (options.background !== false) {actions.start();scheduler.start();}
  app.addHook('onClose',async()=>{try {await Promise.all([runs.stop(),scheduler.stop(),actions.stop(),services.social.close()]);}finally{await store.close();}});
  return {app, store, registry, auth, actions, owner, core, runs, scheduler, bus,services};
  } catch (error) {await store.close().catch(()=>{});throw error;}
}
