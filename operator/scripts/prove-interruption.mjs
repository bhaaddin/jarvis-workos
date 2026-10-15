import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';

const remote=process.argv.includes('--notebook');
const access=remote?JSON.parse(readFileSync(path.join(projectRoot,'runtime/notebook-call.json'),'utf8')):null;
const url=access?.url??'http://127.0.0.1:18791';
const folder=path.join(projectRoot,'logs','voice-interruption-'+new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chromium'});
const context=await browser.newContext({viewport:{width:1280,height:900},...(access?{httpCredentials:{username:access.username,password:access.password}}:{})});
const page=await context.newPage();
const report={verified:false,transport:remote?'authenticated notebook HTTPS':'local browser',
  microphone:'synthetic PCM MediaStream',autoplay:'browser default',errors:[],requests:[],cancellations:[],utterances:[]};
page.on('pageerror',error=>report.errors.push(error.message));
page.on('request',request=>{
  const route=new URL(request.url()).pathname;
  if(route==='/api/operator/chat')report.requests.push(request.postDataJSON());
  if(route.startsWith('/api/operator/conversations/')&&route.endsWith('/cancel'))report.cancellations.push(route);
  if(route==='/api/voice/speak')report.utterances.push(request.postDataJSON().text);
});
try{
  await page.goto(url+'/#operator');
  await page.getByRole('textbox',{name:'Task or message'}).waitFor({timeout:60000});
  const created=page.waitForResponse(response=>response.url().endsWith('/api/operator/conversations')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'New',exact:true}).click();
  const conversation=await(await created).json();
  await page.waitForFunction(id=>document.querySelector('select[aria-label="Task conversation"]')?.value===id,conversation.id);
  const beforeResponse=await context.request.get(url+'/api/operator/runtime');assert(beforeResponse.ok());
  const beforeMetrics=(await beforeResponse.json()).inference;
  await page.evaluate(async()=>{
    const fixture=window.interruptionFixture={buffers:[],streams:[],audio:null,destination:null,secondEnded:0};
    const decoder=new OfflineAudioContext(1,1,24000);
    for(const text of ['Read the Medical backend global JSON and frontend package JSON, then explain the SDK and React versions.',
      'Actually, use the calculator for seven times six. Give only the number.']){
      const response=await fetch('/api/voice/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voice:'af_heart'})});
      if(!response.ok)throw new Error('Synthetic voice fixture failed: '+response.status);
      fixture.buffers.push(await decoder.decodeAudioData(await response.arrayBuffer()));
    }
    navigator.mediaDevices.getUserMedia=async()=>{
      const audio=new AudioContext();await audio.resume();
      const destination=audio.createMediaStreamDestination();
      fixture.audio=audio;fixture.destination=destination;fixture.streams.push(destination.stream);return destination.stream;
    };
  });
  await page.getByRole('button',{name:'Call JARVIS',exact:true}).click();
  const call=page.locator('.jarvis-call[open]');
  await call.locator('.call-layout[data-phase="listening"]').waitFor({timeout:60000});
  const play=async index=>page.evaluate(index=>{
    const fixture=window.interruptionFixture,source=fixture.audio.createBufferSource();
    source.buffer=fixture.buffers[index];source.connect(fixture.destination);
    if(index===1)source.onended=()=>{fixture.secondEnded=performance.now();};
    source.start();
  },index);
  const firstChat=page.waitForRequest(request=>request.url().endsWith('/api/operator/chat'));
  await play(0);await firstChat;
  await call.locator('.call-layout[data-phase="thinking"][data-input-ready="true"]').waitFor({timeout:60000});
  assert.match(await call.locator('.call-hint').innerText(),/You can interrupt me/);
  await call.screenshot({path:path.join(folder,'thinking-with-live-microphone.png')});
  const first=report.requests[0],cancelRoute=`/api/operator/conversations/${conversation.id}/runs/${first.requestId}/cancel`;
  const runningDeadline=Date.now()+10000;let beforeState;
  while(Date.now()<runningDeadline){
    const response=await context.request.get(url+'/api/operator/runs/'+first.requestId);
    if(response.ok())beforeState=(await response.json()).state;
    if(beforeState==='running')break;
    if(['completed','failed','cancelled'].includes(beforeState))throw new Error('The first task ended before the interruption could be exercised');
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(beforeState,'running','The test must interrupt actual running work, not just a queued request');
  report.firstStateBeforeInterruption=beforeState;
  const cancellation=page.waitForRequest(request=>new URL(request.url()).pathname===cancelRoute);
  const nextChat=page.waitForRequest(request=>request.url().endsWith('/api/operator/chat')&&request.postDataJSON().requestId!==first.requestId);
  await play(1);await cancellation;await nextChat;
  await page.waitForFunction(()=>{
    const audio=document.querySelector('.operator-panel audio');
    return window.interruptionFixture.secondEnded&&audio&&!audio.paused&&audio.currentTime>.1;
  },null,{timeout:180000});
  report.secondEndToAudibleSeconds=await page.evaluate(()=>(performance.now()-window.interruptionFixture.secondEnded)/1000);
  assert.equal(report.requests.length,2,'Exactly one replacement request must be submitted');
  const oldResponse=await context.request.get(url+'/api/operator/runs/'+first.requestId);
  const nextResponse=await context.request.get(url+'/api/operator/runs/'+report.requests[1].requestId);
  assert(oldResponse.ok()&&nextResponse.ok());
  const old=await oldResponse.json(),next=await nextResponse.json();
  report.first={id:first.requestId,state:old.state};
  report.second={id:report.requests[1].requestId,state:next.state,answer:next.result?.text,tools:next.result?.toolResults?.map(value=>value.tool)};
  assert.equal(old.state,'cancelled');assert.equal(next.state,'completed');
  assert(report.second.tools.includes('jarvis_calculate'));assert(!report.second.tools.includes('jarvis_projects'),'The cancelled source task must not be resumed');
  assert.match(report.second.answer,/\b42\b/);assert.match(report.utterances.at(-1),/42|forty[ -]two/i);
  assert(report.cancellations.every(route=>route.includes('/runs/')),'No conversation-wide cancellation can race the next request');
  const metricsResponse=await context.request.get(url+'/api/operator/runtime');assert(metricsResponse.ok());
  const metrics=(await metricsResponse.json()).inference;
  report.modelMetrics={calls:metrics.requests-beforeMetrics.requests,cancelled:metrics.cancellations-(beforeMetrics.cancellations??0),failures:metrics.failures-beforeMetrics.failures};
  assert(report.modelMetrics.cancelled>=1,'The interrupted model call must be classified as cancellation');
  assert.equal(report.modelMetrics.failures,0,'Intentional interruption must not inflate model failure counts');
  await call.screenshot({path:path.join(folder,'replacement-answer.png')});
  await page.getByRole('button',{name:'Hang up',exact:true}).click();
  report.tracksReleased=await page.evaluate(()=>window.interruptionFixture.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));
  assert(report.tracksReleased);assert.equal(report.errors.length,0);report.verified=true;
}catch(error){report.failure=error.message;process.exitCode=1;await page.locator('.jarvis-call[open]').screenshot({path:path.join(folder,'failure.png')}).catch(()=>{});}
finally{writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({...report,artifacts:folder},null,2));}
