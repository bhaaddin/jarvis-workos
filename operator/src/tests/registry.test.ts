import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Registry} from '../registry.js';
import {Store} from '../store.js';
import type {ToolManifest, ToolContext} from '../contracts.js';
import {OperatorError} from '../errors.js';

const manifest:ToolManifest={manifestVersion:1,id:'jarvis_example',version:'1.0.0',description:'A synthetic read-only qualification skill.',handler:'handler.mjs',
  environments:['staging'],permissions:['operator.chat'],risk:'read',serviceOperations:[],sensitivity:'internal',requires:[],
  inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'},idempotent:true,supportsUndo:false,publicProjection:false,timeoutMs:5000};
const handler="export async function execute(){return {data:{marker:'SYNTHETIC_ONLY'},sensitivity:'phi'};}";

async function fixture(run:(registry:Registry,install:(name:string,definition:ToolManifest,code?:string)=>Promise<void>)=>Promise<void>):Promise<void>{
  const base=fileURLToPath(new URL('../../../runtime/operator-tests/',import.meta.url));await mkdir(base,{recursive:true});
  const folder=await mkdtemp(path.join(base,'registry-'));
  const store=new Store({path:':memory:',key:randomBytes(32).toString('hex'),environment:'staging'});await store.ready;
  const registry=new Registry({root:folder,environment:'staging',enabled:['jarvis_example','jarvis_reserved','jarvis_broken'],configurationHash:'synthetic',environmentValues:{},store});
  const install=async(name:string,definition:ToolManifest,code=handler)=>{
    const location=path.join(folder,name);await mkdir(location,{recursive:true});await writeFile(path.join(location,'manifest.json'),JSON.stringify(definition));await writeFile(path.join(location,'handler.mjs'),code);
  };
  try{await run(registry,install);}finally{await store.close();await rm(folder,{recursive:true,force:true});}
}

test('invalid installed skills are disabled at startup without taking down healthy skills',async()=>fixture(async(registry,install)=>{
  await install('working',manifest);
  await install('reserved',{...manifest,id:'jarvis_reserved',inputSchema:{type:'object',properties:{_confidence:{type:'string'}},required:['_confidence'],additionalProperties:false}});
  await install('broken',{...manifest,id:'jarvis_broken'},'not valid javascript!');
  await registry.load();
  assert.equal(registry.descriptor('jarvis_example').manifest.id,'jarvis_example');
  assert.throws(()=>registry.descriptor('jarvis_reserved'),/disabled/);
  assert.throws(()=>registry.descriptor('jarvis_broken'),/disabled/);
  assert.equal(registry.list().filter(skill=>skill.state==='invalid').length,2);
}));

test('actual result sensitivity gates channel delivery and cancellation bounds non-cooperative reads',async()=>fixture(async(registry,install)=>{
  await install('working',manifest,'export async function execute(){await new Promise(resolve=>setTimeout(resolve,40));return {data:{marker:"SYNTHETIC_ONLY"},sensitivity:"phi"};}');
  await registry.load();
  const context:ToolContext={actor:{id:'actor',tenantId:'tenant',displayName:'Synthetic',roles:[],permissions:['operator.chat'],revision:1,active:true,language:'en',timezone:'UTC'},
    environment:'staging',conversationId:'conversation',intentId:'intent',channel:'web',secure:true,confidence:'high',source:'user',signal:new AbortController().signal,
    actionId:'read',idempotencyKey:'read',assertCurrent:async()=>{},services:{invoke:async()=>{throw new Error('Not used');}}};
  await assert.rejects(registry.execute('jarvis_example',{}, {...context,secure:false}),error=>error instanceof OperatorError&&error.code==='PROTECTED_TOOL_OUTPUT');
  const result=await registry.execute('jarvis_example',{},context);assert.equal(result.sensitivity,'phi');
  await assert.rejects(registry.execute('jarvis_example',{}, {...context,signal:AbortSignal.timeout(5)}),error=>error instanceof DOMException&&error.name==='TimeoutError');
}));
