import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';

const remote=process.argv.includes('--notebook');
const access=remote?JSON.parse(readFileSync(path.join(projectRoot,'runtime/notebook-call.json'),'utf8')):null;
const base=access?.url??'http://127.0.0.1:18791';
const folder=path.join(projectRoot,'logs','connection-ui-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const report={verified:false,transport:remote?'authenticated notebook HTTPS':'local Command Center',checks:{},browserErrors:[],artifacts:folder};
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1050},...(access?{httpCredentials:{username:access.username,password:access.password}}:{})}),page=await context.newPage();
page.on('pageerror',error=>report.browserErrors.push(error.message));
async function api(route,body){const response=await context.request.fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base},...(body===undefined?{}:{data:body})});assert(response.ok(),`${route}: ${response.status()}`);return response.json();}
try{
  await page.goto(base+'/#operator');await page.getByRole('heading',{name:'JARVIS Tasks',exact:true}).waitFor({timeout:60000});
  const projects=await api('/api/projects');assert(projects.projects.some(value=>value.id==='medical'));assert(projects.projects.some(value=>value.id==='jarvis-workos'));
  const clones=projects.projects.filter(value=>value.metadata?.kind==='clone');assert(clones.length>=42);report.projects=projects.projects.length;report.clones=clones.length;report.checks.registrationVisible=true;
  const filtered=await api('/api/connections?q=ollama&limit=10');assert(filtered.projects.some(value=>value.id==='upstream-ollama'));report.checks.catalogSearch=true;
  await page.getByRole('button',{name:remote?'Projects & connections':'Projects',exact:true}).click();
  await page.getByRole('textbox',{name:'Find connected projects'}).fill('ollama');
  await page.locator('.connection-entry').filter({hasText:'upstream-ollama'}).click();
  await page.getByText('Source inspection ready',{exact:true}).waitFor({timeout:30000});
  await page.locator('.connection-runtime').filter({hasText:'local-inference'}).getByText('Probe passed',{exact:true}).waitFor({timeout:15000});
  report.checks.compatibilityPanel=true;
  const source=await api('/api/tool',{action:'read',project:'upstream-ollama',root:'source',path:'go.mod',limit:20});
  assert.equal(source.source,'upstream-ollama/source/go.mod');assert(source.content.includes('module github.com/ollama/ollama'));
  const version=source.content.match(/\bgo\s+([0-9.]+)/)?.[1];assert(version);report.source={path:source.source,sha256:source.sha256,goVersion:version};report.checks.goSourceRead=true;
  await page.screenshot({path:path.join(folder,'connections-desktop.png'),fullPage:true});
  if(!remote){
    await page.getByRole('button',{name:'JARVIS Tasks',exact:true}).click();
    await page.getByRole('textbox',{name:'Task or message'}).waitFor();
    const created=page.waitForResponse(response=>response.url().endsWith('/api/operator/conversations')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'New',exact:true}).click();const conversation=await(await created).json();
    await page.waitForFunction(id=>document.querySelector('select[aria-label="Task conversation"]')?.value===id,conversation.id);
    await page.getByRole('textbox',{name:'Task or message'}).fill('Find the connected Ollama source clone. Read its actual go.mod and report its module name and Go version with source lines. Check its declared runtime compatibility too. Distinguish reading the checkout from the deployed model service; do not install, start or edit anything.');
    const accepted=page.waitForResponse(response=>response.url().endsWith('/api/operator/chat')&&response.request().method()==='POST');
    const began=Date.now();await page.getByRole('button',{name:'Do this',exact:true}).click();let run=await(await accepted).json();const id=run.id;
    for(const end=Date.now()+310000;Date.now()<end&&!['completed','failed','cancelled'].includes(run.state);){await new Promise(resolve=>setTimeout(resolve,500));run=await api('/api/operator/runs/'+id);}
    report.agent={state:run.state,elapsedMs:Date.now()-began,answer:run.result?.text??'',error:run.error??null};
    assert.equal(run.state,'completed');assert.equal(run.result.completion,'complete');
    assert(run.result.toolResults.some(value=>value.tool==='jarvis_projects'&&value.observation.result?.data?.source===source.source));
    assert(run.result.toolResults.some(value=>value.tool==='jarvis_projects'&&value.observation.result?.data?.project==='upstream-ollama'&&Array.isArray(value.observation.result.data.runtimes)));
    assert(run.result.text.includes(version)&&run.result.text.includes('github.com/ollama/ollama'));report.checks.modelSelectedCloneTools=true;
    await page.screenshot({path:path.join(folder,'agent-source-check.png'),fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  report.mobileFits=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);assert(report.mobileFits);
  await page.screenshot({path:path.join(folder,'connections-mobile.png'),fullPage:true});assert.equal(report.browserErrors.length,0);report.verified=true;
}catch(error){report.failure=error.message;process.exitCode=1;await page.screenshot({path:path.join(folder,'failure.png'),fullPage:true}).catch(()=>{});}
finally{writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report,null,2));}
