import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';

const access=JSON.parse(readFileSync(path.join(projectRoot,'runtime/notebook-call.json'),'utf8'));
const folder=path.join(projectRoot,'logs','social-access-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chromium'}),context=await browser.newContext({viewport:{width:1365,height:1000},httpCredentials:{username:access.username,password:access.password}});
const page=await context.newPage(),report={verified:false,transport:'authenticated notebook HTTPS',liveProfileSearchVerified:false,errors:[]};
page.on('pageerror',error=>report.errors.push(error.message));
try{
  await page.goto(access.url+'/#operator');await page.getByRole('button',{name:'Social contacts',exact:true}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'Social contacts',exact:true}).click();await page.getByRole('heading',{name:'Who are you looking for?',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Location',{exact:true}).inputValue(),'Prague');
  const response=await context.request.get(access.url+'/api/operator/social/connections');assert(response.ok());const value=await response.json();
  const keys=[];const visit=value=>{if(value&&typeof value==='object'){for(const[key,item]of Object.entries(value)){keys.push(key);visit(item);}}};visit(value);
  assert(!keys.some(key=>['storageState','cookies','password'].includes(key)));
  report.connections=value.connections.map(item=>({platform:item.platform,state:item.state,hasSession:item.hasSession}));
  const contacts=await context.request.get(access.url+'/api/operator/social/contacts');assert(contacts.ok());
  report.savedContactCount=(await contacts.json()).contacts.length;
  await page.screenshot({path:path.join(folder,'social-live-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});report.mobileFits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);assert(report.mobileFits);
  await page.screenshot({path:path.join(folder,'social-live-mobile.png'),fullPage:true});assert.equal(report.errors.length,0);report.verified=true;
}catch(error){report.failure=error.message;process.exitCode=1;}
finally{writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({...report,artifacts:folder},null,2));}
