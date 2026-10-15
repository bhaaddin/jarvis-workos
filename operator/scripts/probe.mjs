import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createOperator} from '../dist/server.js';
import {loadConfig,projectRoot} from '../dist/config.js';
import {publicError} from '../dist/errors.js';
import {OpenClawModel} from '../dist/model.js';
import {configuredModel} from '../dist/model-factory.js';

process.loadEnvFile(path.join(projectRoot,'.env'));
const id=randomUUID(),marker='SYNTHETIC_OPERATOR_'+id;
const folder=path.join(projectRoot,'logs','operator-live-'+new Date().toISOString().replace(/[:.]/g,'-'));
const privateFolder=path.join(projectRoot,'runtime','operator-probes',id);
mkdirSync(folder,{recursive:true});mkdirSync(privateFolder,{recursive:true});
const config=loadConfig();
assert.equal(config.environment,'staging','The live proof uses staging only');
config.databasePath=path.join(privateFolder,'proof.sqlite');
const result={verified:false,environment:'staging',transport:config.inference?'actual loopback HTTP + direct Ollama NDJSON':'actual loopback HTTP + dedicated OpenClaw SSE',model:config.inference?.model??'configured Gateway model',
  syntheticMarker:marker,checks:{},database:config.databasePath};
let runtime,cookie='',csrf='';
async function start() {
  const model=config.inference?configuredModel(config):new OpenClawModel(config.gatewayUrl,config.gatewayToken,180000,error=>{
    // This probe sends synthetic requests only. Never record credentials, even
    // if a provider accidentally echoes a configured secret in its error text.
    let safe=JSON.stringify(error);
    for(const secret of [config.gatewayToken,config.dataKey,config.callbackKey,config.adminPassword])if(secret)safe=safe.replaceAll(secret,'[redacted]');
    (result.protocolErrors??=[]).push(safe.slice(0,8192));
  });
  runtime=await createOperator(config,model,{background:false});
  config.origin=await runtime.app.listen({host:'127.0.0.1',port:0});
  const response=await fetch(config.origin+'/api/auth/login',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json'},
    body:JSON.stringify({login:'matko',password:config.adminPassword})});
  assert.equal(response.status,200,'Authenticated loopback login');
  cookie=response.headers.get('set-cookie').split(';')[0];csrf=(await response.json()).csrf;
}
async function api(url,body,method=body===undefined?'GET':'POST') {
  const response=await fetch(config.origin+url,{method,headers:{Cookie:cookie,Origin:config.origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(200000)});
  const value=await response.json();assert(response.ok,`API ${url}: ${value.error?.code??response.status}`);return value;
}
try {
  const logging=spawnSync('docker',['inspect','--format','{{.HostConfig.LogConfig.Type}}','jarvis-operator-brain-1'],{encoding:'utf8',timeout:10000});
  assert.equal(logging.status,0,'Inspect dedicated Gateway logging policy');
  result.nativeConsoleLoggingDriver=logging.stdout.trim();
  assert.equal(result.nativeConsoleLoggingDriver,'none','Native assistant console output must not be persisted by Docker');
  result.checks.nativeConsolePersistenceDisabled=true;
  if(config.inference){
    const modelLogging=spawnSync('docker',['inspect','--format','{{.HostConfig.LogConfig.Type}}','jarvis-operator-model-1'],{encoding:'utf8',timeout:10000});
    assert.equal(modelLogging.status,0);assert.equal(modelLogging.stdout.trim(),'none');result.modelLoggingDriver='none';
  }
  await start();
  result.nativeToolStatus={};
  for(const tool of ['exec','read','write','message','sessions_list','session_status','memory_search']) {
    const response=await fetch(new URL('/tools/invoke',config.gatewayUrl),{method:'POST',
      headers:{Authorization:'Bearer '+config.gatewayToken,'Content-Type':'application/json'},
      body:JSON.stringify({tool,args:{},sessionKey:'agent:main:dashboard:incognito-jarvis-'+randomUUID()}),signal:AbortSignal.timeout(10000)});
    result.nativeToolStatus[tool]=response.status;await response.body?.cancel();
    assert.equal(response.status,404,'Native tool must be unavailable: '+tool);
  }
  result.checks.nativeAuthorityNegativeProbes=true;
  const conversation=await api('/api/conversations',{}),requestId=randomUUID(),started=Date.now();
  await api('/api/chat',{conversationId:conversation.id,requestId,
    message:`Qualification marker ${marker}. Call jarvis_clock to read the current local date. Reply in English with the observed date YYYY-MM-DD and its timezone in one short sentence. Do not include a time of day.`});
  await runtime.runs.drain();
  const run=await api('/api/runs/'+requestId);
  result.agent={state:run.state,error:run.error??null,elapsedMs:Date.now()-started};
  const history=await api('/api/conversations/'+conversation.id+'/messages');
  result.protocolFrames=history.messages.map(value=>({role:value.message?.role,tools:value.message?.tool_calls?.map(call=>call.function.name)??[]}));
  assert.equal(run.state,'completed',`Agent loop: ${run.error?.code??run.state}`);
  const clock=run.result.toolResults.find(value=>value.tool==='jarvis_clock'&&value.observation.ok);
  assert(clock,'The model selected the real registered clock tool');
  const date=clock.observation.result.data.localDate;
  assert(run.result.text.includes(date),'Final response contains the observed date');
  assert(run.result.text.includes(clock.observation.result.data.timezone),'Final response contains the observed timezone');
  result.agent.answer=run.result.text.replaceAll(marker,'[synthetic marker]');
  // Keep the actual wording for review. A noun such as "date" is not a valid
  // general-purpose language detector and must not reject valid English prose.
  result.agent.tools=run.result.toolResults.map(value=>value.tool);
  result.checks.structuredAgentLoop=true;
  const saved=await api('/api/tools/invoke',{conversationId:conversation.id,requestId:randomUUID(),tool:'jarvis_memory_remember',
    input:{kind:'preference',key:'qualification memory',value:marker,_confidence:'high'}});
  assert.equal(saved.status,'succeeded','Durable memory effect');
  await runtime.app.close();runtime=undefined;
  assert(!readFileSync(config.databasePath).includes(Buffer.from(marker)),'Private state is encrypted on disk');
  result.checks.encryptedNodeState=true;
  await start();
  const memory=await api('/api/memory/search',{query:'qualification memory'});
  assert(memory.memories.some(value=>value.record.value===marker),'Memory survives a Node service restart');
  result.checks.memorySurvivesRestart=true;
  // Unlike the date-only turn, this deliberately puts the synthetic private
  // marker in model output, exercising the previously missed console path.
  const echoed=await configuredModel(config).complete(
    [{role:'user',content:'Reply with exactly this synthetic qualification string and nothing else: '+marker}],[],AbortSignal.timeout(180000),undefined,'none');
  assert(echoed.text.includes(marker),'Private-output privacy fixture was actually generated');
  result.checks.privateOutputExercised=true;
  const scanCode="const f=require('fs'),p=require('path'),needle=Buffer.from(process.argv[1]),found=[];function walk(d){for(const e of f.readdirSync(d,{withFileTypes:true})){const n=p.join(d,e.name);if(e.isDirectory())walk(n);else if(e.isFile()&&f.statSync(n).size<50000000&&f.readFileSync(n).includes(needle))found.push(n)}};for(const d of ['/home/node/.openclaw','/tmp/openclaw'])if(f.existsSync(d))walk(d);console.log(JSON.stringify(found));";
  const scan=spawnSync('docker',['exec','jarvis-operator-brain-1','node','-e',scanCode,marker],{encoding:'utf8',timeout:30000});
  assert.equal(scan.status,0,'Native disk privacy scan completed');
  result.nativeRawMarkerPaths=JSON.parse(scan.stdout);
  assert.equal(result.nativeRawMarkerPaths.length,0,'No raw marker in scanned native disk state');
  result.checks.incognitoNativePrivacy=true;
  if(config.inference){
    const hits=[],root='D:/AI/OllamaModels';
    const walk=folder=>{for(const entry of readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile()&&statSync(file).size<50000000&&readFileSync(file).includes(Buffer.from(marker)))hits.push(file);}};
    walk(root);assert.equal(hits.length,0,'No synthetic marker in the active model persistent store');
    result.activeModelMarkerPaths=hits;result.checks.activeModelPersistenceScan=true;
  }
  result.verified=true;
}catch(error){result.failure=publicError(error);result.assertion=error instanceof assert.AssertionError?error.message:null;process.exitCode=1;}
finally {
  if(runtime)await runtime.app.close();
  writeFileSync(path.join(folder,'results.json'),JSON.stringify(result,null,2));
  const {syntheticMarker,...summary}=result;
  console.log(JSON.stringify(summary,null,2));console.log('Live proof artifacts: '+folder);
}
