import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';

const folder=path.join(projectRoot,'logs','runtime-ui-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const report={verified:false,synthetic:true,checks:{},browserErrors:[],artifacts:folder};
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
page.on('pageerror',error=>report.browserErrors.push(error.message));
const api=async route=>{const response=await context.request.get('http://127.0.0.1:18791/api/operator'+route);assert(response.ok());return response.json();};
try{
  assert.equal((await context.request.get('http://127.0.0.1:18801/api/runtime')).status(),401);report.checks.diagnosticsRequireAuthentication=true;
  await page.goto('http://127.0.0.1:18791/#operator');await page.getByRole('textbox',{name:'Task or message'}).waitFor({timeout:60000});
  await page.getByText('Runtime & resources',{exact:true}).click();
  await page.getByText('Model loaded',{exact:true}).waitFor({timeout:20000});report.checks.runtimePanel=true;
  const blocked=await context.request.post('http://127.0.0.1:18791/api/operator/admin/runtime',{headers:{Origin:'http://127.0.0.1:18791'},data:{operation:'standby'}});
  assert.equal(blocked.status(),403);report.checks.managementNotProxied=true;
  const created=page.waitForResponse(response=>response.url().endsWith('/api/operator/conversations')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'New',exact:true}).click();const conversation=await(await created).json();
  await page.waitForFunction(id=>document.querySelector('select[aria-label="Task conversation"]')?.value===id,conversation.id);
  const marker='SYNTHETIC_RUNTIME_'+crypto.randomUUID();
  await page.getByRole('textbox',{name:'Task or message'}).fill(`Qualification marker ${marker}. Use the calculator to compute23*47. Return only its verified numeric result.`);
  const accepted=page.waitForResponse(response=>response.url().endsWith('/api/operator/chat')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Do this',exact:true}).click();const submission=await(await accepted).json();
  let run=submission;
  for(const end=Date.now()+310000;Date.now()<end&&!['completed','failed','cancelled'].includes(run.state);){await new Promise(resolve=>setTimeout(resolve,500));run=await api('/runs/'+submission.id);}
  assert.equal(run.state,'completed');assert(run.result.text.includes('1081'));
  assert(run.result.toolResults.some(value=>value.tool==='jarvis_calculate'&&value.observation.ok));
  const timing=run.result.performance;assert(timing.modelCalls>=1&&timing.modelMs>0&&timing.inputTokens>0&&timing.outputTokens>0);
  assert(timing.loadMs<5000,'A warm model must not be reloaded by the resource-profile refresh');
  report.task={elapsedMs:run.result.elapsedMs,performance:timing,answer:run.result.text};report.checks.taskTiming=true;
  const runtime=await api('/runtime');assert(runtime.inference.requests>=1);assert(!JSON.stringify(runtime).includes(marker));
  report.runtime=runtime;report.checks.contentFreeTelemetry=true;
  await page.getByText('Runtime & resources',{exact:true}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('output tokens/s'),null,{timeout:15000});
  await page.screenshot({path:path.join(folder,'runtime-panel.png'),fullPage:true});
  assert.equal(report.browserErrors.length,0);report.verified=true;
}catch(error){report.failure=error.message;process.exitCode=1;await page.screenshot({path:path.join(folder,'failure.png'),fullPage:true}).catch(()=>{});}
finally{writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report,null,2));}
