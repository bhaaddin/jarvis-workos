import {chromium} from 'playwright';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';
const folder=path.join(projectRoot,'logs','sandbox-job-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
const report={verified:false};const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,body){const response=await context.request.fetch('http://127.0.0.1:18791/api/operator'+route,{method:body===undefined?'GET':'POST',headers:{Origin:'http://127.0.0.1:18791'},...(body===undefined?{}:{data:body})});assert(response.ok(),await response.text());return response.json();}
try{
  await page.goto('http://127.0.0.1:18791/#operator');await page.getByRole('textbox',{name:'Task or message'}).waitFor({timeout:60000});
  const created=page.waitForResponse(value=>value.url().endsWith('/api/operator/conversations')&&value.request().method()==='POST');await page.getByRole('button',{name:'New',exact:true}).click();
  const conversation=await(await created).json();await page.waitForFunction(id=>document.querySelector('select[aria-label="Task conversation"]')?.value===id,conversation.id);
  const code="const os=await import('node:os');const fs=await import('node:fs');console.log(JSON.stringify({total:[85,24,110].reduce((a,b)=>a+b,0),uid:process.getuid(),interfaces:Object.keys(os.networkInterfaces()),hostCredentialsMounted:fs.existsSync('/home/node/.openclaw/openclaw.json'),operatorSecretPresent:Boolean(process.env.JARVIS_OPERATOR_GATEWAY_TOKEN)}));";
  const response=await api('/tools/invoke',{conversationId:conversation.id,requestId:crypto.randomUUID(),tool:'jarvis_run_code',input:{code,_confidence:'high'}});
  assert.equal(response.status,'approval_required');const id=response.action.id;report.actionId=id;
  const before=spawnSync('docker',['inspect','jarvis-task-'+id],{encoding:'utf8',timeout:10000});assert.notEqual(before.status,0,'No sandbox launches before approval');report.noExecutionBeforeApproval=true;
  const card=page.locator('.operator-action').filter({hasText:'run code'}).filter({hasText:'awaiting approval'});
  await card.getByRole('button',{name:'Approve',exact:true}).waitFor({timeout:15000});
  await page.screenshot({path:path.join(folder,'approval.png'),fullPage:true});
  await card.getByRole('button',{name:'Approve',exact:true}).click();
  let action;for(const deadline=Date.now()+60000;Date.now()<deadline;){action=await api('/actions/'+id);if(['succeeded','failed','uncertain'].includes(action.state))break;await pause(500);}
  report.state=action.state;report.result=action.result;assert.equal(action.state,'succeeded',JSON.stringify(action));
  const output=JSON.parse(action.result.data.stdout.trim());assert.equal(output.total,219);assert.equal(output.uid,65534);assert.deepEqual(output.interfaces,['lo']);assert.equal(output.hostCredentialsMounted,false);assert.equal(output.operatorSecretPresent,false);
  const after=spawnSync('docker',['inspect','jarvis-task-'+id],{encoding:'utf8',timeout:10000});assert.notEqual(after.status,0,'The action-owned container was removed');report.containerRemoved=true;
  await page.screenshot({path:path.join(folder,'completed.png'),fullPage:true});report.verified=true;
}catch(error){report.failure=error.message;process.exitCode=1;await page.screenshot({path:path.join(folder,'failure.png'),fullPage:true}).catch(()=>{});}
finally{writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({...report,artifacts:folder},null,2));}
