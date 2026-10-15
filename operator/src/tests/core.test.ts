import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {randomBytes, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createOperator} from '../server.js';
import type {Config} from '../config.js';
import type {Actor, AgentMessage, Invocation, Model, ModelResponse, ObjectValue} from '../contracts.js';
import {IntegrationError, ResilientHttp} from '../resilience.js';
import {EventBus} from '../events.js';
import {workingHistory,cancelledRequestNotice} from '../working-memory.js';
import {OperatorError} from '../errors.js';
import {directCalculation} from '../direct-answer.js';
import {ToolWindow} from '../tool-window.js';

const toolIds = ['jarvis_capabilities','jarvis_clock','jarvis_memory_search','jarvis_memory_remember','jarvis_action_status','jarvis_fixture_send'];

class ScriptedModel implements Model {
  step = 0;
  async complete(messages: AgentMessage[], tools: ObjectValue[], _signal: AbortSignal, onText?: (text:string)=>void): Promise<ModelResponse> {
    this.step++;
    if (this.step === 1) {
      assert(tools.some(tool => (tool.function as ObjectValue).name === 'jarvis_clock'));
      return {text:'',calls:[{id:'call-clock',type:'function',function:{name:'jarvis_clock',arguments:'{}'}}]};
    }
    if (this.step === 2) {
      const observation = messages.find(message => message.role === 'tool');
      assert(observation?.content?.includes('operator-state'));
      return {text:'',calls:[{id:'call-finish',type:'function',function:{name:'jarvis_finish',arguments:'{}'}}]};
    }
    assert.equal(tools.length,0);
    onText?.('The observed ');
    return {text:'The observed clock is available.',calls:[]};
  }
}

async function runtime(run: (value: Awaited<ReturnType<typeof createOperator>>, config: Config) => Promise<void>, model: Model = new ScriptedModel()): Promise<void> {
  const base = fileURLToPath(new URL('../../../runtime/operator-tests/',import.meta.url));
  await mkdir(base,{recursive:true});
  const folder = await mkdtemp(path.join(base,'api-'));
  const config: Config = {environment:'staging',tenantId:'stage-clinic',timezone:'Europe/Prague',host:'127.0.0.1',port:18801,
    origin:'http://127.0.0.1:18801',databasePath:path.join(folder,'state.sqlite'),dataKey:randomBytes(32).toString('hex'),
    callbackKey:randomBytes(32).toString('hex'),adminPassword:randomBytes(32).toString('hex'),
    gatewayUrl:new URL('http://127.0.0.1:18809'),gatewayToken:randomBytes(32).toString('hex'),
    skillsRoot:fileURLToPath(new URL('../../skills/',import.meta.url)),enabledTools:toolIds,providerMode:'fixture',
    maxAgentSteps:4,maxToolCalls:6,configurationHash:'synthetic-config-v1',environmentValues:{}};
  const value=await createOperator(config,model,{background:false});
  try {await value.app.ready();await run(value,config);} finally {await value.app.close();await rm(folder,{recursive:true,force:true});}
}

async function login(value: Awaited<ReturnType<typeof createOperator>>, config: Config) {
  const response=await value.app.inject({method:'POST',url:'/api/auth/login',headers:{origin:config.origin},payload:{login:'matko',password:config.adminPassword}});
  assert.equal(response.statusCode,200,response.body);
  const cookie=String(response.headers['set-cookie']).split(';')[0]!;
  return {headers:{cookie,origin:config.origin,'x-csrf-token':response.json().csrf as string},actor:response.json().actor as Actor};
}

test('authenticated HTTP flow uses schemas, proposes first, and blocks CSRF/identity spoofing', async()=>runtime(async(value,config)=>{
  assert.equal((await value.app.inject('/api/actions')).statusCode,401);
  const session=await login(value,config);
  assert.equal((await value.app.inject({method:'POST',url:'/api/conversations',headers:{cookie:session.headers.cookie,origin:'https://other.invalid'},payload:{}})).statusCode,403);
  const created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
  assert.equal(created.statusCode,201,created.body);
  const conversationId=created.json().id as string;
  const proposed=await value.app.inject({method:'POST',url:'/api/tools/invoke',headers:session.headers,payload:{conversationId,requestId:randomUUID(),tool:'jarvis_fixture_send',input:{recipient:'recipient@example.test',body:'Synthetic delivery',_confidence:'high'}}});
  assert.equal(proposed.statusCode,200,proposed.body);
  assert.equal(proposed.json().status,'approval_required');
  const scope={tenantId:session.actor.tenantId,actorId:session.actor.id,now:Date.now()};
  assert.deepEqual(await value.store.call('record.list',{...scope,kind:'fixture_delivery'}),[]);
  const forged=await value.app.inject({method:'POST',url:'/api/tools/invoke',headers:session.headers,payload:{conversationId,requestId:randomUUID(),tool:'jarvis_clock',input:{},actorId:'other'}});
  assert.equal(forged.statusCode,400);
  const invalid=await value.app.inject({method:'POST',url:'/api/tools/invoke',headers:session.headers,payload:{conversationId,requestId:randomUUID(),tool:'jarvis_fixture_send',input:{recipient:'not-an-email',body:'Synthetic'}}});
  assert.equal(invalid.json().ok,false);
  assert.equal(invalid.json().error.code,'TOOL_INPUT_INVALID');
}));

test('runtime readiness is model-aware and administrative resource changes reject queued work',async t=>{
  let generated=0;
  t.mock.method(globalThis,'fetch',async(input:URL|string|Request)=>{
    const route=new URL(String(input)).pathname;
    if(route==='/api/generate'){generated++;return Response.json({done:true});}
    return Response.json(route==='/api/version'?{version:'qualification'}:{models:[]});
  });
  await runtime(async(value,config)=>{
    config.inference={model:'missing-model',baseUrl:'http://127.0.0.1:11436',think:'xhigh',contextTokens:32768,maxTokens:8192};
    assert.equal((await value.app.inject('/health')).statusCode,200);
    const readiness=await value.app.inject('/health/ready');assert.equal(readiness.statusCode,503);assert.equal(readiness.json().modelState,'missing');
    assert.equal((await value.app.inject('/api/runtime')).statusCode,401);
    const session=await login(value,config);
    const diagnostics=await value.app.inject({method:'GET',url:'/api/runtime',headers:session.headers});assert.equal(diagnostics.statusCode,200);
    assert(!diagnostics.body.includes(config.gatewayToken));assert(!diagnostics.body.includes(config.adminPassword));
    const conversation=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
    await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:{conversationId:conversation.json().id,requestId:randomUUID(),message:'Queued task'}});
    const refused=await value.app.inject({method:'POST',url:'/api/admin/runtime',headers:session.headers,payload:{operation:'standby'}});
    assert.equal(refused.statusCode,409);assert.equal(refused.json().error.code,'WORK_ACTIVE');assert.equal(generated,0);
  });
});

test('approved HTTP action executes once after its cancellation window and preserves a truthful fixture receipt',async t=>runtime(async(value,config)=>{
  const now=Date.now();t.mock.timers.enable({apis:['Date'],now});
  const session=await login(value,config);
  const created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
  const proposed=await value.app.inject({method:'POST',url:'/api/tools/invoke',headers:session.headers,payload:{conversationId:created.json().id,requestId:randomUUID(),tool:'jarvis_fixture_send',input:{recipient:'synthetic@example.test',body:'Only a staging record',_confidence:'high'}}});
  const action=proposed.json().action;
  const request={method:'POST' as const,url:'/api/actions/'+action.id+'/decision',headers:session.headers,
    payload:{decision:'approve',inputHash:action.inputHash,fingerprint:action.fingerprint,eventKey:randomUUID()}};
  const approved=await value.app.inject(request);
  assert.equal(approved.statusCode,200,approved.body);assert.equal(approved.json().state,'queued');
  assert.equal(await value.actions.runOne(),null);
  t.mock.timers.setTime(now+10001);
  const completed=await value.actions.runOne();
  assert.equal(completed?.state,'succeeded');assert.equal((completed?.result?.data as ObjectValue).externallySent,false);
  assert.equal((await value.app.inject(request)).json().state,'succeeded');
  assert.equal(await value.actions.runOne(),null);
  const records=await value.store.call<unknown[]>('record.list',{tenantId:session.actor.tenantId,actorId:session.actor.id,kind:'fixture_delivery',now:Date.now()});
  assert.equal(records.length,1);
}));

test('tool admission rejects stale authority and unowned conversations before events or execution',async()=>runtime(async(value,config)=>{
  const session=await login(value,config);
  const created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
  const context:Invocation={actor:session.actor,environment:'staging',conversationId:randomUUID(),intentId:randomUUID(),channel:'web',secure:true,confidence:'high',source:'user',signal:new AbortController().signal};
  const events:unknown[]=[];const unsubscribe=value.bus.subscribe(session.actor.tenantId,session.actor.id,event=>{events.push(event);});
  const absent=await value.owner.invoke('jarvis_clock',{},context);
  assert.equal((absent.error as ObjectValue).code,'NOT_FOUND');assert.equal(events.length,0);
  await value.store.call('actor.update',{tenantId:session.actor.tenantId,actorId:session.actor.id,id:session.actor.id,now:Date.now(),permissions:session.actor.permissions});
  const stale=await value.owner.invoke('jarvis_clock',{}, {...context,conversationId:created.json().id as string});
  assert.equal((stale.error as ObjectValue).code,'AUTHORITY_CHANGED');assert.equal(events.length,0);unsubscribe();
}));

test('cancellation removes queued requests and a late finish cannot resurrect them',async()=>runtime(async(value,config)=>{
  const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
  const conversationId=created.json().id as string,id=randomUUID();
  await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:{conversationId,requestId:id,message:'A request cancelled before it runs.'}});
  const cancelled=await value.app.inject({method:'POST',url:`/api/conversations/${conversationId}/cancel`,headers:session.headers,payload:{}});
  assert.equal(cancelled.json().cancelled,1);
  await value.runs.drain();
  const finished=await value.store.call<ObjectValue>('run.finish',{tenantId:session.actor.tenantId,actorId:session.actor.id,id,now:Date.now(),result:{text:'late'}});
  assert.equal(finished.state,'cancelled');
  const messages=await value.app.inject({method:'GET',url:`/api/conversations/${conversationId}/messages`,headers:session.headers});
  assert.deepEqual(messages.json().messages,[]);
}));

test('request-scoped cancellation fences late admission and cannot cancel the next active turn',async()=>{
  let entered!:()=>void,finish!:(value:ModelResponse)=>void,signal!:AbortSignal;
  const started=new Promise<void>(resolve=>{entered=resolve;}),answer=new Promise<ModelResponse>(resolve=>{finish=resolve;});
  const model:Model={complete:async(_messages,_tools,value)=>{signal=value;entered();return answer;}};
  await runtime(async(value,config)=>{
    const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
    const conversationId=created.json().id as string,oldId=randomUUID(),nextId=randomUUID();
    const cancel=()=>value.app.inject({method:'POST',url:`/api/conversations/${conversationId}/runs/${oldId}/cancel`,headers:session.headers,payload:{}});
    const fenced=await cancel();assert.equal(fenced.statusCode,200,fenced.body);assert.equal(fenced.json().state,'cancelled');
    const late=await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:{conversationId,requestId:oldId,message:'An interrupted request arriving late.'}});
    assert.equal(late.json().state,'cancelled');
    const conflict=await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:{conversationId,requestId:oldId,message:'Different input under the old identity.'}});
    assert.equal(conflict.statusCode,409);
    await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:{conversationId,requestId:nextId,message:'The next legitimate question.'}});
    const draining=value.runs.drain();await started;
    try{assert.equal((await cancel()).statusCode,200);assert.equal(signal.aborted,false,'A delayed old cancellation must not abort the next question');}
    finally{finish({text:'The next question completed.',calls:[]});await draining;}
    const next=await value.app.inject({method:'GET',url:'/api/runs/'+nextId,headers:session.headers});assert.equal(next.json().state,'completed');
    const history=await value.app.inject({method:'GET',url:`/api/conversations/${conversationId}/messages`,headers:session.headers});
    assert(!history.body.includes('An interrupted request arriving late.'));
    const completed=await value.app.inject({method:'POST',url:`/api/conversations/${conversationId}/runs/${nextId}/cancel`,headers:session.headers,payload:{}});
    assert.equal(completed.json().state,'completed');assert.equal(completed.json().cancelled,0);
  },model);
});

test('request-scoped cancellation requires the owner and does not cross conversation or actor scope',async()=>runtime(async(value,config)=>{
  const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
  const conversationId=created.json().id as string,otherConversation=randomUUID(),otherRun=randomUUID();
  const other={tenantId:session.actor.tenantId,actorId:'other',now:Date.now()};
  await value.store.call('actor.create',{...other,actorId:session.actor.id,id:'other',login:'other',displayName:'Synthetic other',roles:['reader'],permissions:['operator.chat'],language:'en',timezone:'Europe/Prague',passwordHash:'synthetic-only'});
  await value.store.call('conversation.create',{...other,id:otherConversation});
  await value.store.call('run.accept',{...other,id:otherRun,conversationId:otherConversation,message:'Synthetic private task'});
  const target=`/api/conversations/${conversationId}/runs/${otherRun}/cancel`;
  assert.equal((await value.app.inject({method:'POST',url:target,headers:{origin:config.origin},payload:{}})).statusCode,401);
  assert.equal((await value.app.inject({method:'POST',url:target,headers:session.headers,payload:{}})).statusCode,404);
  assert.equal((await value.app.inject({method:'POST',url:target,headers:session.headers,payload:{actorId:'other'}})).statusCode,400);
  const otherState=await value.store.call<ObjectValue>('run.get',{...other,id:otherRun,secure:false});assert.equal(otherState.state,'queued');
}));

test('request-scoped cancellation aborts the matching active run and a late answer cannot revive it',async()=>{
  let entered!:()=>void,finish!:(value:ModelResponse)=>void,signal!:AbortSignal;
  const started=new Promise<void>(resolve=>{entered=resolve;}),answer=new Promise<ModelResponse>(resolve=>{finish=resolve;});
  const model:Model={complete:async(_messages,_tools,value)=>{signal=value;entered();return answer;}};
  await runtime(async(value,config)=>{
    const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
    const conversationId=created.json().id as string,requestId=randomUUID();
    await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:{conversationId,requestId,message:'Synthetic interrupted turn'}});
    const draining=value.runs.drain();await started;
    try{
      const cancelled=await value.app.inject({method:'POST',url:`/api/conversations/${conversationId}/runs/${requestId}/cancel`,headers:session.headers,payload:{}});
      assert.equal(cancelled.statusCode,200);assert.equal(cancelled.json().cancelled,1);assert.equal(signal.aborted,true);
    }finally{finish({text:'SYNTHETIC_STALE_ANSWER',calls:[]});await draining;}
    const run=await value.app.inject({method:'GET',url:'/api/runs/'+requestId,headers:session.headers});assert.equal(run.json().state,'cancelled');
    const history=await value.app.inject({method:'GET',url:`/api/conversations/${conversationId}/messages`,headers:session.headers});
    assert(!history.body.includes('SYNTHETIC_STALE_ANSWER'));
    assert(history.body.includes('Do not resume it unless the user explicitly asks.'));
    await value.store.call('run.finish',{tenantId:session.actor.tenantId,actorId:session.actor.id,id:requestId,now:Date.now(),result:{text:'ignored'}});
    const replay=await value.app.inject({method:'GET',url:`/api/conversations/${conversationId}/messages`,headers:session.headers});
    assert.equal(replay.json().messages.length,history.json().messages.length);
  },model);
});

test('an interrupted working history is repaired without inventing outcomes or leaking protected frames',()=>{
  const history:Array<{message?:AgentMessage}>=[{message:{role:'user',content:'Perform the prior task'}},
    {message:{role:'assistant',content:null,tool_calls:[{id:'a',type:'function',function:{name:'jarvis_clock',arguments:'{}'}},{id:'b',type:'function',function:{name:'jarvis_memory_remember',arguments:'{}'}}]}},
    {message:{role:'tool',tool_call_id:'a',content:'{"ok":true}'}},{message:{role:'user',content:'What happened?'}}];
  const working=workingHistory(history);
  assert.equal(working[3]?.tool_call_id,'b');assert(working[3]?.content?.includes('outcome may be unknown'));
  assert.equal(history.length,4);assert.deepEqual(workingHistory([{}, {}, {}]),[]);
} );

test('working history carries only the fixed cancellation notice and closes interrupted tool pairs first',()=>{
  const notice={role:'system' as const,content:cancelledRequestNotice,notice:'request_cancelled'};
  const history=workingHistory([
    {message:{role:'user',content:'Synthetic old request'}},
    {message:{role:'assistant',content:null,tool_calls:[{id:'pending',type:'function',function:{name:'jarvis_clock',arguments:'{}'}}]}},
    {message:{...notice,content:'SYNTHETIC_UNTRUSTED_SYSTEM_INSTRUCTION'}},
    {message:notice},
  ]);
  assert(!JSON.stringify(history).includes('SYNTHETIC_UNTRUSTED_SYSTEM_INSTRUCTION'));
  assert.equal(history.at(-2)?.role,'tool');assert.equal(history.at(-2)?.tool_call_id,'pending');
  assert.equal(history.at(-1)?.content,cancelledRequestNotice);
});

test('provider reasoning is available for this run but never persisted or delivered',async()=>{
  const marker='SYNTHETIC_EPHEMERAL_CONTINUATION';let step=0;
  const model:Model={complete:async messages=>{
    if(step++===0)return {text:'',thinking:marker,calls:[{id:'clock',type:'function',function:{name:'jarvis_clock',arguments:'{}'}}]};
    assert(messages.some(message=>message.thinking===marker));return {text:'The clock was read.',thinking:marker,calls:[]};
  }};
  await runtime(async(value,config)=>{
    const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
    const events:unknown[]=[];const off=value.bus.subscribe(session.actor.tenantId,session.actor.id,event=>{events.push(event);});
    const result=await value.core.run('Read the clock',{actor:session.actor,environment:'staging',conversationId:created.json().id as string,
      intentId:randomUUID(),channel:'web',secure:true,confidence:'unknown',source:'user',signal:AbortSignal.timeout(5000)});
    off();assert(!JSON.stringify(result).includes(marker));assert(!JSON.stringify(events).includes(marker));
    const history=await value.app.inject({method:'GET',url:`/api/conversations/${created.json().id}/messages`,headers:session.headers});
    assert(!history.body.includes(marker));assert(!history.body.includes('thinking'));
  },model);
});

test('the last permitted tool step preserves its real effect in an explicit partial result',async()=>{
  let calls=0;
  const model:Model={complete:async(_messages,tools)=>{
    if(calls++===0)return {text:'',calls:[{id:'remember',type:'function',function:{name:'jarvis_memory_remember',arguments:'{"kind":"fact","key":"partial-proof","value":"saved once","_confidence":"high"}'}}]};
    assert.equal(tools.length,0);return {text:'The requested fact was saved.',calls:[]};
  }};
  await runtime(async(value,config)=>{
    config.maxAgentSteps=1;const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
    const result=await value.core.run('Save this fact',{actor:session.actor,environment:'staging',conversationId:created.json().id as string,
      intentId:randomUUID(),channel:'web',secure:true,confidence:'unknown',source:'user',signal:AbortSignal.timeout(5000)});
    assert.equal(result.completion,'incomplete');assert.match(result.text,/partial/i);assert.equal(result.toolResults.length,1);
    const observation=result.toolResults[0]?.observation as ObjectValue;assert.equal(observation.status,'succeeded');
    assert.equal(calls,2);const found=await value.store.call<unknown[]>('memory.search',{tenantId:session.actor.tenantId,actorId:session.actor.id,query:'partial-proof',secure:true,now:Date.now()});assert.equal(found.length,1);
  },model);
});

test('voice delivery keeps authenticated authority and requests a concise spoken answer',async()=>{
  const model:Model={complete:async messages=>{assert(messages[0]?.content?.includes('spoken conversation'));return {text:'Ready.',calls:[]};}};
  await runtime(async(value,config)=>{
    const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}}),id=randomUUID();
    const response=await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:{conversationId:created.json().id,requestId:id,message:'Hello',delivery:'voice'}});
    assert.equal(response.statusCode,202);await value.runs.drain();
    const run=await value.app.inject({method:'GET',url:'/api/runs/'+id,headers:session.headers});assert.equal(run.json().state,'completed');
    const invalid=await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:{conversationId:created.json().id,requestId:randomUUID(),message:'Hello',delivery:'phone'}});assert.equal(invalid.statusCode,400);
  },model);
});

test('a bounded chat wait returns the durable result and duplicate requests do not rerun it',async()=>{
  let generated=0;const model:Model={complete:async()=>{generated++;return {text:'A verified response.',calls:[]};}};
  await runtime(async(value,config)=>{
    const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
    const payload={conversationId:created.json().id,requestId:randomUUID(),message:'Hello',waitMs:1000};
    const result=await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload});assert.equal(result.statusCode,200);assert.equal(result.json().result.text,'A verified response.');
    assert.equal((await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload})).json().state,'completed');assert.equal(generated,1);
    assert.equal((await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:{...payload,requestId:randomUUID(),waitMs:20001}})).statusCode,400);
  },model);
});

test('model-selected direct delivery uses only a completed exact calculator result',async t=>{
  const observed:ObjectValue={ok:true,status:'completed',result:{data:{value:'355.00',rounded:false}}};
  assert.equal(directCalculation('jarvis_calculate',{_respond:true},observed,1),'355.');
  assert.equal(directCalculation('jarvis_calculate',{_respond:true},observed,2),null);
  assert.equal(directCalculation('jarvis_calculate',{},observed,1),null);
  assert.equal(directCalculation('jarvis_clock',{_respond:true},observed,1),null);
  assert.equal(directCalculation('jarvis_calculate',{_respond:true},{...observed,ok:false},1),null);
  assert.equal(directCalculation('jarvis_calculate',{_respond:true},{ok:true,result:{data:{value:'0.3333',rounded:true}}},1),null);
  let calls=0;const model:Model={complete:async()=>{calls++;return {text:'',calls:[{id:'calc',type:'function',function:{name:'jarvis_calculate',arguments:'{"expression":"12*25+11*5","_respond":true}'}}]};}};
  await runtime(async(value,config)=>{
    const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
    t.mock.method(value.owner,'invoke',async(name:string)=>{assert.equal(name,'jarvis_calculate');return observed;});
    const result=await value.core.run('Calculate this',{actor:session.actor,environment:'staging',conversationId:created.json().id as string,
      intentId:randomUUID(),channel:'voice',secure:true,confidence:'unknown',source:'user',signal:AbortSignal.timeout(5000)});
    assert.equal(calls,1);assert.equal(result.text,'355.');assert.equal(result.completion,'complete');assert.equal(result.toolResults.length,1);
  },model);
});

test('tool discovery reveals only actor-authorized schemas and the chosen domain still uses the owner',async()=>{
  const window=new ToolWindow([]),available=[{type:'function',function:{name:'jarvis_memory_remember'}}];
  assert.equal(window.schemas(available).length,0);window.select({domains:['tasks','clinic']},available);assert.equal(window.schemas(available).length,1);
  assert.throws(()=>window.select({domains:['invented-admin']},available));
  let step=0;const model:Model={complete:async(_messages,tools)=>{
    const names=tools.map(tool=>(tool.function as ObjectValue).name);
    if(step++===0){assert(!names.includes('jarvis_memory_remember'));assert(names.includes('jarvis_select_tools'));
      return {text:'',calls:[{id:'select',type:'function',function:{name:'jarvis_select_tools',arguments:'{"domains":["tasks"]}'}}]};}
    if(step===2){assert(names.includes('jarvis_memory_remember'));return {text:'',calls:[{id:'save',type:'function',function:{name:'jarvis_memory_remember',arguments:'{"kind":"fact","key":"discovery-proof","value":"saved through owner","_confidence":"high"}'}}]};}
    return {text:'Saved.',calls:[]};
  }};
  await runtime(async(value,config)=>{
    config.toolDiscovery=true;const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
    const result=await value.core.run('Remember the fact',{actor:session.actor,environment:'staging',conversationId:created.json().id as string,intentId:randomUUID(),channel:'web',secure:true,confidence:'unknown',source:'user',signal:AbortSignal.timeout(5000)});
    assert.equal(result.toolResults.length,1);assert.equal((result.toolResults[0]?.observation as ObjectValue).status,'succeeded');
  },model);
});

for(const variant of ['duplicate','budget'] as const)test(`invalid ${variant} tool batches execute no prefix and persist no invalid assistant frame`,async t=>{
  const call={id:'a',type:'function' as const,function:{name:'jarvis_clock',arguments:'{}'}};
  const model:Model={complete:async()=>({text:'',calls:variant==='duplicate'?[call,call]:Array.from({length:7},(_,i)=>({...call,id:String(i)}))})};
  await runtime(async(value,config)=>{
    const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
    const invoked=t.mock.method(value.owner,'invoke');
    await assert.rejects(value.core.run('Check the clock',{actor:session.actor,environment:'staging',conversationId:created.json().id as string,intentId:randomUUID(),channel:'web',secure:true,confidence:'unknown',source:'user',signal:new AbortController().signal}),error=>error instanceof OperatorError&&error.code===(variant==='duplicate'?'AGENT_CALL_REPLAY':'AGENT_CALL_LIMIT'));
    assert.equal(invoked.mock.callCount(),0);
    const messages=await value.app.inject({method:'GET',url:`/api/conversations/${created.json().id}/messages`,headers:session.headers});
    assert.equal(messages.json().messages.length,1);
  },model);
});

test('a lost finalization acknowledgement retries only the durable result, never the agent',async t=>runtime(async(value,config)=>{
  const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
  const id=randomUUID();
  await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:{conversationId:created.json().id,requestId:id,message:'Read the actual clock.'}});
  const original=value.store.call.bind(value.store);let finalizations=0;
  t.mock.method(value.store,'call',async<T>(operation:string,args:ObjectValue):Promise<T>=>{
    const result=await original<T>(operation,args);
    if(operation==='run.finish'&&++finalizations===1)throw new OperatorError('STORE_ERROR','Synthetic lost acknowledgement',503);
    return result;
  });
  const execute=t.mock.method(value.core,'run');
  await value.runs.drain();assert(value.runs.lastFailure);
  await value.runs.drain();assert.equal(value.runs.lastFailure,null);assert.equal(execute.mock.callCount(),1);
  const result=await value.app.inject({method:'GET',url:'/api/runs/'+id,headers:session.headers});
  assert.equal(result.json().state,'completed');assert.equal(result.json().result.text,'The observed clock is available.');
}));

test('the HTTP request queue executes observe/follow-up/finalize and retains its result',async()=>runtime(async(value,config)=>{
  const session=await login(value,config);
  const created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
  const id=created.json().id as string,requestId=randomUUID();
  const textEvents:string[]=[];
  const unsubscribe=value.bus.subscribe(session.actor.tenantId,session.actor.id,event=>{if(event.kind==='agent.text')textEvents.push(String(event.data.text));});
  const request={conversationId:id,requestId,message:'Read the actual clock and report it.'};
  const accepted=await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:request});
  assert.equal(accepted.statusCode,202,accepted.body);
  await value.runs.drain();
  const completed=await value.app.inject({method:'GET',url:'/api/runs/'+requestId,headers:session.headers});
  assert.equal(completed.json().state,'completed',completed.body);
  assert.equal(completed.json().result.text,'The observed clock is available.');
  assert.deepEqual(textEvents,['The observed clock is available.']);
  const repeated=await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:request});
  assert.equal(repeated.json().state,'completed');
  const changed=await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:{...request,message:'A different request'}});
  assert.equal(changed.statusCode,409);
  unsubscribe();
}));

test('a text-only final completion is not regenerated by an unnecessary extra model turn',async()=>{
  let steps=0;
  const model:Model={complete:async(_messages,_tools,_signal,_onText,choice)=>{
    steps++;
    assert.equal(choice,'auto');return {text:'Hello, Matko.',calls:[]};
  }};
  await runtime(async(value,config)=>{
    const session=await login(value,config),created=await value.app.inject({method:'POST',url:'/api/conversations',headers:session.headers,payload:{}});
    const id=randomUUID();
    await value.app.inject({method:'POST',url:'/api/chat',headers:session.headers,payload:{conversationId:created.json().id,requestId:id,message:'Hello.'}});
    await value.runs.drain();
    const completed=await value.app.inject({method:'GET',url:'/api/runs/'+id,headers:session.headers});
    assert.equal(completed.json().state,'completed');assert.equal(completed.json().result.text,'Hello, Matko.');assert.equal(steps,1);
  },model);
});

test('authenticated scheduler executes a real registered read and exposes safe replayable notifications',async t=>runtime(async(value,config)=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-27T17:00:00Z')});
  const session=await login(value,config),id=randomUUID();
  const created=await value.app.inject({method:'PUT',url:'/api/schedules/'+id,headers:session.headers,
    payload:{expectedRevision:0,tool:'jarvis_clock',input:{},cron:'*/5 * * * *',timezone:'Europe/Prague',enabled:true}});
  assert.equal(created.statusCode,200,created.body);
  t.mock.timers.setTime(created.json().nextRun as number);
  await value.scheduler.tick();
  const jobs=await value.app.inject({method:'GET',url:`/api/schedules/${id}/jobs`,headers:session.headers});
  assert.equal(jobs.json().jobs.length,1);assert.equal(jobs.json().jobs[0].state,'completed',jobs.body);
  assert.equal(jobs.json().jobs[0].result.result.provenance.provider,'operator-state');
  assert.equal(jobs.json().jobs[0].result.result.data.iso,'2026-09-27T17:05:00.000Z');
  assert.equal(jobs.json().jobs[0].result.result.data.localTime,'19:05:00');
  const notes=await value.app.inject({method:'GET',url:'/api/notifications',headers:session.headers});
  assert.equal(notes.json().notifications[0].kind,'schedule.completed');
  assert(!('result' in notes.json().notifications[0].data));
  const note=notes.json().notifications[0];
  const acknowledged=await value.app.inject({method:'POST',url:`/api/notifications/${note.id}/ack`,headers:session.headers,payload:{}});
  assert.equal(acknowledged.json().acknowledged,true);
  const replay=await value.app.inject({method:'GET',url:'/api/notifications?after='+note.sequence,headers:session.headers});
  assert.deepEqual(replay.json().notifications,[]);
}));

test('event subscribers cannot mutate another subscriber view or crash the publisher',async()=>{
  const bus=new EventBus();let observed:unknown;
  bus.subscribe('a','u',event=>{event.data.value='changed';throw new Error('synthetic subscriber failure');});
  bus.subscribe('a','u',event=>{observed=event.data.value;});
  bus.subscribe('other','u',()=>assert.fail('cross-tenant event'));
  bus.publish({id:'event',kind:'test',tenantId:'a',actorId:'u',at:1,data:{value:'original'}});
  assert.equal(observed,'original');assert.equal(bus.subscriberFailures,1);
});

test('external retries do not duplicate ambiguous sends and circuits isolate failures',async()=>{
  let now=0, calls=0;
  const clock={now:()=>now,sleep:async(ms:number)=>{now+=ms;}};
  const fail:typeof fetch=async()=>{calls++;throw new Error('simulated lost acknowledgement');};
  const http=new ResilientHttp(clock,fail,()=>0);
  const options={integration:'mail/account-a',url:new URL('https://example.test/send'),method:'POST',signal:new AbortController().signal,safety:'non_idempotent' as const};
  for(let index=0;index<3;index++)await assert.rejects(http.request(options),(error:unknown)=>error instanceof IntegrationError&&error.outcome==='unknown');
  assert.equal(calls,3);
  await assert.rejects(http.request(options),/retry window/);assert.equal(calls,3);
  let readCalls=0;
  const read:typeof fetch=async()=>{readCalls++;return readCalls<3?new Response('',{status:503}):new Response('{"ok":true}',{status:200});};
  const retrying=new ResilientHttp(clock,read,()=>0);
  const result=await retrying.request({...options,integration:'calendar/account-b',method:'GET',safety:'read'});
  assert.equal(result.status,200);assert.equal(readCalls,3);assert.equal(now,750);
});
