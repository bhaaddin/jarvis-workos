import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const folder=path.join(root,'logs','task-jobs-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
const report={verified:false,jobs:[],browserErrors:[],artifacts:folder};
page.on('pageerror',error=>report.browserErrors.push(error.message));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const first=Number(process.argv.find(value=>value.startsWith('--from='))?.split('=')[1]??0);let scenario=0;
async function api(route,body){const response=await context.request.fetch('http://127.0.0.1:18791/api/operator'+route,
  {method:body===undefined?'GET':'POST',headers:{Origin:'http://127.0.0.1:18791'},...(body===undefined?{}:{data:body})});
  assert(response.ok(),`API ${route}: ${response.status()} ${await response.text()}`);return response.json();}
async function job(name,message,check){
  if(scenario++<first)return;
  const created=page.waitForResponse(response=>response.url().endsWith('/api/operator/conversations')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'New',exact:true}).click();
  const conversation=await(await created).json();
  await page.waitForFunction(id=>document.querySelector('select[aria-label="Task conversation"]')?.value===id,conversation.id);
  await page.getByRole('textbox',{name:'Task or message'}).waitFor();
  await page.getByRole('textbox',{name:'Task or message'}).fill(message);
  const accepted=page.waitForResponse(response=>response.url().endsWith('/api/operator/chat')&&response.request().method()==='POST');
  const started=Date.now();await page.getByRole('button',{name:'Do this',exact:true}).click();
  const submission=await(await accepted).json();assert(submission.id,'The UI submitted a durable task');
  let run;
  for(const deadline=Date.now()+190000;Date.now()<deadline;){run=await api('/runs/'+submission.id);if(['completed','failed','cancelled'].includes(run.state))break;await pause(500);}
  const result={name,runId:submission.id,conversationId:conversation.id,state:run?.state,elapsedMs:Date.now()-started,answer:run?.result?.text??'',tools:(run?.result?.toolResults??[]).map(value=>value.tool),error:run?.error??null};
  report.jobs.push(result);writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));
  assert.equal(run?.state,'completed',JSON.stringify(result));
  const observations=(run.result.toolResults??[]).map(value=>({tool:value.tool,...value.observation}));
  await check(observations,result);
  await page.getByRole('button',{name:'Do this',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('.operator-composer textarea')?.disabled);
  console.log(JSON.stringify({job:name,passed:true,elapsedMs:result.elapsedMs,tools:result.tools}));
}
try{
  await page.goto('http://127.0.0.1:18791/#operator');
  await page.getByRole('heading',{name:'JARVIS Tasks',exact:true}).waitFor({timeout:60000});
  await page.getByRole('textbox',{name:'Task or message'}).waitFor({timeout:30000});
  report.controls=await page.getByRole('button').allTextContents();
  await page.screenshot({path:path.join(folder,'tasks-start.png'),fullPage:true});
  const health=await(await context.request.get('http://127.0.0.1:18801/health')).json();
  await job('live PC processes','List the real running node processes on this PC, including their process IDs. Use the computer tool; do not guess.',async observations=>{
    const processes=observations.flatMap(value=>value.result?.data?.processes??[]);
    assert(processes.some(value=>value.id===health.pid),'The actual operator process is present in the real OS observation');
  });
  await job('create real Excel file','Create qualification-spending.xlsx with columns Item and Amount, and rows groceries 85, transport 24, utilities 110. Use the document tool to calculate the Amount column total. Create the actual file and give its download link. This is an explicit local file-creation request.',async(observations,result)=>{
    const created=observations.find(value=>value.tool==='jarvis_document_create'&&value.status==='succeeded');
    assert(created,'The document was executed, not merely proposed');
    const artifact=created.result.data;
    const response=await context.request.get('http://127.0.0.1:18791'+artifact.url);
    assert(response.ok());const bytes=await response.body();assert.equal(bytes.subarray(0,2).toString(),'PK');
    const read=await api('/tools/invoke',{conversationId:result.conversationId,requestId:crypto.randomUUID(),tool:'jarvis_document_read',input:{root:'artifacts',path:artifact.relative}});
    assert.equal(read.ok,true,JSON.stringify(read));
    const rows=read.result.data.sheets[0].rows;
    assert(rows.some(row=>String(row[0]).toLowerCase()==='total'&&Number(row[1])===219),'The actual downloaded workbook contains the computed total');
    assert(!result.answer.includes('file://'),'The response does not invent a native filesystem download');
    assert(result.answer.includes(']('+artifact.url+')'),'The final response uses the authoritative download receipt');
    result.file={id:artifact.id,name:artifact.name,bytes:bytes.length,total:'219'};
  });
  await job('read actual project source','Use the connected Medical project to read frontend/package.json from its frontend root. Tell me its actual React dependency version and cite the source path and line.',async observations=>{
    assert(observations.some(value=>value.tool==='jarvis_projects'&&value.result?.data?.source==='medical/frontend/package.json'),'The model read the actual source file');
  });
  await job('read a public website','Read https://example.com using the isolated browser tool. Tell me the actual page title and cite the page URL.',async observations=>{
    assert(observations.some(value=>value.tool==='jarvis_web'&&String(value.result?.data?.title).includes('Example Domain')),'A real isolated browser loaded the public page');
  });
  await job('read authenticated GitHub','Use my connected GitHub account to list the names of up to five repositories I can access. Do not invent names.',async observations=>{
    assert(observations.some(value=>value.tool==='jarvis_github'&&Array.isArray(value.result?.data?.data)&&value.result.data.data.length>0),'The authenticated GitHub CLI returned actual repositories');
  });
  await job('save real reminder','Remind me in 1 minute to review the qualification invoices. Save the actual reminder now.',async(observations,result)=>{
    const saved=observations.find(value=>value.tool==='jarvis_remind_after'&&value.status==='succeeded');assert(saved,'The relative reminder was persisted using the actual server clock');result.reminderId=saved.result.data.id;
    assert.equal(saved.result.data.dueAt-saved.result.data.createdAt,60000);
  });
  await page.screenshot({path:path.join(folder,'tasks-results.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(folder,'tasks-mobile.png'),fullPage:true});
  report.mobileFits=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);assert(report.mobileFits,'The task interface fits the mobile viewport');
  assert.equal(report.browserErrors.length,0);report.verified=true;
}catch(error){report.failure=error.message;process.exitCode=1;await page.screenshot({path:path.join(folder,'failure.png'),fullPage:true}).catch(()=>{});}
finally{writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report,null,2));}
