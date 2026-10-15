import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';

// Numeric-only profiling: never print stored messages, tool inputs or credentials.
const session=await fetch('http://127.0.0.1:18791/api/session');
if(!session.ok)throw new Error('Project Hub is unavailable');
const cookie=session.headers.get('set-cookie')?.split(';')[0];
async function read(route){
  const response=await fetch('http://127.0.0.1:18791/api/operator'+route,{headers:{Cookie:cookie}});
  if(!response.ok)throw new Error('Runtime profiling request failed: '+response.status);
  return response.json();
}
const runtime=await read('/runtime');
const report={at:new Date().toISOString(),selected:runtime.selected,resources:runtime.resources,
  model:runtime.model,inference:runtime.inference,runs:[]};
for(const id of process.argv.slice(2)){
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Use a known synthetic run ID');
  const run=await read('/runs/'+id);
  report.runs.push({id,state:run.state,elapsedMs:run.result?.elapsedMs,performance:run.result?.performance});
}
const folder=path.join(projectRoot,'logs','voice-profile-'+new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(folder,{recursive:true});
writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,artifacts:folder},null,2));
