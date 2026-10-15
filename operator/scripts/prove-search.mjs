import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';
const folder=path.join(projectRoot,'logs','web-search-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const session=await fetch('http://127.0.0.1:18791/api/session'),cookie=session.headers.get('set-cookie').split(';')[0];
async function api(route,body){const response=await fetch('http://127.0.0.1:18791/api/operator'+route,{method:'POST',headers:{Cookie:cookie,Origin:'http://127.0.0.1:18791','Content-Type':'application/json'},body:JSON.stringify(body)});assert(response.ok,'HTTP '+response.status);return response.json();}
const conversation=await api('/conversations',{});
const result=await api('/tools/invoke',{conversationId:conversation.id,requestId:crypto.randomUUID(),tool:'jarvis_web',input:{action:'search',query:'OpenClaw official documentation'}});
writeFileSync(path.join(folder,'results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({ok:result.ok,error:result.error,links:result.result?.data?.links?.length??0,artifacts:folder},null,2));
if(!result.ok||!result.result?.data?.links?.length)process.exitCode=1;
