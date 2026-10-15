import type {Config} from './config.js';
import type {Json, ObjectValue, Invocation, ToolContext, ToolManifest, ToolOutput, ToolServices} from './contracts.js';
import {assert, OperatorError} from './errors.js';
import type {Registry} from './registry.js';
import {Store} from './store.js';
import {taskRead,taskEffect} from './task-integrations.js';
import {codeWorkspace} from './code-tools.js';

// Integrations that need the owner's account work first. Names only, never secrets.
function credentialSteps(): Array<{integration: string; need: string}> {
  return [
    {integration: 'Twilio (WhatsApp/telephone)', need: 'Account + approved WhatsApp sender + voice number. See WHATSAPP-CALLING.md.'},
    {integration: 'Meta WhatsApp Business', need: 'Business account + Cloud API number (2000+ limit) + calling enabled + user call permission. See WHATSAPP-CALLING.md.'},
    {integration: 'Google OAuth (Calendar, Gmail API)', need: 'OAuth client + authorized refresh token. IMAP/SMTP app passwords work without it.'},
    {integration: 'Azure Speech (Czech hosted voices)', need: 'Speech resource key + region. Local Jirka voice works without it.'},
    {integration: 'Exa search skill', need: 'EXA_API_KEY for the installed exa-search skill; ddgs-search needs none.'},
    {integration: 'Elite longterm memory skill', need: 'OPENAI_API_KEY; the local variant needs none.'},
    {integration: 'Production identity', need: 'OIDC issuer/audience + stable HTTPS origin for webhooks and staff login.'},
    {integration: 'Fio bank statements', need: 'Read-only API token for fio.read_transactions.'},
  ];
}
import {Clinic} from './clinic.js';
import {Mail} from './mail.js';
import {object} from './store-context.js';
import {Social} from './social.js';
import {Finance} from './finance.js';

export class Services {
  readonly clinic:Clinic;
  readonly mail:Mail;
  readonly social:Social;
  readonly finance:Finance;
  constructor(private readonly store: Store, private readonly registry: Registry, private readonly config: Config) {this.clinic=new Clinic(store);this.mail=new Mail(store);this.social=new Social(store);this.finance=new Finance(config);}

  async preflight(manifest:ToolManifest,context:Invocation,input:ObjectValue):Promise<void>{
    if(manifest.serviceOperations.includes('social.research'))await this.social.requireConnections(context.actor,input);
    if(manifest.serviceOperations.includes('documents.create')&&input.tableObservationId){
      assert(input.columns===undefined&&input.rows===undefined,'TABLE_REFERENCE_CONFLICT','Use the verified table observation or manual rows, not both.');
      const entry=await this.store.call<ObjectValue>('table.observation',{tenantId:context.actor.tenantId,actorId:context.actor.id,id:input.tableObservationId,secure:context.secure,now:Date.now()});
      assert(entry.tool==='jarvis_table_query','TABLE_REFERENCE_INVALID','Choose an observation from a successful table query.');
      const source=this.registry.descriptor('jarvis_table_query').manifest;
      assert(source.permissions.every(permission=>context.actor.permissions.includes(permission)),'FORBIDDEN','The source table is no longer permitted.',403);
      const observed=object(entry.result),data=object(object(observed.result).data);
      assert(observed.ok===true&&data.truncated===false&&Array.isArray(data.columns)&&data.columns.length<=30&&Array.isArray(data.rows),
        'TABLE_REFERENCE_INVALID','Choose a complete, bounded query result with columns and rows.');
      const types=Array.isArray(data.columnTypes)?data.columnTypes:[];
      input.columns=data.columns;
      input.rows=data.rows.map(row=>{
        assert(Array.isArray(row),'TABLE_REFERENCE_INVALID','The verified table has invalid rows.');
        return row.map((cell,index)=>typeof cell==='string'&&/^(DECIMAL|DOUBLE|FLOAT|BIGINT|INTEGER|SMALLINT|TINYINT|HUGEINT)/.test(String(types[index]))
          &&cell.replace(/[-.]/g,'').replace(/^0+/,'').length<=15&&Number.isFinite(Number(cell))?Number(cell):cell);
      });
      // Expansion occurs before immutable action admission; execution and retries
      // are bound to these exact source values, not a later model transcription.
      this.registry.input(manifest.id,input);
    }
    if(manifest.serviceOperations.includes('documents.create')&&['xlsx','csv'].includes(String(input.format))){
      assert(Array.isArray(input.columns)&&input.columns.length>0&&Array.isArray(input.rows),
        'DOCUMENT_TABLE_REQUIRED','Spreadsheet/CSV creation requires structured columns and rows; content text is not a worksheet table.');
      assert(Array.isArray(input.totalColumns),'DOCUMENT_TOTALS_REQUIRED','For a spreadsheet/CSV, set totalColumns to numeric column indexes to sum, or [] to avoid a total (for example, across different currencies).');
    }
    if(manifest.serviceOperations.includes('mail.send')){
      const status=await this.mail.status(context.actor);
      assert(status.connected&&status.sendingConfigured,'MAIL_SEND_CONNECTION_REQUIRED','Connect the mailbox and SMTP server before proposing a real send.',409);
    }
  }

  bind(manifest: ToolManifest, context: ToolContext, effect?: {leaseToken: string; authorize: () => Promise<void>}): ToolServices {
    return {invoke: async (name, input) => {
      assert(manifest.serviceOperations.includes(name), 'SERVICE_NOT_DECLARED', 'This skill did not declare that service operation.', 403);
      context.signal.throwIfAborted();
      await context.assertCurrent();
      const base = {tenantId: context.actor.tenantId, actorId: context.actor.id, now: Date.now()};
      const provenance = {provider: 'operator-state', mode: 'live' as const, observedAt: new Date().toISOString()};
      if (name === 'core.capabilities') {
        const skills = this.registry.list().map(value => ({id: value.id, state: value.state, mode: value.mode, missing: value.missing}));
        return {data: {environment: this.config.environment, skills}, sensitivity: 'internal', provenance};
      }
      if (name === 'core.clock') {
        const now = new Date(), local = new Intl.DateTimeFormat('en-CA', {timeZone: context.actor.timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);
        const localTime = new Intl.DateTimeFormat('en-GB', {timeZone: context.actor.timezone, hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).format(now);
        return {data: {iso: now.toISOString(), localDate: local, localTime, timezone: context.actor.timezone}, sensitivity: 'public', provenance};
      }
      if (name === 'memory.search') {
        const data = await this.store.call<Json>('memory.search', {...base, query: input.query ?? '', secure: context.secure});
        return {data, sensitivity: 'pii', provenance};
      }
      if (name === 'actions.status') {
        const action = await this.store.call<ObjectValue>('action.get', {...base, id: input.id ?? '', secure: context.secure});
        return {data: {id: action.id ?? null, state: action.state ?? null, tool: action.tool ?? null,
          reason: action.reason ?? null, errorCode: action.errorCode ?? null}, sensitivity: 'internal', provenance};
      }
      if(name==='actions.result')return {data:await this.store.call<Json>('action.get',{...base,id:input.id??'',secure:context.secure}),sensitivity:'phi',provenance};
      if(name==='observations.read'){
        const entry=await this.store.call<ObjectValue>('audit.detail',{...base,id:input.id??'',secure:context.secure});
        assert(typeof entry.tool==='string'&&entry.result!==undefined,'OBSERVATION_INVALID','Choose an observation ID returned by a completed tool.',404);
        const source=this.registry.descriptor(entry.tool).manifest;
        assert(source.permissions.every(permission=>context.actor.permissions.includes(permission)),'FORBIDDEN','The original observation is no longer permitted.',403);
        let data:Json=entry.result;
        const pointer=String(input.pointer??'');
        assert(!pointer||pointer.startsWith('/'),'OBSERVATION_POINTER_INVALID','Use a JSON pointer beginning with /.');
        for(const part of pointer?pointer.slice(1).split('/'):[]){const key=part.replaceAll('~1','/').replaceAll('~0','~');
          assert(data!==null&&typeof data==='object'&&Object.hasOwn(data,key),'OBSERVATION_FIELD_MISSING','That field is not in this observation.',404);data=(data as ObjectValue)[key]!;}
        const start=Number(input.start??0),limit=Number(input.limit??2000);
        const total=typeof data==='string'||Array.isArray(data)?data.length:null;
        const page=typeof data==='string'?data.slice(start,start+Math.min(limit,5000)):Array.isArray(data)?data.slice(start,start+Math.min(limit,30)):data;
        return {data:{id:input.id??null,pointer,start,total,value:page,truncated:total!==null&&start+(typeof page==='string'||Array.isArray(page)?page.length:0)<total},sensitivity:'phi',provenance};
      }
      if(name==='clinic.read')return {data:await this.clinic.read(context.actor,input,context.signal),sensitivity:'phi',
        provenance:{...provenance,provider:'SportMedical HTTP API',mode:'live'}};
      if(name==='finance.read')return {data:await this.finance.read(context.actor,input,context.signal),sensitivity:'pii',
        provenance:{...provenance,provider:'direct Finance native services',mode:'live'}};
      if(name==='mail.read')return {data:await this.mail.read(context.actor,input,context.signal),sensitivity:'phi',provenance:{...provenance,provider:'IMAP',mode:'live'}};
      if(name==='social.contacts.read')return {data:await this.social.toolContacts(context.actor,input),sensitivity:'pii',provenance:{...provenance,provider:'saved social research'}};
      if(name==='social.research'||name==='social.contacts.update'){
        assert(manifest.risk==='internal_write'&&effect,'EFFECT_NOT_ADMITTED','Social research changes require an admitted internal action.',403);
        const observed=name==='social.research'?await this.social.research(context.actor,input,context.signal):{};
        await context.assertCurrent();await effect.authorize();
        let data=await this.store.call<Json>('social.commit',{...base,actionId:context.actionId,leaseToken:effect.leaseToken,operation:name,input,result:observed});
        if(name==='social.research'){
          const saved=object(data);
          data={...saved,profiles:(saved.profiles as ObjectValue[]).map(profile=>({id:profile.id??null,revision:profile.revision??null,platform:profile.platform??null,
            handle:profile.handle??null,sourceState:profile.sourceState??null,stage:profile.stage??null})),
            next:'Read these saved contact IDs in batches of up to five. Assess the actual source evidence before shortlisting or drafting; preserve unknown criteria.'};
        }
        return {data,sensitivity:'pii',provenance:{...provenance,provider:name==='social.research'?'authenticated social browser':'saved social contacts',mode:'live'}};
      }
      if(name==='mail.send'){
        assert(manifest.risk==='external_write'&&effect,'EFFECT_NOT_ADMITTED','Email sending requires an admitted external action.',403);
        const data=await this.mail.send(context.actor,input,context.signal,effect.authorize);
        await this.store.call('effect.record',{...base,actionId:context.actionId,leaseToken:effect.leaseToken,operation:name,input,result:data});
        return {data,sensitivity:'phi',provenance:{...provenance,provider:'SMTP',mode:'live'}};
      }
      if(name==='mail.attachment'){
        assert(manifest.risk==='internal_write'&&effect,'EFFECT_NOT_ADMITTED','Attachment storage requires an admitted action.',403);
        const data=await this.mail.attachment(context.actor,context.actionId,input,context.signal,effect.authorize);
        await this.store.call('effect.record',{...base,actionId:context.actionId,leaseToken:effect.leaseToken,operation:name,input,result:data});
        return {data,sensitivity:'phi',provenance:{...provenance,provider:'IMAP attachment',mode:'live'}};
      }
      if (name === 'memory.put' || name === 'fixture.send') {
        assert(manifest.risk !== 'read' && effect, 'EFFECT_NOT_ADMITTED', 'A read tool cannot perform a write.', 403);
        await effect.authorize();
        const data = await this.store.call<Json>('effect.apply', {...base, actionId: context.actionId,
          leaseToken: effect.leaseToken, operation: name, input});
        if (name === 'fixture.send') return {data, sensitivity: 'internal', provenance: {...provenance, provider: 'staging-fixture', mode: 'fixture'}};
        return {data, sensitivity: 'pii', provenance};
      }
      if (['projects.read','calculate','weather','skills.search','files.find','documents.read','tables.analyze','computer.read','github.read','web.read','ares.lookup','cnb.rates','czech.calc','transit.plan'].includes(name)) {
        const data=await taskRead(name,input,context);
        return {data,sensitivity:manifest.sensitivity,provenance:{...provenance,provider:name,mode:'live'}};
      }
      if(name==='owner.todo'){
        assert(manifest.risk==='read','OWNER_TODO_READ_ONLY','The owner checklist is a read.');
        const unconfigured=this.registry.list().filter(skill=>skill.state==='missing_config')
          .map(skill=>({skill:skill.id,missing:skill.missing}));
        return {data:{generatedAt:new Date().toISOString(),unconfiguredSkills:unconfigured,
          credentialSteps:credentialSteps()},sensitivity:'internal',provenance:{...provenance,provider:'owner.todo',mode:'live'}};
      }
      if(name==='code.read'){
        assert(manifest.risk==='read'&&input.operation==='read','CODE_READ_ONLY','The read skill only reads project files.',403);
        return {data:await codeWorkspace(input,context),sensitivity:'internal',provenance:{...provenance,provider:'code.read',mode:'live'}};
      }
      if(name==='tasks.list')return {data:await this.store.call<Json>('record.list',{...base,kind:'task'}),sensitivity:'pii',provenance};
      if(name==='tasks.save'){
        assert(manifest.risk!=='read'&&effect,'EFFECT_NOT_ADMITTED','Task changes require an admitted action.',403);
        await effect.authorize();
        return {data:await this.store.call<Json>('effect.apply',{...base,actionId:context.actionId,leaseToken:effect.leaseToken,operation:name,input}),sensitivity:'pii',provenance};
      }
      if (name === 'documents.create' || name === 'sandbox.execute' || name==='browser.run' || name==='code.workspace') {
        assert(manifest.risk!=='read'&&effect,'EFFECT_NOT_ADMITTED','This job requires an admitted action.',403);
        assert(name!=='sandbox.execute'||manifest.risk==='code','EFFECT_NOT_ADMITTED','Generated code requires the code-execution policy.',403);
        assert(name!=='code.workspace'||manifest.risk==='code','EFFECT_NOT_ADMITTED','Project code changes require the code-execution policy.',403);
        assert(name!=='browser.run'||manifest.risk==='external_write','EFFECT_NOT_ADMITTED','Website interactions require external-action admission.',403);
        await effect.authorize();
        const data=await taskEffect(name,input,context);
        await context.assertCurrent();
        await this.store.call('effect.record',{...base,actionId:context.actionId,leaseToken:effect.leaseToken,operation:name,input,result:data});
        return {data,sensitivity:manifest.sensitivity,outcome:(name==='sandbox.execute'||name==='code.workspace')&&data.exitCode!==undefined&&data.exitCode!==0?'failed':'success',provenance:{...provenance,provider:name,mode:'live'}};
      }
      throw new OperatorError('SERVICE_UNAVAILABLE', 'The service operation is not installed or configured.', 409);
    }};
  }
}
