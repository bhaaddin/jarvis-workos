import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';
const access=JSON.parse(readFileSync(path.join(projectRoot,'runtime/notebook-call.json'),'utf8'));
const folder=path.join(projectRoot,'logs','notebook-tasks-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({httpCredentials:{username:access.username,password:access.password},viewport:{width:1280,height:950}}),page=await context.newPage();
const report={verified:false,checks:{},jobs:[]},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,body){const response=await context.request.fetch(access.url+'/api/operator'+route,{method:body===undefined?'GET':'POST',headers:{Origin:access.url},...(body===undefined?{}:{data:body})});assert(response.ok(),await response.text());return response.json();}
async function submit(message){
  const created=page.waitForResponse(response=>response.url().endsWith('/api/operator/conversations')&&response.request().method()==='POST');await page.getByRole('button',{name:'New',exact:true}).click();const conversation=await(await created).json();
  await page.waitForFunction(id=>document.querySelector('select[aria-label="Task conversation"]')?.value===id,conversation.id);
  await page.getByRole('textbox',{name:'Task or message'}).fill(message);
  const accepted=page.waitForResponse(response=>response.url().endsWith('/api/operator/chat')&&response.request().method()==='POST');await page.getByRole('button',{name:'Do this',exact:true}).click();
  const request=await(await accepted).json();let run;
  for(const end=Date.now()+180000;Date.now()<end;){run=await api('/runs/'+request.id);if(['completed','failed','cancelled'].includes(run.state))break;await pause(500);}
  assert.equal(run.state,'completed',JSON.stringify(run.error));report.jobs.push({requestId:request.id,answer:run.result.text,tools:run.result.toolResults.map(value=>value.tool)});
  await page.waitForFunction(()=>!document.querySelector('.operator-composer textarea')?.disabled);
  return {run,conversationId:conversation.id};
}
try{
  const anonymous=await fetch(access.url+'/api/operator/conversations');assert.equal(anonymous.status,401);report.checks.unauthenticatedDenied=true;
  await page.goto(access.url+'/#operator');await page.getByRole('heading',{name:'JARVIS Tasks',exact:true}).waitFor({timeout:60000});await page.getByRole('textbox',{name:'Task or message'}).waitFor({timeout:30000});
  assert(await page.evaluate(()=>window.isSecureContext&&document.querySelector('meta[name="jarvis-operator-enabled"]')?.content==='true'));report.checks.secureTaskInterface=true;
  const denied=await context.request.post(access.url+'/api/operator/admin/shutdown',{headers:{Origin:access.url},data:{}});assert.equal(denied.status(),403);report.checks.managementDenied=true;
  const pdf=await submit('Create notebook-work-proof.pdf, a one-page PDF titled JARVIS notebook proof, containing the exact sentence: The authenticated task interface created and downloaded this document. Create the actual file and provide its real download.');
  const created=pdf.run.result.toolResults.find(value=>value.tool==='jarvis_document_create'&&value.observation.status==='succeeded');assert(created,'PDF actually created');const artifact=created.observation.result.data;
  assert(!pdf.run.result.text.includes('No response from OpenClaw'),'A completed file has a usable verified receipt');
  assert(artifact.verifiedPreview.pages.map(value=>value.text).join(' ').replace(/\s+/g,' ').includes('The authenticated task interface created and downloaded this document.'),'The actual PDF contains the requested sentence');
  const response=await context.request.get(access.url+artifact.url);assert(response.ok());assert.equal((await response.body()).subarray(0,4).toString(),'%PDF');
  assert(response.headers()['content-disposition'].includes('notebook-work-proof.pdf'));assert(!pdf.run.result.text.includes('artifacts.openclaw.ai'));report.checks.actualPdfDownloaded=true;
  const reminder=await submit('Remind me in 1 minute to finish the JARVIS qualification check. Use the relative reminder tool and save it now.');
  const saved=reminder.run.result.toolResults.find(value=>value.tool==='jarvis_remind_after'&&value.observation.status==='succeeded');assert(saved,'Relative reminder actually saved');const task=saved.observation.result.data;
  assert.equal(task.dueAt-task.createdAt,60000);report.checks.exactRelativeDeadline=true;report.reminderDueLocal=task.dueAtLocal+' '+task.timezone;
  let due=false;for(const end=task.dueAt+10000;Date.now()<end;){const notes=await api('/notifications');if(notes.notifications.some(value=>value.kind==='task.due'&&value.data.taskId===task.id)){due=true;break;}await pause(1000);}
  assert(due,'The real running scheduler emitted the reminder notification after its deadline');report.checks.actualReminderFired=true;
  await page.screenshot({path:path.join(folder,'notebook-task-results.png'),fullPage:true});
  await api('/tools/invoke',{conversationId:reminder.conversationId,requestId:crypto.randomUUID(),tool:'jarvis_task_save',input:{action:'complete',id:task.id,_confidence:'high'}});
  report.verified=true;
}catch(error){report.failure=error.message;process.exitCode=1;await page.screenshot({path:path.join(folder,'failure.png'),fullPage:true}).catch(()=>{});}
finally{writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({...report,artifacts:folder},null,2));}
