// Live, read-only verification through the existing authenticated WorkOS UI.
// Only the microphone source is synthetic; inference, tools, STT and TTS are real.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';

const folder=path.join(projectRoot,'logs','finance-live-'+new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(folder,{recursive:true});
const report={verified:false,syntheticMicrophone:true,at:new Date().toISOString(),checks:{},timings:{},pageErrors:[],artifacts:folder};
const modelBytes=await readFile(path.join(projectRoot,'operator/config/model.json'));
report.model=JSON.parse(modelBytes);report.modelSha256=createHash('sha256').update(modelBytes).digest('hex');
const privateValues=[];
for(const service of ['paper','research']){
  const env=await readFile(path.join(projectRoot,'../Jarvis-Finance/state',service,'credentials.env'),'utf8');
  for(const line of env.split(/\r?\n/)){const at=line.indexOf('=');if(at>0&&!line.slice(0,at).endsWith('USERNAME')){const value=line.slice(at+1);if(value.length>=16)privateValues.push(value);}}
}
const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']}),context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
page.on('pageerror',error=>report.pageErrors.push(error.message));
const base='http://127.0.0.1:18791';
const api=async(route,body)=>{const response=body===undefined?await context.request.get(base+'/api/operator'+route):await context.request.post(base+'/api/operator'+route,{headers:{Origin:base},data:body});assert(response.ok(),'Authenticated request failed: '+route+' '+response.status());return response.json();};
const waitRun=async(initial)=>{let run=initial;for(const end=Date.now()+330000;Date.now()<end&&!['completed','failed','cancelled'].includes(run.state);){await new Promise(resolve=>setTimeout(resolve,250));run=await api('/runs/'+initial.id);}assert.equal(run.state,'completed',run.error?.message);return run;};
const newConversation=async()=>{
  const response=page.waitForResponse(response=>response.url().endsWith('/api/operator/conversations')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'New',exact:true}).click();const created=await(await response).json();
  await page.waitForFunction(id=>document.querySelector('select[aria-label="Task conversation"]')?.value===id,created.id);
  return created.id;
};
const recordRun=(run,start)=>({roundTripMs:Math.round(performance.now()-start),elapsedMs:run.result.elapsedMs,performance:run.result.performance,
  answer:run.result.text,tools:run.result.toolResults.map(value=>({tool:value.tool,ok:value.observation.ok,action:value.observation.result?.data?.action}))});
try{
  assert.equal((await context.request.get('http://127.0.0.1:18801/api/finance')).status(),401);
  await page.goto(base+'/#operator');await page.getByRole('textbox',{name:'Task or message'}).waitFor({timeout:60000});
  const conversationId=await newConversation();
  const skills=await api('/skills');assert(skills.skills.some(value=>value.id==='jarvis_finance'&&value.state==='ready'&&value.mode==='live'));
  report.checks.registeredInExistingOperator=true;
  const response=page.waitForResponse(value=>value.url().endsWith('/api/operator/finance'));
  let began=performance.now();await page.getByRole('button',{name:'Finance',exact:true}).click();const snapshot=await(await response).json();
  report.timings.initialSnapshotMs=Math.round(performance.now()-began);assert.equal(snapshot.status,'ready');
  assert.equal(snapshot.paper.dryRun,true);assert.equal(snapshot.research.historicalOnly,true);assert.equal(snapshot.study.decision,'NO_QUALIFIED_CANDIDATE');
  await page.getByText('No qualified candidate',{exact:true}).waitFor();
  began=performance.now();const cached=await api('/finance');report.timings.repeatedSnapshotMs=Math.round(performance.now()-began);report.timings.cacheAgeMs=cached.cacheAgeMs;
  report.snapshot={observedAt:snapshot.observedAt,connectorMs:snapshot.elapsedMs,balance:snapshot.paper.balance,allocatedBalance:snapshot.paper.allocatedBalance,openPositions:snapshot.paper.openPositions,
    researchResults:snapshot.research.totalResults,study:snapshot.study};
  assert.equal((await context.request.post(base+'/api/operator/finance',{headers:{Origin:base},data:{action:'forceenter'}})).status(),403);
  const rejected=await api('/tools/invoke',{conversationId,requestId:crypto.randomUUID(),tool:'jarvis_finance',input:{action:'paper',url:'http://other.invalid'}});
  assert.equal(rejected.ok,false);assert.equal(rejected.error.code,'TOOL_INPUT_INVALID');report.checks.authenticationAndClosedReadSchema=true;
  const priceResponse=page.waitForResponse(value=>value.url().endsWith('/api/operator/tools/invoke'));
  began=performance.now();await page.getByRole('button',{name:'Read daily prices',exact:true}).click();const prices=await(await priceResponse).json();
  assert.equal(prices.ok,true,prices.error?.message);report.timings.equityReadMs=Math.round(performance.now()-began);assert.equal(prices.result.data.market.liveQuote,false);
  report.market=prices.result.data.market;
  const newsResponse=page.waitForResponse(value=>value.url().endsWith('/api/operator/tools/invoke'));
  began=performance.now();await page.getByRole('button',{name:'Read BBC headlines',exact:true}).click();const news=await(await newsResponse).json();
  assert.equal(news.ok,true,news.error?.message);report.timings.newsReadMs=Math.round(performance.now()-began);assert(news.result.data.news.headlines.length>0);
  report.news={count:news.result.data.news.headlines.length,observedAt:news.result.data.observedAt};
  for(const symbol of ['BTC-USD','EURUSD']){
    const started=performance.now(),result=await api('/tools/invoke',{conversationId,requestId:crypto.randomUUID(),tool:'jarvis_finance',input:{action:'market',symbol}});
    assert.equal(result.ok,true,result.error?.message);report.timings[symbol+'Ms']=Math.round(performance.now()-started);
    report[symbol]={latestDate:result.result.data.market.latestDate,latestClose:result.result.data.market.latestClose,quoteCurrency:result.result.data.market.quoteCurrency};
  }
  await page.screenshot({path:path.join(folder,'finance-desktop.png'),fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(folder,'finance-mobile.png'),fullPage:true,animations:'disabled'});await page.setViewportSize({width:1440,height:1100});
  report.checks.actualFinanceViewAndPublicData=true;
  await page.getByRole('button',{name:'Assistant',exact:true}).click();
  for(const [name,prompt] of [['paper','What is my current virtual paper-wallet balance and open-position count? Give just the verified paper status.'],
    ['study','What was the locked Finance study outcome? Give just the verified result and whether the holdout was tested or anything promoted.']]){
    await newConversation();await page.getByRole('textbox',{name:'Task or message'}).fill(prompt);
    const accepted=page.waitForResponse(value=>value.url().endsWith('/api/operator/chat')&&value.request().method()==='POST');
    const started=performance.now();await page.getByRole('button',{name:'Do this',exact:true}).click();const run=await waitRun(await(await accepted).json());
    assert(run.result.toolResults.some(value=>value.tool==='jarvis_finance'&&value.observation.ok));assert.equal(run.result.completion,'complete');
    report[name+'Task']=recordRun(run,started);
    if(name==='paper')assert(run.result.text.includes('USDT'));else{assert(/not evaluated|not (?:been )?tested|untested/i.test(run.result.text));assert(/no candidate|no qualified|no.*promot/i.test(run.result.text));}
  }
  report.checks.realTasksGrounded=true;
  await newConversation();
  await page.evaluate(async()=>{
    const audioContext=new AudioContext();await audioContext.resume();
    const response=await fetch('/api/voice/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'What is my current virtual paper wallet balance?',voice:'af_heart'})});
    if(!response.ok)throw new Error('Synthetic speech fixture failed.');
    const buffer=await audioContext.decodeAudioData(await response.arrayBuffer());
    window.financeMic={context:audioContext,buffer,streams:[],destination:null};
    navigator.mediaDevices.getUserMedia=async()=>{const destination=audioContext.createMediaStreamDestination();window.financeMic.destination=destination;window.financeMic.streams.push(destination.stream);return destination.stream;};
  });
  const setup=performance.now();await page.getByRole('button',{name:'Talk',exact:true}).click();
  await page.locator('.jarvis-call[open] .call-layout[data-phase="listening"]').waitFor({timeout:120000});
  report.timings.voiceSetupIncludingGreetingMs=Math.round(performance.now()-setup);
  const accepted=page.waitForResponse(value=>value.url().endsWith('/api/operator/chat')&&value.request().postDataJSON()?.delivery==='voice',{timeout:180000});
  const transcript=page.waitForResponse(value=>value.url().endsWith('/api/voice/transcribe'),{timeout:60000});
  const started=performance.now();
  await page.evaluate(()=>{const f=window.financeMic,source=f.context.createBufferSource();source.buffer=f.buffer;source.connect(f.destination);source.start();f.source=source;});
  report.voiceTranscript=await(await transcript).json();report.timings.speechStartToTranscriptMs=Math.round(performance.now()-started);
  const voiceRun=await waitRun(await(await accepted).json());report.voiceTask=recordRun(voiceRun,started);
  assert(voiceRun.result.toolResults.some(value=>value.tool==='jarvis_finance'&&value.observation.ok));
  await page.waitForFunction(()=>{const audio=document.querySelector('.operator-panel audio');return audio&&!audio.paused&&audio.currentTime>0.1;},null,{timeout:60000});
  report.timings.speechStartToAudibleAnswerMs=Math.round(performance.now()-started);
  await page.screenshot({path:path.join(folder,'finance-voice.png'),fullPage:true});
  await page.getByRole('button',{name:'Hang up',exact:true}).click();
  await page.waitForFunction(()=>window.financeMic.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));
  report.checks.realVoiceSTTTaskToolTTS=true;report.checks.microphoneTracksReleased=true;
  assert.equal(createHash('sha256').update(await readFile(path.join(projectRoot,'operator/config/model.json'))).digest('hex'),report.modelSha256);
  report.checks.modelAndReasoningUnchanged=true;assert.equal(report.pageErrors.length,0);report.verified=true;
}catch(error){report.failure=error.message;process.exitCode=1;await page.screenshot({path:path.join(folder,'failure.png'),fullPage:true}).catch(()=>{});}
finally{
  await browser.close();
  const serialized=JSON.stringify(report,null,2);assert(!privateValues.some(value=>serialized.includes(value)),'Private native value in evidence');
  await writeFile(path.join(folder,'results.json'),serialized+'\n');
  console.log(JSON.stringify({verified:report.verified,failure:report.failure??null,checks:report.checks,timings:report.timings,
    paperTask:report.paperTask?.performance,studyTask:report.studyTask?.performance,voiceTask:report.voiceTask?.performance,evidence:folder},null,2));
}
