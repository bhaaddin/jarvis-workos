import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Config} from '../config.js';
import type {Model,ObjectValue} from '../contracts.js';
import type {Store} from '../store.js';
import {OperatorError} from '../errors.js';
import {MeteredModel} from '../model-metrics.js';
import {RuntimeControl} from '../runtime-control.js';

async function fixture(work:(value:{runtime:RuntimeControl;config:Config;calls:ObjectValue[];state:{loaded:boolean;installed:boolean;runs:number;actions:number};meter:MeteredModel})=>Promise<void>){
  const parent=fileURLToPath(new URL('../../../runtime/operator-tests/',import.meta.url));await mkdir(parent,{recursive:true});
  const folder=await mkdtemp(path.join(parent,'resources-'));
  const config={configurationHash:'synthetic',resourceProfile:'interactive',resourceConfigPath:path.join(folder,'resources.json'),
    inference:{baseUrl:'http://127.0.0.1:11436',model:'synthetic-model',think:'xhigh',contextTokens:32768,maxTokens:8192,keepAliveSeconds:-1},
    gatewayToken:'SYNTHETIC_PRIVATE_TOKEN',dataKey:'SYNTHETIC_PRIVATE_KEY'} as Config;
  await writeFile(config.resourceConfigPath!,JSON.stringify({profile:'interactive'}));
  const state={loaded:true,installed:true,runs:0,actions:0},calls:ObjectValue[]=[];
  const store={call:async(operation:string)=>{assert.equal(operation,'work.active');return {runs:state.runs,actions:state.actions};}} as unknown as Store;
  const inner:Model={complete:async()=>{state.loaded=true;return {text:'Ready.',calls:[],thinking:'SYNTHETIC_PRIVATE_THINKING'};}};
  const meter=new MeteredModel(inner);
  const fetcher=async(url:URL|string|Request,init?:RequestInit)=>{
    const route=new URL(String(url)).pathname;
    if(route==='/api/generate'){const body=JSON.parse(String(init?.body)) as ObjectValue;calls.push(body);assert.equal(body.model,'synthetic-model');if(body.keep_alive===0)state.loaded=false;return Response.json({done:true});}
    if(route==='/api/version')return Response.json({version:'0.34.4'});
    if(route==='/api/tags')return Response.json({models:state.installed?[{name:'synthetic-model',digest:'synthetic-digest'}]:[]});
    assert.equal(route,'/api/ps');return Response.json({models:state.loaded?[{name:'synthetic-model',size:1000,size_vram:1000,context_length:32768}]:[]});
  };
  const runtime=new RuntimeControl(config,store,inner,meter,fetcher as typeof fetch);
  try{await work({runtime,config,calls,state,meter});}finally{await rm(folder,{recursive:true,force:true});}
}

test('standby refuses queued work and in-flight requests without touching the model',async()=>fixture(async({runtime,state,calls})=>{
  state.runs=1;await assert.rejects(runtime.control('standby',undefined,AbortSignal.timeout(2000)),error=>error instanceof OperatorError&&error.code==='WORK_ACTIVE');
  assert.equal(calls.length,0);assert.equal(runtime.canDrain(),true);state.runs=0;
  const release=runtime.enterWork();await assert.rejects(runtime.control('standby',undefined,AbortSignal.timeout(2000)),/active requests/);release();release();
  await runtime.control('standby',undefined,AbortSignal.timeout(2000));assert.equal(calls.length,1);assert.equal(calls[0]?.keep_alive,0);
  assert.equal((await runtime.modelStatus(true)).state,'cold');
  await runtime.control('wake',undefined,AbortSignal.timeout(2000));assert.equal((await runtime.modelStatus(true)).state,'ready');
}));

test('resource profiles persist only residency policy and runtime status contains no credentials or reasoning',async()=>fixture(async({runtime,config,calls,state})=>{
  const selection=JSON.stringify({...config.inference,keepAliveSeconds:0});
  await runtime.control('profile','balanced',AbortSignal.timeout(2000));
  assert.deepEqual(JSON.parse(await readFile(config.resourceConfigPath!,'utf8')),{profile:'balanced'});
  assert.equal(config.inference?.keepAliveSeconds,900);assert.equal(calls.at(-1)?.keep_alive,900);
  assert.equal(calls.at(-1)?.shift,false);assert.equal(calls.at(-1)?.truncate,false);
  assert.equal(JSON.stringify({...config.inference,keepAliveSeconds:0}),selection);
  const snapshot=await runtime.snapshot(true);assert(!JSON.stringify(snapshot).includes('SYNTHETIC_PRIVATE'));
  state.installed=false;assert.equal((await runtime.modelStatus(true)).state,'missing');
  await assert.rejects(runtime.control('wake',undefined,AbortSignal.timeout(2000)),/Install\/start/);
}));

test('the transition barrier blocks new admission while an idle check is pending',async()=>{
  let release!:(value:{runs:number;actions:number})=>void;
  const pending=new Promise<{runs:number;actions:number}>(resolve=>{release=resolve;});
  const store={call:async()=>pending} as unknown as Store;
  const config={inference:{baseUrl:'http://127.0.0.1:11436',model:'synthetic',think:'high',contextTokens:32768,maxTokens:8192}} as Config;
  const model:Model={complete:async()=>({text:'Ready',calls:[]})};const runtime=new RuntimeControl(config,store,model,new MeteredModel(model));
  const change=runtime.control('standby',undefined,AbortSignal.timeout(2000));
  assert.equal(runtime.canDrain(),false);assert.throws(()=>runtime.assertAdmission(),/resources are changing/);
  release({runs:1,actions:0});await assert.rejects(change,/Queued or active/);assert.equal(runtime.canDrain(),true);
});

test('model telemetry is numeric-only and tracks failures and active calls',async()=>{
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  const model:Model={complete:async()=>{await pending;return {text:'SYNTHETIC_PRIVATE_ANSWER',thinking:'SYNTHETIC_PRIVATE_THOUGHT',calls:[],
    usage:{prompt_tokens:20,completion_tokens:10,generation_ms:500,unexpected:'SYNTHETIC_PRIVATE_USAGE'}};}};
  const meter=new MeteredModel(model),call=meter.complete([{role:'user',content:'SYNTHETIC_PRIVATE_PROMPT'}],[],AbortSignal.timeout(2000));
  assert.equal(meter.active,1);release();await call;assert.equal(meter.active,0);
  const result=meter.snapshot();assert.equal(result.requests,1);assert.equal((result.last as ObjectValue).outputTokensPerSecond,20);
  assert(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE'));
  const rejected=new MeteredModel({complete:async()=>{throw new OperatorError('SYNTHETIC_FAILURE','SYNTHETIC_PRIVATE_CAUSE');}});
  await assert.rejects(rejected.complete([],[],AbortSignal.timeout(2000)));
  assert.equal(rejected.active,0);assert.equal(rejected.snapshot().failures,1);
  assert.equal((rejected.snapshot().last as ObjectValue).code,'SYNTHETIC_FAILURE');assert(!JSON.stringify(rejected.snapshot()).includes('PRIVATE_CAUSE'));
});

test('model telemetry counts intentional cancellation separately and excludes it from completed-call latency',async()=>{
  for(const reason of [new OperatorError('CANCELLED','SYNTHETIC_PRIVATE_CANCEL_REASON'),new DOMException('SYNTHETIC_PRIVATE_CANCEL_REASON','AbortError')]){
    const controller=new AbortController();controller.abort(reason);
    const meter=new MeteredModel({complete:async()=>{throw reason;}});
    await assert.rejects(meter.complete([],[],controller.signal));
    const result=meter.snapshot();assert.equal(result.requests,1);assert.equal(result.cancellations,1);assert.equal(result.failures,0);
    assert.equal(result.medianModelMs,null);assert.equal((result.last as ObjectValue).cancelled,true);
    assert(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE'));
  }
});

test('model telemetry keeps a model deadline failure distinct from user cancellation',async()=>{
  const reason=new DOMException('SYNTHETIC_PRIVATE_TIMEOUT','TimeoutError'),controller=new AbortController();controller.abort(reason);
  const meter=new MeteredModel({complete:async()=>{throw reason;}});
  await assert.rejects(meter.complete([],[],controller.signal));
  const result=meter.snapshot();assert.equal(result.cancellations,0);assert.equal(result.failures,1);assert.equal(result.medianModelMs,null);
  assert(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE'));
});
