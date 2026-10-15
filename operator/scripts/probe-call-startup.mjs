import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';

// Use the browser's actual media API and autoplay policy. Only the microphone
// hardware is synthetic; the ignored-prompt mode explicitly holds permission.
// Never retain Authorization headers, cookies, task contents, traces or HARs.
const remote=process.argv.includes('--notebook');
const ignored=process.argv.includes('--ignore-permission');
const access=remote?JSON.parse(readFileSync(path.join(projectRoot,'runtime/notebook-call.json'),'utf8')):null;
const origin=access?.url??'http://127.0.0.1:18791';
const folder=path.join(projectRoot,'logs','call-startup-'+new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(folder,{recursive:true});
// The Windows headless-shell package rejects native audio capture with
// NotSupportedError. Full Chromium exercises the media implementation users run.
const browser=await chromium.launch({headless:true,channel:'chromium',args:['--use-fake-device-for-media-stream']});
const context=await browser.newContext({viewport:{width:1280,height:900},permissions:['microphone'],
  ...(access?{httpCredentials:{username:access.username,password:access.password}}:{})});
const page=await context.newPage();
const report={verified:false,transport:remote?'authenticated notebook HTTPS':'local browser',
  microphone:ignored?'simulated unanswered permission request':'native getUserMedia with synthetic hardware',
  autoplay:'browser default',events:[],resources:[],errors:[]};
const began=Date.now();
const relevant=url=>{const route=new URL(url).pathname;return route.includes('/assets/')&&/speechDetector|ort-wasm|silero|vad\.worklet/.test(route)||route.startsWith('/api/voice/');};
page.on('pageerror',error=>report.errors.push(error.message));
page.on('response',response=>{if(relevant(response.url()))report.resources.push({path:new URL(response.url()).pathname,status:response.status(),atMs:Date.now()-began});});
page.on('requestfailed',request=>{if(relevant(request.url()))report.resources.push({path:new URL(request.url()).pathname,failure:request.failure()?.errorText,atMs:Date.now()-began});});
try{
  await page.addInitScript(({ignored})=>{
    const probe=window.callStartupProbe={contexts:[],streams:[],microphone:{requested:0,resolved:0,rejected:0},events:[]};
    const Audio=window.AudioContext;
    window.AudioContext=class extends Audio{constructor(...args){super(...args);probe.contexts.push(this);}};
    const getUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async options=>{
      probe.microphone.requested++;
      if(ignored&&probe.microphone.requested===1)await new Promise(resolve=>{probe.allowPending=resolve;});
      try{const stream=await getUserMedia(options);probe.streams.push(stream);probe.microphone.resolved++;return stream;}
      catch(error){probe.microphone.rejected++;probe.microphone.error={name:error.name,message:error.message};throw error;}
    };
  },{ignored});
  await page.goto(origin+'/#operator');
  if(process.argv.includes('--device-check')){
    report.deviceChecks=await page.evaluate(async()=>{
      const results=[];
      for(const audio of [true,{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},
        {echoCancellation:false,noiseSuppression:false,autoGainControl:false}]){
        try{const stream=await navigator.mediaDevices.getUserMedia({audio});results.push({audio,ok:true});stream.getTracks().forEach(track=>track.stop());}
        catch(error){results.push({audio,ok:false,name:error.name,message:error.message});}
      }
      return results;
    });
    report.verified=report.deviceChecks.every(value=>value.ok);
    if(!report.verified)process.exitCode=1;
  }else{
  await page.getByRole('textbox',{name:'Task or message'}).waitFor({timeout:60000});
  const created=page.waitForResponse(response=>response.url().endsWith('/api/operator/conversations')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'New',exact:true}).click();
  const conversation=await(await created).json();
  await page.waitForFunction(id=>document.querySelector('select[aria-label="Task conversation"]')?.value===id,conversation.id);
  await page.getByRole('button',{name:'Call JARVIS',exact:true}).click();
  const deadline=Date.now()+70000;
  while(Date.now()<deadline){
    const state=await page.evaluate(()=>{
      const probe=window.callStartupProbe;
      return {phase:document.querySelector('.jarvis-call[open] .call-layout')?.getAttribute('data-phase'),
        status:document.querySelector('.jarvis-call[open] .call-status')?.textContent,
        hint:document.querySelector('.jarvis-call[open] .call-hint')?.textContent,
        microphone:probe.microphone,contexts:probe.contexts.map(value=>value.state),secureContext:window.isSecureContext};
    });
    const key=JSON.stringify(state);
    if(report.events.at(-1)?.key!==key)report.events.push({...state,key,atMs:Date.now()-began});
    if(['listening','error'].includes(state.phase))break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  report.state=report.events.at(-1);
  report.assetTransfers=await page.evaluate(()=>performance.getEntriesByType('resource')
    .filter(value=>/\/assets\/(?:speechDetector|silero|ort-wasm|vad\.worklet)/.test(new URL(value.name).pathname))
    .map(value=>({path:new URL(value.name).pathname,encodedBytes:value.encodedBodySize,decodedBytes:value.decodedBodySize,durationMs:Math.round(value.duration)})));
  report.browser=browser.version();
  report.devices=await page.evaluate(async()=>({permission:(await navigator.permissions.query({name:'microphone'})).state,
    kinds:(await navigator.mediaDevices.enumerateDevices()).map(value=>value.kind)}));
  await page.locator('.jarvis-call[open]').screenshot({path:path.join(folder,'call.png')});
  assert.equal(report.state.phase,ignored?'error':'listening',ignored?'Unanswered microphone permission must end with an actionable error, not hang.':'The real media API/default audio policy must connect.');
  if(ignored){
    assert.match(report.state.hint,/microphone|permission/i);
    assert.equal(await page.getByText('Listening to you',{exact:true}).count(),0);
    assert(report.state.contexts.every(state=>state==='closed'),'Timeout must close browser audio');
    await page.evaluate(()=>window.callStartupProbe.allowPending());
    await page.waitForFunction(()=>window.callStartupProbe.streams.length===1&&window.callStartupProbe.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));
    report.latePermissionTracksReleased=true;
    await page.getByRole('button',{name:'Try call again',exact:true}).click();
    await page.locator('.jarvis-call[open] .call-layout[data-phase="listening"]').waitFor({timeout:60000});
    report.retryConnected=true;
  }else assert.equal(report.state.microphone.resolved,1);
  await page.getByRole('button',{name:'Hang up',exact:true}).click();
  report.released=await page.evaluate(()=>window.callStartupProbe.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));
  assert(report.released);assert.equal(report.errors.length,0);report.verified=true;
  }
}catch(error){report.failure=error.message;process.exitCode=1;}
finally{
  report.events.forEach(event=>delete event.key);
  writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));
  await browser.close();
  console.log(JSON.stringify({...report,artifacts:folder},null,2));
}
