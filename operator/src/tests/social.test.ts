import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOperator} from '../server.js';
import type {Config} from '../config.js';
import type {Actor,Invocation,ObjectValue} from '../contracts.js';
import {parseProfile} from '../social-model.js';
import {allowedSocialHost,hasLoginCookie,platformStorage,SocialBrowser,type SocialWindow} from '../social-browser.js';
import {Social} from '../social.js';

const tools=['jarvis_social_research','jarvis_social_contacts','jarvis_social_contact_update'];
const brief={query:'fitness creators',location:'Prague',languages:'Czech, English',purpose:'paid collaboration',platforms:['instagram','tiktok'],limit:20};
const profile=parseProfile('https://www.instagram.com/synthetic_prague_coach/',{url:'https://www.instagram.com/synthetic_prague_coach/',title:'Synthetic Prague coach',description:'',
  bio:'Fitness coach in Praha. Czech and English. Business: team@example.test',body:'Public synthetic profile',followers:'12.4K',links:[]},'2026-10-06T12:00:00Z');

async function syntheticConnections(runtime:Awaited<ReturnType<typeof createOperator>>,context:Invocation){
  for(const platform of ['instagram','tiktok'])await runtime.store.call('connection.save',{tenantId:context.actor.tenantId,actorId:context.actor.id,now:Date.now(),id:'social:'+platform,
    value:{storageState:{cookies:[],origins:[]},savedAt:'2026-10-06T12:00:00Z',label:'Synthetic connection; browser stubbed in this test'}});
  context.actor=await runtime.store.call<Actor>('actor.get',{tenantId:context.actor.tenantId,actorId:context.actor.id});
}

async function fixture(work:(runtime:Awaited<ReturnType<typeof createOperator>>,context:Invocation,config:Config)=>Promise<void>){
  const root=fileURLToPath(new URL('../../../runtime/operator-tests/',import.meta.url));await mkdir(root,{recursive:true});const folder=await mkdtemp(path.join(root,'social-'));
  const config:Config={environment:'staging',tenantId:'social-'+randomUUID(),timezone:'Europe/Prague',host:'127.0.0.1',port:18801,origin:'http://127.0.0.1:18801',databasePath:path.join(folder,'state.sqlite'),
    dataKey:randomBytes(32).toString('hex'),callbackKey:randomBytes(32).toString('hex'),adminPassword:randomBytes(32).toString('hex'),gatewayUrl:new URL('http://127.0.0.1:18809'),gatewayToken:'synthetic',
    skillsRoot:fileURLToPath(new URL('../../skills/',import.meta.url)),enabledTools:tools,providerMode:'fixture',maxAgentSteps:4,maxToolCalls:6,configurationHash:'social-test',environmentValues:{}};
  const runtime=await createOperator(config,{complete:async()=>({text:'Synthetic test',calls:[]})},{background:false});await runtime.app.ready();
  const actor=await runtime.store.call<Actor>('actor.get',{tenantId:config.tenantId,actorId:'owner'}),conversationId=randomUUID();
  await runtime.store.call('conversation.create',{tenantId:actor.tenantId,actorId:actor.id,id:conversationId,now:Date.now()});
  const context:Invocation={actor,environment:'staging',conversationId,intentId:randomUUID(),channel:'web',secure:true,confidence:'high',source:'user',signal:new AbortController().signal};
  try{await work(runtime,context,config);}finally{await runtime.app.close();await rm(folder,{recursive:true,force:true});}
}

test('social session filtering retains only live first-party cookies and rejects lookalike hosts',()=>{
  const cookie={name:'sessionid',value:'SYNTHETIC_PRIVATE_COOKIE',domain:'.instagram.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax' as const};
  const state=platformStorage({cookies:[cookie,{...cookie,domain:'.google.com'},{...cookie,domain:'.evilinstagram.com'},{...cookie,name:'old',expires:1}],
    origins:[{origin:'https://www.instagram.com',localStorage:[{name:'session-pref',value:'synthetic'}]},{origin:'https://accounts.google.com',localStorage:[{name:'private',value:'not-retained'}]}]},'instagram');
  assert.equal(state.cookies.length,1);assert(hasLoginCookie(state,'instagram'));assert(!hasLoginCookie(state,'tiktok'));
  assert.equal(state.origins.length,1);assert(!JSON.stringify(state).includes('not-retained'));
  assert(allowedSocialHost('static.cdninstagram.com','instagram'));assert(!allowedSocialHost('instagram.com.evil.test','instagram'));assert(!allowedSocialHost('localhost','tiktok'));
  assert(allowedSocialHost('sf16-website-login.neutral.tiktokcdn-eu.com','tiktok'));
  assert(allowedSocialHost('webmssdk16-normal-no1a.tiktokw.eu','tiktok'));
  assert(allowedSocialHost('starling-ttp2.tiktokv.eu','tiktok'));
  assert(!allowedSocialHost('tiktokcdn-eu.com.evil.test','tiktok'));
});

test('dedicated login requires an actual session, protects ownership and persists only first-party cookies',async()=>fixture(async(runtime,context)=>{
  let authenticated=false,closed=0;
  const page={isClosed:()=>false,url:()=>authenticated?'https://www.instagram.com/':'https://www.instagram.com/accounts/login/',
    evaluate:async()=>({loaded:true,loginVisible:!authenticated,challengeVisible:false})};
  const cookie={name:'sessionid',value:'SYNTHETIC_PRIVATE_SAVED_SESSION',domain:'.instagram.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax' as const};
  const driver=new SocialBrowser();
  driver.open=async()=>({page,context:{pages:()=>[page],cookies:async()=>authenticated?[cookie]:[],storageState:async()=>({cookies:authenticated?[cookie,{...cookie,domain:'.google.com'}]:[],origins:[]})},browser:{on:()=>{},close:async()=>{closed++;}}} as unknown as SocialWindow);
  driver.snapshot=async()=>({url:page.url(),title:'Synthetic login',body:authenticated?'Home':'Log in to continue',bio:'',description:'',followers:'',links:[]});
  const manager=new Social(runtime.store,driver);
  try{
    const login=await manager.startLogin(context.actor,'instagram');assert(manager.hasPendingLogins());
    await assert.rejects(manager.saveLogin(context.actor,'instagram',String(login.id)),/Finish signing in/);
    await assert.rejects(manager.saveLogin({...context.actor,id:'other'},'instagram',String(login.id)),/Open a new sign-in/);
    authenticated=true;
    await Promise.all([manager.saveLogin(context.actor,'instagram',String(login.id),'Synthetic account'),manager.saveLogin(context.actor,'instagram',String(login.id),'Synthetic account')]);
    assert.equal(closed,1);assert(!manager.hasPendingLogins());
    await manager.saveLogin(context.actor,'instagram',String(login.id),'Synthetic account');
    const current=await runtime.store.call<Actor>('actor.get',{tenantId:context.actor.tenantId,actorId:context.actor.id});assert.equal(current.revision,context.actor.revision+1);
    const saved=await runtime.store.call<ObjectValue>('connection.get',{tenantId:context.actor.tenantId,actorId:context.actor.id,now:Date.now(),id:'social:instagram'});
    assert.equal(((saved.storageState as ObjectValue).cookies as unknown[]).length,1);
    assert(!JSON.stringify(await manager.status(context.actor)).includes(cookie.value));
  }finally{await manager.close();}
}));

test('a completed dedicated sign-in is saved automatically without a second user action',async()=>fixture(async(runtime,context)=>{
  let authenticated=false,closed=0;
  const cookie={name:'sessionid',value:'SYNTHETIC_PRIVATE_AUTO_SESSION',domain:'.instagram.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax' as const};
  const page={isClosed:()=>false,url:()=>authenticated?'https://www.instagram.com/':'https://www.instagram.com/accounts/login/',
    evaluate:async()=>({loaded:true,loginVisible:!authenticated,challengeVisible:false})};
  const driver=new SocialBrowser();
  driver.open=async()=>({page,context:{pages:()=>[page],cookies:async()=>authenticated?[cookie]:[],storageState:async()=>({cookies:authenticated?[cookie]:[],origins:[]})},browser:{on:()=>{},close:async()=>{closed++;}}} as unknown as SocialWindow);
  driver.snapshot=async()=>({url:page.url(),title:'Synthetic login',body:authenticated?'Home':'Log in to continue',bio:'',description:'',followers:'',links:[]});
  const manager=new Social(runtime.store,driver);
  try{
    await manager.startLogin(context.actor,'instagram');
    assert.equal((await manager.status(context.actor)).connections instanceof Array,true);
    authenticated=true;
    const deadline=Date.now()+7000;
    while(manager.hasPendingLogins()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
    const current=await runtime.store.call<Actor>('actor.get',{tenantId:context.actor.tenantId,actorId:context.actor.id});
    const status=await manager.status(current),rows=status.connections as ObjectValue[];
    assert.equal(rows.find(value=>value.platform==='instagram')?.hasSession,true,'A verified sign-in should persist without pressing Save');
    assert.equal(closed,1);assert.equal(current.revision,context.actor.revision+1,'Automatic save must be applied once');
    assert(!JSON.stringify(status).includes(cookie.value));
  }finally{await manager.close();}
}));

test('closing a login while verification is pending cannot save it or close a replacement window',async()=>fixture(async(runtime,context)=>{
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  const cookie={name:'sessionid',value:'SYNTHETIC_PRIVATE_LATE_SESSION',domain:'.instagram.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax' as const};
  const windows:Array<{closed:boolean}>=[],driver=new SocialBrowser();
  driver.open=async()=>{
    const state={closed:false};windows.push(state);
    const page={isClosed:()=>state.closed,url:()=> 'https://www.instagram.com/',evaluate:async()=>{await pending;return {loaded:true,loginVisible:false,challengeVisible:false};}};
    return {page,context:{pages:()=>[page],cookies:async()=>[cookie],storageState:async()=>({cookies:[cookie],origins:[]})},browser:{on:()=>{},close:async()=>{state.closed=true;}}} as unknown as SocialWindow;
  };
  driver.snapshot=async()=>{await pending;return {url:'https://www.instagram.com/',title:'Synthetic',body:'Home',bio:'',description:'',followers:'',links:[]};};
  const manager=new Social(runtime.store,driver);
  try{
    const old=await manager.startLogin(context.actor,'instagram');
    const save=manager.saveLogin(context.actor,'instagram',String(old.id));
    const refused=assert.rejects(save,/sign-in|Sign-in|window|Window/);
    await manager.cancelLogin(context.actor,'instagram',String(old.id));
    const next=await manager.startLogin(context.actor,'instagram');release();await refused;
    assert.notEqual(next.id,old.id);assert.equal(windows[1]?.closed,false);
    assert.equal(await runtime.store.call('connection.get',{tenantId:context.actor.tenantId,actorId:context.actor.id,id:'social:instagram',now:Date.now()}),null);
  }finally{release();await manager.close();}
}));

test('automatic capture rechecks current account permission before inspecting or saving a session',async()=>fixture(async(runtime,context)=>{
  let closed=0,inspected=0;const driver=new SocialBrowser();
  driver.open=async()=>({browser:{on:()=>{},close:async()=>{closed++;}}} as unknown as SocialWindow);
  driver.loginStatus=async()=>{inspected++;return {ready:true,signature:'synthetic'};};
  const manager=new Social(runtime.store,driver);
  try{
    await manager.startLogin(context.actor,'instagram');
    await runtime.store.call('actor.update',{tenantId:context.actor.tenantId,actorId:context.actor.id,id:context.actor.id,now:Date.now(),permissions:context.actor.permissions.filter(value=>value!=='connections.manage')});
    const deadline=Date.now()+4000;while(manager.hasPendingLogins()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(closed,1);assert.equal(inspected,0);
    assert.equal(await runtime.store.call('connection.get',{tenantId:context.actor.tenantId,actorId:context.actor.id,id:'social:instagram',now:Date.now()}),null);
  }finally{await manager.close();}
}));

test('social account status never exposes stored session credentials and absent login cannot fabricate contacts',async()=>fixture(async(runtime,context,config)=>{
  const missing=await runtime.owner.invoke('jarvis_social_research',{...brief,_confidence:'high'},context);
  assert.equal(missing.ok,false);assert.equal((missing.error as ObjectValue).code,'SOCIAL_CONNECTION_REQUIRED');
  const marker='SYNTHETIC_PRIVATE_SOCIAL_COOKIE';
  await runtime.store.call('connection.save',{tenantId:context.actor.tenantId,actorId:context.actor.id,now:Date.now(),id:'social:instagram',value:{storageState:{cookies:[{name:'sessionid',value:marker}],origins:[]},savedAt:'2026-10-06T12:00:00Z',label:'Synthetic account'}});
  const current=await runtime.store.call<Actor>('actor.get',{tenantId:context.actor.tenantId,actorId:context.actor.id});
  const status=await runtime.services.social.status(current);
  assert(JSON.stringify(status).includes('session_saved'));assert(!JSON.stringify(status).includes(marker));
  assert(!(await readFile(config.databasePath)).includes(Buffer.from(marker)));
  assert.deepEqual((await runtime.services.social.contacts(current)).contacts,[]);
}));

test('observed social research is saved once, deduplicated, and preserves contacted state and drafts',async t=>fixture(async(runtime,context)=>{
  await syntheticConnections(runtime,context);
  let browsed=0;
  t.mock.method(runtime.services.social,'research',async()=>{browsed++;return {brief,profiles:[profile],issues:[],requested:20,observed:1,status:'partial',observedAt:profile.observedAt};});
  const saved=await runtime.owner.invoke('jarvis_social_research',{...brief,_confidence:'high'},context);
  assert.equal(saved.status,'succeeded',JSON.stringify(saved));
  await runtime.owner.invoke('jarvis_social_research',{...brief,_confidence:'high'},context);assert.equal(browsed,1);
  const rows=(await runtime.services.social.contacts(context.actor)).contacts as ObjectValue[];assert.equal(rows.length,1);assert.equal(rows[0]?.sourceState,'profile_read');
  const update=await runtime.owner.invoke('jarvis_social_contact_update',{edits:[{id:profile.id,expectedRevision:rows[0]!.revision,stage:'contacted',notes:'Reviewed manually',
    draft:'Would you be open to a paid fitness collaboration?',draftPurpose:'paid collaboration',matchReason:'The bio explicitly identifies Prague fitness coaching.',evidenceQuote:'Fitness coach in Praha.'}],_confidence:'high'},{...context,intentId:randomUUID()});
  assert.equal(update.status,'succeeded',JSON.stringify(update));
  await runtime.owner.invoke('jarvis_social_research',{...brief,_confidence:'high'},{...context,intentId:randomUUID()});
  const refreshed=(await runtime.services.social.contacts(context.actor)).contacts as ObjectValue[];
  assert.equal(refreshed.length,1);assert.equal(refreshed[0]?.stage,'contacted');assert.equal(refreshed[0]?.notes,'Reviewed manually');assert(String(refreshed[0]?.draft).includes('paid fitness'));
  const csv=await runtime.services.social.export(context.actor);assert(csv.includes('team@example.test'));assert(csv.includes('contacted'));
}));

test('contact edits reject invented fields, unsupported evidence and stale revisions atomically',async t=>fixture(async(runtime,context)=>{
  await syntheticConnections(runtime,context);
  t.mock.method(runtime.services.social,'research',async()=>({brief,profiles:[profile],issues:[],requested:20,observed:1,status:'partial',observedAt:profile.observedAt}));
  await runtime.owner.invoke('jarvis_social_research',{...brief,_confidence:'high'},context);
  for(const edit of [{id:profile.id,expectedRevision:1,emails:['invented@example.test']},{id:profile.id,expectedRevision:1,matchReason:'Wrong city',evidenceQuote:'Lives in Paris'},
    {id:profile.id,expectedRevision:99,notes:'Stale overwrite'}]){
    const failed=await runtime.owner.invoke('jarvis_social_contact_update',{edits:[edit],_confidence:'high'},{...context,intentId:randomUUID()});assert.equal(failed.ok,false);
  }
  const rows=(await runtime.services.social.contacts(context.actor)).contacts as ObjectValue[];assert.equal(rows[0]?.revision,1);assert.equal(rows[0]?.notes,'');
  const base={tenantId:context.actor.tenantId,actorId:context.actor.id,now:Date.now()};
  await runtime.store.call('actor.create',{...base,id:'other',login:'other',displayName:'Synthetic reader',roles:['reader'],permissions:['operator.chat','web.read','memory.read','memory.write'],language:'en',timezone:'UTC',passwordHash:'synthetic'});
  const other=await runtime.store.call<Actor>('actor.get',{tenantId:context.actor.tenantId,actorId:'other'});
  assert.deepEqual((await runtime.services.social.contacts(other)).contacts,[]);
}));
