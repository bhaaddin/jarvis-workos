import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import type {Config} from '../config.js';
import type {Actor,Invocation,Model,ObjectValue} from '../contracts.js';
import {Finance} from '../finance.js';
import {boundedResponse,readMarket} from '../finance-market.js';
import {directFinance} from '../finance-answer.js';
import {createOperator} from '../server.js';

const marker='PRIVATE_FINANCE_TEST_CREDENTIAL';
const authorization='Basic '+Buffer.from('synthetic:'+marker).toString('base64');
const actor:Actor={id:'owner',tenantId:'finance-test',displayName:'Synthetic owner',roles:['owner'],permissions:['operator.chat','connections.manage'],revision:1,active:true,language:'en',timezone:'Europe/Prague'};
const signal=()=>new AbortController().signal;
const comparison={verified_at:'2026-10-07T13:25:53.635990+00:00',decision:'NO_QUALIFIED_CANDIDATE',holdout_evaluated:false,paper_parameter_changes:false,epoch_count:64,
  validation_rows:[{label:'baseline-validation',epoch:null,buy_rsi:30,sell_rsi:70,trades:15,net_usdt:-7.7686806,return_pct:-0.77686806,closed_drawdown_usdt:10.75,wallet_drawdown_usdt:12.86792502,qualified:false},
    {label:'candidate-14-validation',epoch:14,buy_rsi:23,sell_rsi:56,trades:18,net_usdt:-1.67599629,return_pct:-0.167599629,closed_drawdown_usdt:3.34,wallet_drawdown_usdt:4.42384289,qualified:false}],
  loss_reduction_pct:78.4262428,wallet_drawdown_reduction_pct:65.6211636,unexpectedSecret:marker};

async function fixture(run:(finance:Finance,config:Config)=>Promise<void>){
  const base=fileURLToPath(new URL('../../../runtime/operator-tests/',import.meta.url));await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'finance-'));
  for(const service of ['paper','research']){await mkdir(path.join(root,'state',service),{recursive:true});await writeFile(path.join(root,'state',service,'credentials.env'),service.toUpperCase()+'_MCP_AUTHORIZATION='+authorization+'\n');}
  await mkdir(path.join(root,'evidence/2026-10-07-rsi'),{recursive:true});await writeFile(path.join(root,'evidence/2026-10-07-rsi/COMPARISON.json'),JSON.stringify(comparison));
  const config:Config={environment:'staging',tenantId:actor.tenantId,timezone:actor.timezone,host:'127.0.0.1',port:18801,origin:'http://127.0.0.1:18801',
    databasePath:path.join(root,'state.sqlite'),dataKey:randomBytes(32).toString('hex'),callbackKey:randomBytes(32).toString('hex'),adminPassword:randomBytes(32).toString('hex'),
    gatewayUrl:new URL('http://127.0.0.1:18809'),gatewayToken:'unused',skillsRoot:fileURLToPath(new URL('../../skills/',import.meta.url)),enabledTools:['jarvis_finance'],
    providerMode:'fixture',maxAgentSteps:4,maxToolCalls:6,configurationHash:'finance-test',environmentValues:{},finance:{root,ownerId:'owner',studyId:'2026-10-07-rsi'}};
  try{await run(new Finance(config),config);}finally{await rm(root,{recursive:true,force:true});}
}

function backend(input:URL|string|Request,init?:RequestInit):Response{
  const url=new URL(String(input));assert.equal(url.hostname,'127.0.0.1');assert(['18812','18814'].includes(url.port));
  assert.equal(init?.method,'GET');assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('authorization'),authorization);
  const route=url.pathname.slice('/api/v1/'.length)+url.search;
  if(route==='show_config')return Response.json({dry_run:true,runmode:url.port==='18812'?'dry_run':'webserver',state:'running',strategy:'SampleStrategy',timeframe:'5m',stake_currency:'USDT',password:marker});
  if(route==='balance')return Response.json({total:1000,total_bot:950,starting_capital:950,stake:'USDT',secret:marker});
  if(route==='count')return Response.json({current:0,max:2});
  if(route==='daily?timescale=7')return Response.json({data:[{date:'2026-10-08',abs_profit:0,trade_count:0}]});
  if(route==='status')return Response.json([]);
  if(route==='trades?limit=5')return Response.json({trades:[],total_trades:0});
  if(route==='backtest/history')return Response.json([{filename:'backtest-result-2026-10-07_13-11-19',strategy:'SampleStrategy',backtest_start_time:1791378679,notes:marker,timeframe:'5m'}]);
  throw new Error('Unexpected native route: '+route);
}

test('Finance projects live paper/history/study reads, hides secrets and bounds its short cache',async t=>{
  let requests=0;t.mock.method(globalThis,'fetch',async(input:URL|string|Request,init?:RequestInit)=>{requests++;return backend(input,init);});
  await fixture(async finance=>{
    const observed=await finance.read(actor,{action:'overview'},signal());assert.equal(observed.status,'ready');assert.equal(observed.readOnly,true);
    assert.equal((observed.paper as ObjectValue).balance,1000);assert.equal((observed.paper as ObjectValue).allocatedBalance,950);
    assert.equal((observed.study as ObjectValue).holdoutEvaluated,false);assert.equal(requests,8);
    assert(!JSON.stringify(observed).includes(marker));assert(!JSON.stringify(observed).includes(authorization));assert(!JSON.stringify(observed).includes('password'));
    const again=await finance.read(actor,{action:'overview'},signal());assert.equal(requests,8);assert.equal(again.observedAt,observed.observedAt);
    await assert.rejects(finance.read({...actor,id:'other'},{action:'overview'},signal()),{code:'FORBIDDEN'});
    await assert.rejects(finance.read({...actor,tenantId:'other'},{action:'overview'},signal()),{code:'FORBIDDEN'});
    await assert.rejects(finance.read({...actor,permissions:['operator.chat']},{action:'overview'},signal()),{code:'FORBIDDEN'});
    const aborted=new AbortController();aborted.abort();await assert.rejects(finance.read(actor,{action:'overview'},aborted.signal),{name:'AbortError'});
    assert.equal(requests,8,'cached reads must still enforce identity and cancellation');
  });
});

test('Finance rejects URL/path/control injection before network reads and does not invent unavailable balances',async t=>{
  let requests=0;t.mock.method(globalThis,'fetch',async(input:URL|string|Request,init?:RequestInit)=>{requests++;if(String(input).endsWith('/balance'))return Response.json({secret:marker},{status:401});return backend(input,init);});
  await fixture(async finance=>{
    for(const input of [{action:'forceenter'},{action:'backtest/abort'},{action:'overview',url:'http://other.invalid'},
      {action:'paper',path:'../private'},{action:'market',symbol:'https://other.invalid'},{action:'news',symbol:'SPY'}]){
      await assert.rejects(finance.read(actor,input as ObjectValue,signal()),{code:'FINANCE_INPUT_INVALID'});
    }
    assert.equal(requests,0);
    const partial=await finance.read(actor,{action:'overview'},signal());assert.equal(partial.status,'partial');
    assert.equal((partial.paper as ObjectValue).status,'unavailable');assert.equal((partial.paper as ObjectValue).balance,undefined);
    assert(!JSON.stringify(partial).includes(marker));assert.equal((partial.study as ObjectValue).status,'ready');
    const before=requests;await finance.read(actor,{action:'overview'},signal());assert(requests>before,'failures must not be cached as successful data');
  });
});

test('live trading or wrong research mode is rejected before further account access',async t=>{
  const requests:string[]=[];t.mock.method(globalThis,'fetch',async(input:URL|string|Request)=>{requests.push(String(input));return Response.json({dry_run:false,runmode:'live'});});
  await fixture(async finance=>{
    const result=await finance.read(actor,{action:'overview'},signal());assert.equal(result.status,'partial');
    assert.equal((result.paper as ObjectValue).status,'unavailable');assert.equal((result.research as ObjectValue).status,'unavailable');
    assert.equal(requests.length,2);assert(requests.every(url=>url.endsWith('/show_config')));
  });
});

test('cancelled native requests settle without returning partial data or retaining success',async t=>{
  let started:()=>void=()=>{};const ready=new Promise<void>(resolve=>{started=resolve;});
  t.mock.method(globalThis,'fetch',async(_input:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
    started();const abort=()=>reject(init!.signal!.reason);init!.signal!.addEventListener('abort',abort,{once:true});if(init!.signal!.aborted)abort();
  }));
  await fixture(async finance=>{const controller=new AbortController(),pending=finance.read(actor,{action:'paper'},controller.signal);await ready;controller.abort();await assert.rejects(pending,{name:'AbortError'});});
});

test('native response byte limits and root containment fail closed',async()=>{
  await assert.rejects(boundedResponse(new Response('x'.repeat(1025)),1024).text(),{code:'FINANCE_RESPONSE_LIMIT'});
  await fixture(async(finance,config)=>{
    const folder=path.join(config.finance!.root,'evidence/2026-10-07-rsi');await rm(folder,{recursive:true});
    const outside=await mkdtemp(path.join(path.dirname(config.finance!.root),'finance-outside-'));
    try{
      await writeFile(path.join(outside,'COMPARISON.json'),JSON.stringify(comparison));
      // Windows junctions do not require elevated symlink privileges.
      await symlink(outside,folder,'junction');
      await assert.rejects(finance.read(actor,{action:'study'},signal()),{code:'FINANCE_FILE_REJECTED'});
    }finally{await rm(folder,{force:true,recursive:true});await rm(outside,{recursive:true,force:true});}
  });
});

test('official MCP client calls only the selected public reader and projects dated bars',async t=>{
  const calls:string[]=[];const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  t.mock.method(globalThis,'fetch',async(input:URL|string|Request,init?:RequestInit)=>{
    assert.equal(String(input),'http://127.0.0.1:18815/mcp');assert.equal(init?.redirect,'error');
    if(init?.method==='GET')return new Response(null,{status:405});
    const request=JSON.parse(String(init?.body??'{}'));calls.push(request.method);
    if(request.method==='notifications/initialized'||request.method==='notifications/cancelled')return new Response(null,{status:202});
    if(request.method==='initialize')return Response.json({jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1.0.0'}}});
    assert.equal(request.method,'tools/call');assert.equal(request.params.name,'equity_price_historical');assert.equal(request.params.arguments.symbol,'SPY');
    assert.equal(request.params.arguments.chart,false);assert.equal(request.params.arguments.interval,'1d');
    return Response.json({jsonrpc:'2.0',id:request.id,result:{content:[],structuredContent:{results:[{date:yesterday,open:100,high:105,low:99,close:103,volume:200},
      {date:new Date().toISOString().slice(0,10),open:103,high:110,low:102,close:108,volume:50}],extra:{secret:marker}}}});
  });
  const result=await readMarket('market','SPY',signal());assert.equal(result.latestClose,103);assert.equal(result.latestDate,yesterday);
  assert.equal(result.liveQuote,false);assert.equal(result.excludedBars,1);assert.equal((result.bars as unknown[]).length,1);
  assert(!JSON.stringify(result).includes(marker));assert.equal(calls.filter(name=>name==='tools/call').length,1);
});

test('direct Finance replies require a successful single, explicit, numeric observation',async()=>fixture(async(finance)=>{
  const data=await finance.read(actor,{action:'study'},signal()),observation={ok:true,result:{data}};
  const text=directFinance('jarvis_finance',{action:'study',_respond:true},observation,1)!;
  assert(text.includes('1.67599629'));assert(text.includes('not a profit'));assert(text.includes('holdout was not evaluated'));
  assert.equal(directFinance('jarvis_finance',{action:'study'},observation,1),null);
  assert.equal(directFinance('jarvis_finance',{action:'study',_respond:true},observation,2),null);
  assert.equal(directFinance('jarvis_finance',{action:'study',_respond:true},{...observation,ok:false},1),null);
  assert.equal(directFinance('jarvis_finance',{action:'news',_respond:true},observation,1),null);
  const changed=structuredClone(data);(changed.study as ObjectValue).holdoutEvaluated=true;
  assert.equal(directFinance('jarvis_finance',{action:'study',_respond:true},{ok:true,result:{data:changed}},1),null);
}));

test('authenticated Finance API and voice task use the same permissioned tool, with no second model call',async t=>{
  t.mock.method(globalThis,'fetch',async(input:URL|string|Request,init?:RequestInit)=>backend(input,init));
  await fixture(async(_finance,config)=>{
    let modelCalls=0;
    const model:Model={complete:async(_messages,tools)=>{modelCalls++;assert(tools.some(tool=>(tool.function as ObjectValue).name==='jarvis_finance'));
      return {text:'',calls:[{id:'finance-call',type:'function',function:{name:'jarvis_finance',arguments:JSON.stringify({action:'paper',_respond:true})}}]};}};
    const runtime=await createOperator(config,model,{background:false});
    try{
      await runtime.app.ready();assert.equal(runtime.registry.list().find(tool=>tool.id==='jarvis_finance')?.state,'ready',JSON.stringify(runtime.registry.list().filter(tool=>tool.id.includes('finance'))));
      assert.equal((await runtime.app.inject('/api/finance')).statusCode,401);
      const logged=await runtime.app.inject({method:'POST',url:'/api/auth/login',headers:{origin:config.origin},payload:{login:'matko',password:config.adminPassword}});
      const headers={cookie:String(logged.headers['set-cookie']).split(';')[0]!,origin:config.origin,'x-csrf-token':logged.json().csrf};
      const response=await runtime.app.inject({method:'GET',url:'/api/finance',headers});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().status,'ready');
      assert.equal((await runtime.app.inject({method:'GET',url:'/api/finance?url=http://example.test',headers})).statusCode,400);
      assert.equal((await runtime.app.inject({method:'POST',url:'/api/finance',headers,payload:{action:'forceenter'}})).statusCode,404);
      const created=await runtime.app.inject({method:'POST',url:'/api/conversations',headers,payload:{}});
      const context:Invocation={actor:logged.json().actor,environment:'staging',conversationId:created.json().id,intentId:randomUUID(),channel:'voice',secure:true,confidence:'high',source:'user',signal:signal()};
      const result=await runtime.core.run('What is my paper wallet balance?',context);
      assert.equal(result.completion,'complete');assert.equal(modelCalls,1);assert.equal(result.performance?.modelCalls,1);assert(result.text.includes('1000 USDT virtual balance'));
      assert.equal(result.toolResults.length,1);assert(!JSON.stringify(result).includes(marker));
      const insecure=await runtime.owner.invoke('jarvis_finance',{action:'paper'},{...context,secure:false});assert.equal(insecure.ok,false);
      const injection=await runtime.owner.invoke('jarvis_finance',{action:'paper',url:'http://other.invalid'},context);assert.equal(injection.ok,false);
      const admin=context.actor;
      await runtime.store.call('actor.update',{tenantId:admin.tenantId,actorId:admin.id,id:admin.id,now:Date.now(),permissions:admin.permissions.filter(value=>value!=='connections.manage')});
      assert.equal((await runtime.app.inject({method:'GET',url:'/api/finance',headers})).statusCode,403,'cached data must not bypass revoked permission');
    }finally{await runtime.app.close();}
  });
});
