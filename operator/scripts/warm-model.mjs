import assert from 'node:assert/strict';
import path from 'node:path';
import {loadConfig,projectRoot} from '../dist/config.js';
import {OpenClawModel} from '../dist/model.js';
import {publicError} from '../dist/errors.js';
import {configuredModel} from '../dist/model-factory.js';

process.loadEnvFile(path.join(projectRoot,'.env'));
try{
  const config=loadConfig(),started=performance.now();
  const model=process.argv[2]?new OpenClawModel(config.gatewayUrl,config.gatewayToken,180000,()=>{},process.argv[2]):configuredModel(config);
  // Exercise the same private transport/provider options as real tasks. Model
  // loading through /api/generate alone did not warm the first Gateway request.
  const result=await model.complete([{role:'user',content:'Startup readiness check. Reply only Ready.'}],[],AbortSignal.timeout(180000),undefined,'none');
  assert(result.text.trim()&&result.calls.length===0,'The selected model did not complete its readiness check');
  console.log(JSON.stringify({gatewayWarm:true,override:process.argv[2]??null,elapsedMs:Math.round(performance.now()-started),usage:result.usage??null}));
}catch(error){console.log(JSON.stringify({gatewayWarm:false,error:publicError(error)}));process.exitCode=1;}
