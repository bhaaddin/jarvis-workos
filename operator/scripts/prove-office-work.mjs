import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';

const folder=path.join(projectRoot,'logs','office-ui-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const report={verified:false,synthetic:true,browserErrors:[],progressObserved:[],artifacts:folder};
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
page.on('pageerror',error=>report.browserErrors.push(error.message));
async function api(route,body){const response=await context.request.fetch('http://127.0.0.1:18791/api/operator'+route,{method:body===undefined?'GET':'POST',headers:{Origin:'http://127.0.0.1:18791'},...(body===undefined?{}:{data:body})});assert(response.ok());return response.json();}
try{
  await page.goto('http://127.0.0.1:18791/#operator');await page.getByRole('textbox',{name:'Task or message'}).waitFor({timeout:60000});
  const newConversation=page.waitForResponse(response=>response.url().endsWith('/api/operator/conversations')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'New',exact:true}).click();const conversation=await(await newConversation).json();
  await page.waitForFunction(id=>document.querySelector('select[aria-label="Task conversation"]')?.value===id,conversation.id);
  const uploaded=page.waitForResponse(response=>response.url().endsWith('/api/operator/files/upload'));
  await page.locator('.operator-upload input').setInputFiles({name:'qualification-regional-sales.csv',mimeType:'text/csv',buffer:Buffer.from('Region,Currency,Status,Gross,VAT\nPrague,CZK,paid,1210,210\nPrague,CZK,paid,242,42\nBrno,CZK,paid,119,19\nBrno,CZK,cancelled,999,0\nPrague,CZK,refunded,121,21\nOlomouc,CZK,paid,605,105\n')});
  const file=await(await uploaded).json();assert(file.path);
  await page.getByRole('textbox',{name:'Task or message'}).fill(`Analyze the actual uploaded file inbox/${file.path}. Count only paid sales and calculate net revenue as Gross minus VAT. Create regional-sales.xlsx with exactly one row per region (Region, Paid sales, Net revenue CZK), and a short regional-report.pdf with the total net revenue and exclusions. Do not add a total row to the spreadsheet; put the overall total only in the PDF. Calculate the table programmatically, and export the verified query result to Excel without transcribing its rows. Create both files now and give their real download links.`);
  const accepted=page.waitForResponse(response=>response.url().endsWith('/api/operator/chat')&&response.request().method()==='POST');
  const began=performance.now();await page.getByRole('button',{name:'Do this',exact:true}).click();const submission=await(await accepted).json();
  let run;const progress=new Set();
  for(const end=Date.now()+320000;Date.now()<end;){
    run=await api('/runs/'+submission.id);for(const text of await page.locator('.operator-thinking li').allTextContents())progress.add(text);
    if(['completed','failed','cancelled'].includes(run.state))break;await new Promise(resolve=>setTimeout(resolve,700));
  }
  report.elapsedMs=Math.round(performance.now()-began);report.state=run?.state;report.error=run?.error??null;report.answer=run?.result?.text??'';report.progressObserved=[...progress];
  assert.equal(run?.state,'completed');assert.equal(run.result.completion,'complete');
  const observations=run.result.toolResults;assert(observations.some(item=>item.tool==='jarvis_table_query'&&item.observation.ok));
  const created=observations.filter(item=>item.tool==='jarvis_document_create'&&item.observation.status==='succeeded').map(item=>item.observation.result.data);
  const sheet=created.find(item=>item.format==='xlsx'),pdf=created.find(item=>item.format==='pdf');assert(sheet&&pdf);
  const exportAction=await api('/actions/'+sheet.id);assert(exportAction.input.tableObservationId,'The spreadsheet must reference checked query data rather than model-transcribed rows');
  const read=await api('/tools/invoke',{conversationId:conversation.id,requestId:crypto.randomUUID(),tool:'jarvis_document_read',input:{root:'artifacts',path:sheet.relative,limit:30}});
  assert.equal(read.ok,true);const rows=read.result.data.sheets[0].rows;assert.equal(rows.length,4,'Header and three region rows, without mixed or duplicate totals');
  for(const [region,count,total]of [['Prague',2,1200],['Brno',1,100],['Olomouc',1,500]]){
    const row=rows.find(value=>value[0]===region);assert(row&&row[1]===count&&row[2]===total,`Actual numeric Excel cells for ${region}`);
  }
  const memo=await api('/tools/invoke',{conversationId:conversation.id,requestId:crypto.randomUUID(),tool:'jarvis_document_read',input:{root:'artifacts',path:pdf.relative}});
  assert.equal(memo.ok,true);assert(JSON.stringify(memo).replace(/[\s,]/g,'').includes('1800'));
  report.files=[];for(const artifact of [sheet,pdf]){const response=await context.request.get('http://127.0.0.1:18791'+artifact.url);assert(response.ok());const bytes=await response.body();assert(bytes.length>100);assert(report.answer.includes(artifact.url));report.files.push({name:artifact.name,sha256:artifact.sha256,downloadedBytes:bytes.length});}
  assert(report.progressObserved.length>0,'The actual UI showed work progress');assert.equal(report.browserErrors.length,0);
  await page.screenshot({path:path.join(folder,'office-result.png'),fullPage:true});report.verified=true;
}catch(error){report.failure=error.message;process.exitCode=1;await page.screenshot({path:path.join(folder,'failure.png'),fullPage:true}).catch(()=>{});}
finally{writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report,null,2));}
