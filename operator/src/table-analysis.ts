import type {ObjectValue,ToolContext} from './contracts.js';
import {assert} from './errors.js';
import {object} from './store-context.js';
import {documentPath,pythonDocument} from './files.js';
import {runProcess} from './processes.js';
import {tableEngineImage} from './table-engine.js';

export async function analyzeTables(input:ObjectValue,context:ToolContext):Promise<ObjectValue>{
  assert(Array.isArray(input.files)&&input.files.length>0&&input.files.length<=4,'TABLE_INPUT_INVALID','Choose one to four CSV/XLSX inputs.');
  const sources:ObjectValue[]=[];
  for(const raw of input.files){
    const file=object(raw),location=await documentPath(context.actor,file.root,file.path);
    const loaded=await pythonDocument({operation:'table',path:location,...(file.sheet?{sheet:file.sheet}:{})},context.signal);
    sources.push({...loaded,table:file.table!});
  }
  const image=await tableEngineImage();
  const payload=JSON.stringify({sources,query:input.query??''});assert(Buffer.byteLength(payload)<=16*1024*1024,'TABLE_INPUT_LIMIT','The complete table input exceeds16MiB; no partial total was computed.');
  const container='jarvis-table-'+context.actionId;
  try{
    const response=await runProcess('docker',['run','--rm','-i','--name',container,'--network','none','--read-only','--cap-drop','ALL',
      '--security-opt','no-new-privileges:true','--pids-limit','64','--memory','512m','--memory-swap','512m','--cpus','2',
      '--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--log-driver','none',image],{input:payload,signal:context.signal,maximum:200000,timeoutMs:30000});
    const value=object(JSON.parse(response.stdout));assert(response.code===0&&value.ok===true,'TABLE_QUERY_INVALID',typeof value.error==='string'?value.error:'The bounded table query could not complete.',422);
    return {...object(value.result),sources:input.files,observedAt:new Date().toISOString()};
  }finally{await runProcess('docker',['rm','--force',container],{signal:AbortSignal.timeout(10000),timeoutMs:9000,maximum:4000}).catch(()=>{});}
}
