import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';
const folder=path.join(projectRoot,'logs','browser-job-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();const report={verified:false};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,body){const response=await context.request.fetch('http://127.0.0.1:18791/api/operator'+route,{method:body===undefined?'GET':'POST',headers:{Origin:'http://127.0.0.1:18791'},...(body===undefined?{}:{data:body})});assert(response.ok(),await response.text());return response.json();}
try{
  await page.goto('http://127.0.0.1:18791/#operator');await page.getByRole('textbox',{name:'Task or message'}).waitFor({timeout:60000});
  const created=page.waitForResponse(value=>value.url().endsWith('/api/operator/conversations')&&value.request().method()==='POST');await page.getByRole('button',{name:'New',exact:true}).click();
  const conversation=await(await created).json();await page.waitForFunction(id=>document.querySelector('select[aria-label="Task conversation"]')?.value===id,conversation.id);
  const observed=await api('/tools/invoke',{conversationId:conversation.id,requestId:crypto.randomUUID(),tool:'jarvis_web',input:{action:'read',url:'https://httpbin.org/forms/post'}});
  assert.equal(observed.ok,true,JSON.stringify(observed));assert(observed.result.data.fields.some(value=>value.name==='custname'));
  const proposed=await api('/tools/invoke',{conversationId:conversation.id,requestId:crypto.randomUUID(),tool:'jarvis_browser_task',input:{url:'https://httpbin.org/forms/post',steps:[
    {kind:'fill',selector:'input[name="custname"]',value:'JARVIS synthetic qualification'},
    {kind:'fill',selector:'input[name="custemail"]',value:'qualification@example.test'},
    {kind:'click',selector:'button'}],expectedText:'JARVIS synthetic qualification',_confidence:'high'}});
  assert.equal(proposed.status,'approval_required');report.actionId=proposed.action.id;
  const card=page.locator('.operator-action').filter({hasText:'browser task'}).filter({hasText:'awaiting approval'});
  await card.getByRole('button',{name:'Approve',exact:true}).waitFor({timeout:15000});await card.getByRole('button',{name:'Approve',exact:true}).click();
  let completed;for(const deadline=Date.now()+90000;Date.now()<deadline;){completed=await api('/actions/'+report.actionId);if(['succeeded','failed','uncertain'].includes(completed.state))break;await pause(500);}
  report.state=completed.state;report.result=completed.result;assert.equal(completed.state,'succeeded',JSON.stringify(completed));
  assert.equal(completed.result.data.completedSteps.length,3);assert(completed.result.data.text.includes('JARVIS synthetic qualification'));
  assert.equal(new URL(completed.result.data.url).pathname,'/post');report.verified=true;
}catch(error){report.failure=error.message;process.exitCode=1;}
finally{await page.screenshot({path:path.join(folder,'result.png'),fullPage:true}).catch(()=>{});writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({verified:report.verified,state:report.state,failure:report.failure,artifacts:folder},null,2));}
