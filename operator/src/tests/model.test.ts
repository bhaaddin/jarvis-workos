import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {OpenClawModel} from '../model.js';
import {OperatorError} from '../errors.js';

test('the actual SSE adapter reconstructs fragmented UTF-8 and function arguments in incognito sessions',async t=>{
  const token=randomBytes(32).toString('hex');let session='';
  const text='data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'clock',function:{name:'jarvis_cl',arguments:'{'}}]}}]})+'\r\n\r\n'
    +'data: '+JSON.stringify({choices:[{delta:{content:'Čas',tool_calls:[{index:0,function:{name:'ock',arguments:'}'}}]}}]})+'\n\n'
    +'data: {"choices":[{"finish_reason":"tool_calls","delta":{}}]}\n\ndata: [DONE]\n\n';
  t.mock.method(globalThis,'fetch',async(input:unknown,options?:RequestInit)=>{
    if(String(input).endsWith('/jarvis/operator-boundary'))return Response.json({boundaryVersion:2,nativeLogsDisabled:true});
    session=new Headers(options?.headers).get('x-openclaw-session-key')??'';
    const encoded=new TextEncoder().encode(text);
    return new Response(new ReadableStream<Uint8Array>({start(controller){for(let index=0;index<encoded.length;index+=3)controller.enqueue(encoded.slice(index,index+3));controller.close();}}));
  });
  const deltas:string[]=[];
  const result=await new OpenClawModel(new URL('http://127.0.0.1:18809'),token).complete([{role:'user',content:'Synthetic'}],[],new AbortController().signal,delta=>{deltas.push(delta);});
  assert.match(session,/^agent:main:dashboard:incognito-jarvis-/);
  assert.equal(result.calls[0]?.function.name,'jarvis_clock');assert.equal(result.calls[0]?.function.arguments,'{}');
  assert.equal(deltas.join(''),'Čas');assert.equal(result.text,'Čas');
});

test('incomplete and provider-rejected streams never become successful model turns',async t=>{
  let mode:'incomplete'|'error'='incomplete';const diagnostics:unknown[]=[];
  t.mock.method(globalThis,'fetch',async(input:unknown)=>String(input).endsWith('/jarvis/operator-boundary')
    ?Response.json({boundaryVersion:2,nativeLogsDisabled:true}):new Response(mode==='incomplete'?'data: {"choices":[]}\n\n'
      :'data: {"error":{"message":"tool_choice=required was not satisfied by the agent response"}}\n\ndata: [DONE]\n\n'));
  const model=new OpenClawModel(new URL('http://127.0.0.1:18809'),randomBytes(32).toString('hex'),5000,value=>{diagnostics.push(value);});
  await assert.rejects(model.complete([],[],new AbortController().signal),error=>error instanceof OperatorError&&error.code==='AGENT_INCOMPLETE');
  mode='error';
  await assert.rejects(model.complete([],[],new AbortController().signal),error=>error instanceof OperatorError&&error.code==='AGENT_STEP_FAILED');
  assert.equal(diagnostics.length,1);
});

test('a Gateway without the non-persistent logging boundary is rejected before sending conversation data',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({boundaryVersion:2,nativeLogsDisabled:false});});
  const model=new OpenClawModel(new URL('http://127.0.0.1:18809'),randomBytes(32).toString('hex'));
  await assert.rejects(model.complete([{role:'user',content:'Synthetic protected turn'}],[],new AbortController().signal),
    error=>error instanceof OperatorError&&error.code==='AGENT_BOUNDARY_UNAVAILABLE');
  assert.equal(calls,1);
});

test('the native empty-result placeholder is not treated as a user answer',async t=>{
  t.mock.method(globalThis,'fetch',async(input:unknown)=>String(input).endsWith('/jarvis/operator-boundary')
    ?Response.json({boundaryVersion:2,nativeLogsDisabled:true}):new Response('data: {"choices":[{"delta":{"content":"No response from OpenClaw."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
  const result=await new OpenClawModel(new URL('http://127.0.0.1:18809'),randomBytes(32).toString('hex')).complete([],[],new AbortController().signal);
  assert.equal(result.text,'');assert.deepEqual(result.calls,[]);
});

test('truncation with DONE is not a completed answer or executable tool batch',async t=>{
  let tool=false;
  t.mock.method(globalThis,'fetch',async(input:unknown,options?:RequestInit)=>{
    if(String(input).endsWith('/jarvis/operator-boundary'))return Response.json({boundaryVersion:2,nativeLogsDisabled:true});
    assert.equal(new Headers(options?.headers).get('x-openclaw-model'),'jarvis-local/gpt-oss:20b');
    const delta=tool?{tool_calls:[{index:0,id:'call',function:{name:'jarvis_clock',arguments:'{}'}}]}:{content:'Apparently complete text'};
    return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:'length'}]})+'\n\ndata: [DONE]\n\n');
  });
  const model=new OpenClawModel(new URL('http://127.0.0.1:18809'),randomBytes(32).toString('hex'),5000,()=>{},'jarvis-local/gpt-oss:20b');
  for(const calls of [false,true]){tool=calls;await assert.rejects(model.complete([],[],new AbortController().signal),error=>error instanceof OperatorError&&error.code==='AGENT_INCOMPLETE');}
});
