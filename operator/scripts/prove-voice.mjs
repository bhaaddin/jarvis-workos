import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';
const remote=process.argv.includes('--notebook');
const access=remote?JSON.parse(readFileSync(path.join(projectRoot,'runtime/notebook-call.json'),'utf8')):null;
const url=access?.url??'http://127.0.0.1:18791';
const folder=path.join(projectRoot,'logs','task-voice-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1280,height:900},...(access?{httpCredentials:{username:access.username,password:access.password}}:{})});
const page=await context.newPage(),report={verified:false,transport:remote?'authenticated public HTTPS':'local browser',errors:[],transcripts:[],utterances:[],turns:[],timings:[]};
page.on('pageerror',error=>report.errors.push(error.message));
page.on('request',request=>{if(request.url().endsWith('/api/voice/speak')){report.utterances.push(request.postDataJSON().text);report.timings.push({step:'tts_requested',at:Date.now()});}if(request.url().endsWith('/api/voice/transcribe'))report.timings.push({step:'stt_requested',at:Date.now()});if(request.url().endsWith('/api/operator/chat')){report.turns.push(request.postDataJSON());report.timings.push({step:'agent_requested',at:Date.now()});}});
page.on('response',async response=>{if(response.url().endsWith('/api/voice/transcribe')){report.transcripts.push(await response.json().catch(()=>({error:true})));report.timings.push({step:'stt_completed',at:Date.now()});}if(response.url().endsWith('/api/voice/speak'))report.timings.push({step:'tts_received',at:Date.now()});});
try{
  await page.goto(url+'/#operator');await page.getByRole('heading',{name:'JARVIS Tasks',exact:true}).waitFor({timeout:60000});
  await page.getByRole('textbox',{name:'Task or message'}).waitFor({timeout:30000});
  const created=page.waitForResponse(response=>response.url().endsWith('/api/operator/conversations')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'New',exact:true}).click();const conversation=await(await created).json();
  await page.waitForFunction(id=>document.querySelector('select[aria-label="Task conversation"]')?.value===id,conversation.id);
  await page.evaluate(async()=>{
    const audio=new AudioContext();await audio.resume();
    const response=await fetch('/api/voice/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'What is twelve times twenty five plus eleven times five?',voice:'af_heart'})});
    if(!response.ok)throw new Error('Speech fixture could not be synthesized: '+response.status);
    const buffer=await audio.decodeAudioData(await response.arrayBuffer());window.taskVoiceProof={audio,buffer,streams:[],destination:null,endedAt:0};
    navigator.mediaDevices.getUserMedia=async()=>{const destination=audio.createMediaStreamDestination();window.taskVoiceProof.destination=destination;window.taskVoiceProof.streams.push(destination.stream);return destination.stream;};
  });
  await page.getByRole('button',{name:'Call JARVIS',exact:true}).click();
  await page.locator('.jarvis-call[open] .call-layout[data-phase="listening"]').waitFor({timeout:60000});
  await page.evaluate(()=>{const f=window.taskVoiceProof,source=f.audio.createBufferSource();source.buffer=f.buffer;source.connect(f.destination);source.onended=()=>{f.endedAt=performance.now();};source.start();});
  await page.waitForFunction(()=>{
    const f=window.taskVoiceProof,audio=document.querySelector('.operator-panel audio');return f.endedAt&&audio&&!audio.paused&&audio.currentTime>.1&&audio.duration>.3;
  },null,{timeout:180000});
  report.endToAudibleSeconds=await page.evaluate(()=>(performance.now()-window.taskVoiceProof.endedAt)/1000);
  assert.equal(report.turns.length,1,'The spoken turn reached the operational agent, not legacy chat');
  const runResponse=await context.request.get(url+'/api/operator/runs/'+report.turns[0].requestId);assert(runResponse.ok());
  const run=await runResponse.json();report.agent={state:run.state,elapsedMs:run.result?.elapsedMs,tools:run.result?.toolResults?.map(value=>value.tool)??[]};
  assert(report.agent.tools.includes('jarvis_calculate'),'The spoken arithmetic must use the checked calculator');
  assert(report.transcripts.some(value=>typeof value.text==='string'&&value.text.length>10));
  assert(report.utterances.some(value=>/355|three hundred (?:and )?fifty[ -]five/i.test(value)),'The real calculated answer was spoken');
  await page.screenshot({path:path.join(folder,'operational-call.png'),fullPage:true});
  await page.getByRole('button',{name:'Hang up',exact:true}).click();
  report.tracksReleased=await page.evaluate(()=>window.taskVoiceProof.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));
  assert(report.tracksReleased);assert.equal(report.errors.length,0);report.verified=true;
}catch(error){report.failure=error.message;process.exitCode=1;await page.screenshot({path:path.join(folder,'failure.png'),fullPage:true}).catch(()=>{});}
finally{writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({...report,artifacts:folder},null,2));}
