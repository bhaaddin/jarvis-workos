import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import path from 'node:path';
import {createOperator} from '../dist/server.js';
import {loadConfig,projectRoot} from '../dist/config.js';
import {parseProfile} from '../dist/social-model.js';
import {configuredModel} from '../dist/model-factory.js';

process.loadEnvFile(path.join(projectRoot,'.env'));
const folder=path.join(projectRoot,'logs','social-workspace-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const config=loadConfig();config.environment='staging';config.tenantId='social-ui-'+randomUUID();config.databasePath=path.join(projectRoot,'runtime/operator-probes',randomUUID(),'social.sqlite');
config.adminPassword=randomBytes(32).toString('hex');config.dataKey=randomBytes(32).toString('hex');config.callbackKey=randomBytes(32).toString('hex');
config.enabledTools=['jarvis_social_research','jarvis_social_contacts','jarvis_social_contact_update'];config.configurationHash='synthetic-social-ui-v1';
let nativePhase=false;const nativeModel=configuredModel(config);
const steps=[],model={complete:async(...args)=>{if(nativePhase)return nativeModel.complete(...args);const next=steps.shift();assert(next,'Unexpected fixture model step');return typeof next==='function'?await next():next;}};
const runtime=await createOperator(config,model);await runtime.app.ready();
const brief={query:'fitness creators',location:'Prague',languages:'Czech, English',purpose:'Paid collaboration',platforms:['instagram','tiktok'],limit:20};
const profiles=Array.from({length:20},(_,index)=>{
  const suffix=String(index+1).padStart(2,'0'),handle='synthetic_prague_'+suffix,platform=index<10?'instagram':'tiktok';
  const url=platform==='instagram'?'https://www.instagram.com/'+handle+'/':'https://www.tiktok.com/@'+handle;
  return parseProfile(url,{url,title:'Synthetic Prague coach '+suffix,description:'',bio:'Fitness coach in Prague. Czech and English. Business: coach'+suffix+'@example.test',body:'Public synthetic profile',followers:'12.4K',links:[]});
});
runtime.services.social.research=async()=>({brief,profiles,issues:[],requested:20,observed:20,status:'completed',observedAt:new Date().toISOString(),fixture:true});
for(const platform of brief.platforms)await runtime.store.call('connection.save',{tenantId:config.tenantId,actorId:'owner',id:'social:'+platform,now:Date.now(),value:{storageState:{cookies:[],origins:[]},savedAt:new Date().toISOString(),label:'Synthetic browser fixture'}});
const actor=await runtime.store.call('actor.get',{tenantId:config.tenantId,actorId:'owner'});
const login=await runtime.app.inject({method:'POST',url:'/api/auth/login',headers:{origin:config.origin},payload:{login:'matko',password:config.adminPassword}});
const headers={cookie:String(login.headers['set-cookie']).split(';')[0],origin:config.origin,'x-csrf-token':login.json().csrf};
const gateway=createServer(async(request,response)=>{
  try{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);const data=Buffer.concat(chunks),route=request.url??'/';
    if(route.startsWith('/api/operator/')){
      const result=await runtime.app.inject({method:request.method,url:'/api'+route.slice('/api/operator'.length),headers,...(data.length?{payload:JSON.parse(data.toString())}:{})});
      const outgoing={};for(const[key,value]of Object.entries(result.headers))if(value!==undefined&&!['connection','transfer-encoding','content-length','set-cookie'].includes(key))outgoing[key]=value;
      response.writeHead(result.statusCode,{...outgoing,'Content-Length':result.rawPayload.length});response.end(result.rawPayload);return;
    }
    const upstream=await fetch('http://127.0.0.1:18791'+route,{method:request.method,headers:{...(request.headers.cookie?{Cookie:request.headers.cookie}:{}),Origin:'http://127.0.0.1:18791',...(request.headers['content-type']?{'Content-Type':request.headers['content-type']}:{})},...(data.length?{body:data}:{})});
    const body=Buffer.from(await upstream.arrayBuffer()),outgoing={};
    for(const[key,value]of upstream.headers)if(!['connection','transfer-encoding','content-encoding','content-length','set-cookie'].includes(key))outgoing[key]=value;
    const cookies=upstream.headers.getSetCookie();if(cookies.length)outgoing['set-cookie']=cookies;
    response.writeHead(upstream.status,{...outgoing,'Content-Length':body.length});response.end(body);
  }catch{response.writeHead(500,{'Content-Type':'application/json'});response.end('{"error":"Synthetic test gateway failed"}');}
});
await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));const testUrl='http://127.0.0.1:'+gateway.address().port;
const browser=await chromium.launch({headless:true,channel:'chromium'}),context=await browser.newContext({viewport:{width:1365,height:1000},acceptDownloads:true}),page=await context.newPage();
const report={verified:false,mode:'isolated synthetic accounts and platform data; real UI/API/store/tools',livePlatformDiscovery:false,checks:{},errors:[]};
const call=(name,args)=>({text:'',calls:[{id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
page.on('pageerror',error=>report.errors.push(error.message));
await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.syntheticCopiedDraft=text;}}});});
try{
  await page.goto(testUrl+'/#operator');await page.getByRole('textbox',{name:'Task or message'}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'Social contacts',exact:true}).click();
  await page.getByRole('heading',{name:'Who are you looking for?',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Niche / keywords').inputValue(),'fitness creators');
  assert.equal(await page.getByLabel('Location',{exact:true}).inputValue(),'Prague');
  steps.push(call('jarvis_social_research',{...brief,_confidence:'high'}),{text:'Saved 20 synthetic candidate profiles for review.',calls:[]});
  await page.getByRole('button',{name:'Find and save profiles',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.social-contact').length===20);
  report.checks.searchAndPersist=true;
  const saved=(await runtime.services.social.contacts(actor)).contacts,chosen=saved[0];
  const card=page.locator('.social-contact').filter({has:page.locator('a[href="'+chosen.url+'"]')});
  const draft='Hi @'+chosen.handle+', your bio mentions fitness coaching in Prague. Would you be open to discussing a paid collaboration?';
  steps.push(call('jarvis_social_contacts',{action:'list',ids:[chosen.id]}),call('jarvis_social_contact_update',{edits:[{id:chosen.id,expectedRevision:chosen.revision,
    matchReason:'The profile explicitly identifies fitness coaching in Prague.',evidenceQuote:'Fitness coach in Prague.',draft,draftPurpose:'Paid collaboration'}],_confidence:'high'}),{text:'The synthetic outreach draft has been saved. No message was sent.',calls:[]});
  await card.getByRole('button',{name:'Generate draft',exact:true}).click();
  await card.getByRole('button',{name:'Copy draft',exact:true}).waitFor({timeout:30000});
  await card.getByRole('button',{name:'Copy draft',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.syntheticCopiedDraft),draft);report.checks.draftAndCopy=true;
  await card.getByRole('button',{name:'Review / edit',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Review @'+chosen.handle,exact:true});
  await editor.getByLabel('Your notes').fill('Synthetic manual review complete.');await editor.getByLabel('Contact stage',{exact:true}).selectOption('contacted');
  await editor.getByRole('button',{name:'Save contact',exact:true}).click();await editor.waitFor({state:'hidden'});
  assert.equal((await runtime.services.social.contacts(actor,{ids:[chosen.id]})).contacts[0].stage,'contacted');report.checks.manualContactTracking=true;
  await page.getByLabel('Filter saved contacts').fill(chosen.handle);assert.equal(await page.locator('.social-contact').count(),1);report.checks.filter=true;
  const downloaded=page.waitForEvent('download');await page.getByRole('link',{name:'Export CSV',exact:true}).click();
  const download=await downloaded;await download.saveAs(path.join(folder,'synthetic-contacts.csv'));const csv=readFileSync(path.join(folder,'synthetic-contacts.csv'),'utf8');
  assert(csv.includes('coach01@example.test'));assert(csv.includes('contacted'));report.checks.export=true;
  await page.screenshot({path:path.join(folder,'contacts-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  report.mobileFits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);assert(report.mobileFits);
  await page.screenshot({path:path.join(folder,'contacts-mobile.png'),fullPage:true});
  await page.reload();await page.getByRole('button',{name:'Social contacts',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.social-contact').length===20);report.checks.reloadPersistence=true;
  assert.equal(steps.length,0);assert.equal(report.errors.length,0);
  if(process.argv.includes('--native-draft')){
    nativePhase=true;
    const fresh=(await runtime.services.social.contacts(actor)).contacts.find(value=>value.stage==='new');
    const conversationId=randomUUID();await runtime.store.call('conversation.create',{tenantId:actor.tenantId,actorId:actor.id,id:conversationId,now:Date.now()});
    const result=await runtime.core.run('This is an isolated synthetic qualification. Read saved social contact '+fresh.id+
      ' and save a source-supported match reason plus a short English outreach draft for a paid fitness collaboration in Prague. Use only the observed profile and this stated offer. Do not invent a brand, budget or relationship. Draft only, do not mark contacted.',
      {actor,environment:'staging',conversationId,intentId:randomUUID(),channel:'web',secure:true,confidence:'high',source:'user',signal:AbortSignal.timeout(240000)});
    const checked=(await runtime.services.social.contacts(actor,{ids:[fresh.id]})).contacts[0];
    assert(checked.draft.length>40&&checked.matchReason.length>10&&checked.evidenceQuote.length>=8);
    assert.notEqual(checked.stage,'contacted');assert.deepEqual(checked.emails,fresh.emails);
    const calls=result.toolResults.map(value=>value.tool);assert(calls.includes('jarvis_social_contacts'));assert(calls.includes('jarvis_social_contact_update'));
    report.nativeDraft={verified:true,profileData:'synthetic',elapsedMs:result.elapsedMs,tools:calls,draft:checked.draft,matchReason:checked.matchReason,evidenceQuote:checked.evidenceQuote};
  }
  report.verified=true;
}catch(error){report.failure=error.message;process.exitCode=1;await page.screenshot({path:path.join(folder,'failure.png'),fullPage:true}).catch(()=>{});}
finally{writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>gateway.close(resolve));await runtime.app.close();console.log(JSON.stringify({...report,artifacts:folder},null,2));}
