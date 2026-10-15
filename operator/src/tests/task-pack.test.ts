import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Config} from '../config.js';
import type {Actor,Action,Invocation,ObjectValue} from '../contracts.js';
import {createOperator} from '../server.js';
import {actorArtifactRoot,roots} from '../files.js';
import {modelObservation} from '../working-memory.js';
import {groundedAnswer} from '../final-answer.js';
import {publicUrl} from '../web-tools.js';

const tools=['jarvis_document_create','jarvis_document_read','jarvis_task_save','jarvis_remind_after','jarvis_tasks','jarvis_mail','jarvis_send_email','jarvis_sportmedical','jarvis_observation_read','jarvis_run_code','jarvis_table_query'];
async function fixture(work:(runtime:Awaited<ReturnType<typeof createOperator>>,context:Invocation)=>Promise<void>){
  const root=fileURLToPath(new URL('../../../runtime/operator-tests/',import.meta.url));await mkdir(root,{recursive:true});const folder=await mkdtemp(path.join(root,'task-pack-'));
  const config:Config={environment:'staging',tenantId:'qualification-'+randomUUID(),timezone:'Europe/Prague',host:'127.0.0.1',port:18801,origin:'http://127.0.0.1:18801',
    databasePath:path.join(folder,'state.sqlite'),dataKey:randomBytes(32).toString('hex'),callbackKey:randomBytes(32).toString('hex'),adminPassword:randomBytes(32).toString('hex'),
    gatewayUrl:new URL('http://127.0.0.1:18809'),gatewayToken:randomBytes(32).toString('hex'),skillsRoot:fileURLToPath(new URL('../../skills/',import.meta.url)),
    enabledTools:tools,providerMode:'fixture',maxAgentSteps:4,maxToolCalls:6,configurationHash:'qualification-task-pack',environmentValues:{}};
  const runtime=await createOperator(config,{complete:async()=>({text:'Synthetic test response',calls:[]})},{background:false});await runtime.app.ready();
  const actor=await runtime.store.call<Actor>('actor.get',{tenantId:config.tenantId,actorId:'owner'}),id=randomUUID();
  await runtime.store.call('conversation.create',{tenantId:actor.tenantId,actorId:actor.id,id,now:Date.now()});
  const context:Invocation={actor,environment:'staging',conversationId:id,intentId:randomUUID(),channel:'web',secure:true,confidence:'high',source:'user',signal:new AbortController().signal};
  try{await work(runtime,context);}finally{await runtime.app.close();await rm(folder,{recursive:true,force:true});await rm(actorArtifactRoot(actor),{recursive:true,force:true});}
}

test('real PDF/DOCX/XLSX/CSV creation is read back and artifact records stay owner-scoped',async()=>fixture(async(runtime,context)=>{
  for(const format of ['pdf','docx','xlsx','csv']){
    const result=await runtime.owner.invoke('jarvis_document_create',{format,name:'qualification.'+format,title:'Synthetic spending',content:'Verified document round trip',
      columns:['Item','Amount'],rows:[['groceries',85],['transport',24],['utilities',110]],totalColumns:[1],_confidence:'high'},{...context,intentId:randomUUID()});
    assert.equal(result.status,'succeeded',JSON.stringify(result));
    const data=(result.result as ObjectValue).data as ObjectValue;assert.equal((data.totals as ObjectValue)['1'],'219');
    const read=await runtime.owner.invoke('jarvis_document_read',{root:'artifacts',path:data.relative},context);assert.equal(read.ok,true,JSON.stringify(read));
    assert(JSON.stringify((read.result as ObjectValue).data).includes('219'));
    const base={tenantId:context.actor.tenantId,actorId:context.actor.id,now:Date.now()};
    await runtime.store.call('actor.create',{...base,id:'reader',login:'reader',displayName:'Synthetic reader',roles:['reader'],permissions:['operator.chat','files.read'],language:'en',timezone:'UTC',passwordHash:'synthetic'}).catch(error=>{if(error.code!=='ACCOUNT_EXISTS')throw error;});
    await assert.rejects(runtime.store.call('artifact.get',{...base,actorId:'reader',id:data.id??'',secure:true}),/not found/);
  }
}));

test('document requests reject credential/traversal paths and incomplete spreadsheet inputs',async()=>fixture(async(runtime,context)=>{
  for(const file of ['../.env','auth.json','sub/../../secret.txt']){
    const result=await runtime.owner.invoke('jarvis_document_read',{root:'documents',path:file},context);assert.equal(result.ok,false);
  }
  const missing=await runtime.owner.invoke('jarvis_document_create',{format:'xlsx',name:'empty.xlsx',totalColumns:[],_confidence:'high'},context);
  assert.equal((missing.error as ObjectValue).code,'DOCUMENT_TABLE_REQUIRED');
  const limited={...context.actor,permissions:['files.read']};assert.deepEqual(Object.keys(roots(limited)).sort(),['artifacts','inbox']);
  const totals=await runtime.owner.invoke('jarvis_document_create',{format:'xlsx',name:'missing-totals.xlsx',columns:['Amount'],rows:[[5]],_confidence:'high'},context);
  assert.equal((totals.error as ObjectValue).code,'DOCUMENT_TOTALS_REQUIRED');
  const invalid=await runtime.owner.invoke('jarvis_document_read',{root:'SYNTHETIC_PRIVATE_BAD_INPUT',path:'data.csv',limit:400},context);
  assert(!JSON.stringify(invalid).includes('SYNTHETIC_PRIVATE_BAD_INPUT'));assert(JSON.stringify(invalid).includes('maximum'));
}));

test('report creation tolerates an omitted extension and document paging uses explicit row/line counts',async()=>fixture(async(runtime,context)=>{
  const made=await runtime.owner.invoke('jarvis_document_create',{format:'pdf',name:'plain-report',content:'A useful report without spreadsheet arguments.',_confidence:'high'},context);
  assert.equal(made.status,'succeeded',JSON.stringify(made));assert.equal(((made.result as ObjectValue).data as ObjectValue).name,'plain-report.pdf');
  const table=await runtime.owner.invoke('jarvis_document_create',{format:'csv',name:'page-data',columns:['Index'],rows:Array.from({length:20},(_,i)=>[i]),totalColumns:[],_confidence:'high'},{...context,intentId:randomUUID()});
  const file=(table.result as ObjectValue).data as ObjectValue;
  const page=await runtime.owner.invoke('jarvis_document_read',{root:'artifacts',path:file.relative,start:3,limit:4},context);
  const data=(page.result as ObjectValue).data as ObjectValue;assert.equal((data.rows as unknown[]).length,4);assert.equal(data.nextStart,7);
  const text=await runtime.owner.invoke('jarvis_document_create',{format:'md',name:'line-data',content:Array.from({length:650},(_,i)=>'Line '+(i+1)).join('\n'),_confidence:'high'},{...context,intentId:randomUUID()});
  const textFile=(text.result as ObjectValue).data as ObjectValue;
  const later=await runtime.owner.invoke('jarvis_document_read',{root:'artifacts',path:textFile.relative,start:540,limit:100},context);
  const laterData=(later.result as ObjectValue).data as ObjectValue;assert.equal(String(laterData.text).split('\n').length,100);assert.equal(laterData.nextStart,640);
}));

test('sandboxed table analysis computes exact grouped amounts and cannot read files or execute multiple statements',async()=>fixture(async(runtime,context)=>{
  const made=await runtime.owner.invoke('jarvis_document_create',{format:'csv',name:'ledger',columns:['Currency','Amount','Status'],
    rows:[['CZK','0.10','issued'],['CZK','0.20','issued'],['EUR','9.90','issued'],['CZK','99.00','void']],totalColumns:[],_confidence:'high'},context);
  const file=(made.result as ObjectValue).data as ObjectValue;
  const files=[{table:'ledger',root:'artifacts',path:file.relative}];
  const calculated=await runtime.owner.invoke('jarvis_table_query',{files,query:"SELECT Currency, SUM(CAST(Amount AS DECIMAL(18,2))) AS Amount FROM ledger WHERE Status='issued' GROUP BY Currency ORDER BY Currency"},context);
  assert.equal(calculated.ok,true,JSON.stringify(calculated));const result=(calculated.result as ObjectValue).data as ObjectValue;
  assert.deepEqual(result.rows,[['CZK','0.30'],['EUR','9.90']]);assert.equal(result.network,'none');assert.equal(result.hostFilesMounted,false);
  const exported=await runtime.owner.invoke('jarvis_document_create',{format:'xlsx',name:'verified-export',tableObservationId:calculated.observationId,totalColumns:[],_confidence:'high'},{...context,intentId:randomUUID()});
  assert.equal(exported.status,'succeeded',JSON.stringify(exported));
  const preview=(((exported.result as ObjectValue).data as ObjectValue).verifiedPreview as ObjectValue).sheets as ObjectValue[];
  assert.deepEqual(preview[0]!.rows,[['Currency','Amount'],['CZK',0.3],['EUR',9.9]],'Export the verified values as actual numeric cells');
  const conflict=await runtime.owner.invoke('jarvis_document_create',{format:'xlsx',name:'conflict',tableObservationId:calculated.observationId,rows:[[999]],totalColumns:[],_confidence:'high'},context);
  assert.equal((conflict.error as ObjectValue).code,'TABLE_REFERENCE_CONFLICT');
  await runtime.store.call('actor.create',{tenantId:context.actor.tenantId,actorId:context.actor.id,id:'table-reader',login:'table-reader',displayName:'Synthetic reader',roles:['reader'],
    permissions:['operator.chat','documents.create','files.read'],language:'en',timezone:'UTC',passwordHash:'synthetic',now:Date.now()});
  const otherActor=await runtime.store.call<Actor>('actor.get',{tenantId:context.actor.tenantId,actorId:'table-reader'}),conversationId=randomUUID();
  await runtime.store.call('conversation.create',{tenantId:otherActor.tenantId,actorId:otherActor.id,id:conversationId,now:Date.now()});
  const deniedSource=await runtime.owner.invoke('jarvis_document_create',{format:'xlsx',name:'forbidden',tableObservationId:calculated.observationId,totalColumns:[],_confidence:'high'},
    {...context,actor:otherActor,conversationId,intentId:randomUUID()});assert.equal(deniedSource.ok,false);assert.equal((deniedSource.error as ObjectValue).code,'NOT_FOUND');
  for(const query of ["SELECT * FROM read_csv('/etc/passwd')",'SELECT 1; SELECT 2',"COPY ledger TO '/tmp/export.csv'",'ATTACH \'/tmp/other.db\' AS other']){
    const denied=await runtime.owner.invoke('jarvis_table_query',{files,query},context);assert.equal(denied.ok,false,query);assert.equal((denied.error as ObjectValue).code,'TABLE_QUERY_INVALID');
  }
}));

test('reminders actually become due once, and missing accounts never manufacture business data',async()=>fixture(async(runtime,context)=>{
  const result=await runtime.owner.invoke('jarvis_remind_after',{title:'Synthetic follow-up',minutes:1,_confidence:'high'},context);
  assert.equal(result.status,'succeeded',JSON.stringify(result));const task=(result.result as ObjectValue).data as ObjectValue;
  assert.equal(typeof task.dueAtLocal,'string');
  assert.equal(Number(task.dueAt)-Number(task.createdAt),60000);
  assert.deepEqual(await runtime.store.call('reminders.dispatch',{now:Number(task.dueAt)+1}),{fired:1});
  assert.deepEqual(await runtime.store.call('reminders.dispatch',{now:Number(task.dueAt)+2}),{fired:0});
  const mail=await runtime.owner.invoke('jarvis_mail',{action:'list'},context);assert.equal((mail.error as ObjectValue).code,'MAIL_CONNECTION_REQUIRED');
  const clinic=await runtime.owner.invoke('jarvis_sportmedical',{action:'invoices'},context);assert.equal((clinic.error as ObjectValue).code,'CLINIC_SIGNIN_REQUIRED');
  const send=await runtime.owner.invoke('jarvis_send_email',{to:['nobody@example.test'],subject:'Synthetic',text:'Not sent',_confidence:'high'},context);
  assert.equal((send.error as ObjectValue).code,'MAIL_SEND_CONNECTION_REQUIRED');
}));

test('large observation previews preserve a protected retrieval handle and downloads cannot change host',()=>{
  const id=randomUUID(),value:ObjectValue={ok:true,observationId:id,result:{data:{rows:Array.from({length:300},(_,index)=>({index,text:'Data '.repeat(200)}))}}};
  const preview=modelObservation(value);assert(JSON.stringify(preview).length<=8000);assert.equal((preview.contextNotice as ObjectValue).observationId,id);
  assert.equal(((value.result as ObjectValue).data as ObjectValue).rows instanceof Array,true);
  const url='/api/operator/artifacts/'+id+'/download';
  const observations=[{tool:'jarvis_document_create',observation:{status:'succeeded',result:{data:{id,name:'report.xlsx',url}}}}];
  for(const answer of [`[${url}](file:///home/node/credentials/secret.json)`,`Your file is ready: https://artifacts.example.test/${id}/download`]){
    const grounded=groundedAnswer(answer,observations);assert(!grounded.includes('file://'));assert(!grounded.includes('artifacts.example.test'));assert(grounded.includes(']('+url+')'));
  }
});

test('public browser targets reject loopback, private, credential-bearing and metadata URLs',async()=>{
  for(const url of ['http://127.0.0.1','http://2130706433','http://169.254.169.254','http://192.168.1.1','http://user:password@example.com','file:///C:/Users'])
    await assert.rejects(publicUrl(url));
});
