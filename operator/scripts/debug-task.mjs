import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createOperator} from '../dist/server.js';
import {loadConfig,projectRoot} from '../dist/config.js';
import {OpenClawModel} from '../dist/model.js';
import {publicError} from '../dist/errors.js';
process.loadEnvFile(path.join(projectRoot,'.env'));
const folder=path.join(projectRoot,'logs','task-debug-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const config=loadConfig(),id=randomUUID();config.databasePath=path.join(projectRoot,'runtime/operator-probes',id,'proof.sqlite');
const result={success:false,protocolErrors:[]};
const model=new OpenClawModel(config.gatewayUrl,config.gatewayToken,180000,error=>{
  result.protocolErrors.push(JSON.stringify(error).replaceAll(config.gatewayToken,'[redacted]').slice(0,8192));
});
const runtime=await createOperator(config,model,{background:false});
try{
  const actor=await runtime.store.call('actor.get',{tenantId:config.tenantId,actorId:'owner'}),conversationId=randomUUID();
  await runtime.store.call('conversation.create',{tenantId:actor.tenantId,actorId:actor.id,id:conversationId,now:Date.now()});
  try{result.run=await runtime.core.run('List the real running node processes on this PC, including their process IDs. Use the computer tool; do not guess.',
    {actor,environment:config.environment,conversationId,intentId:randomUUID(),channel:'web',secure:true,confidence:'unknown',source:'user',signal:AbortSignal.timeout(180000)});result.success=true;}
  catch(error){result.error=publicError(error);}
  const history=await runtime.store.call('message.history',{tenantId:actor.tenantId,actorId:actor.id,conversationId,now:Date.now(),secure:true,limit:60});
  result.frames=history.map(value=>value.message);
  result.skills=runtime.registry.list().map(value=>({id:value.id,state:value.state,reason:value.reason??null}));
}finally{await runtime.app.close();writeFileSync(path.join(folder,'results.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify({success:result.success,error:result.error,protocolErrors:result.protocolErrors,frames:result.frames?.map(value=>({role:value.role,tools:value.tool_calls?.map(call=>call.function.name),content:value.role==='tool'?value.content?.slice(0,1000):undefined})),artifacts:folder},null,2));
if(!result.success)process.exitCode=1;
