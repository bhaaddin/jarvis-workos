import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Actor,ObjectValue,ToolContext} from './contracts.js';
import {assert,OperatorError} from './errors.js';
import {packageRoot,projectRoot} from './config.js';
import {runProcess} from './processes.js';
import {findFiles,documentPath,pythonDocument,createDocument} from './files.js';
import {browserRead} from './web-tools.js';
import {object} from './store-context.js';
import {analyzeTables} from './table-analysis.js';
import {codeWorkspace} from './code-tools.js';
import {aresLookup, cnbRates, czechCalc} from './czech.js';
import {transitPlan} from './transit.js';

async function hub(endpoint:string,input:ObjectValue|undefined,signal:AbortSignal):Promise<ObjectValue>{
  const token=process.env.JARVIS_PROJECT_TOKEN;
  assert(token,'PROJECT_CONNECTION_MISSING','The local Project Hub connection is not configured.',503);
  const response=await fetch('http://127.0.0.1:18791'+endpoint,{method:input?'POST':'GET',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{}),signal,redirect:'error'});
  assert(response.ok,'PROJECT_READ_FAILED','The local project/source service rejected the request.',response.status===401?503:502);
  return object(await response.json());
}

export async function taskRead(name:string,input:ObjectValue,context:ToolContext):Promise<ObjectValue>{
  if(name==='projects.read')return hub('/api/tool',input,context.signal);
  if(name==='calculate')return hub('/api/calculate',input,context.signal);
  if(name==='weather')return hub('/api/weather',input,context.signal);
  if(name==='skills.search')return hub('/api/capabilities?action='+encodeURIComponent(String(input.action??'search'))+'&q='+encodeURIComponent(String(input.query??''))+'&limit=15',undefined,context.signal);
  if(name==='files.find')return findFiles(context.actor,input);
  if(name==='documents.read')return pythonDocument({operation:'read',path:await documentPath(context.actor,input.root,input.path),start:input.start??1,limit:input.limit??10},context.signal);
  if(name==='tables.analyze')return analyzeTables(input,context);
  if(name==='web.read')return browserRead(input,context.signal);
  if(name==='ares.lookup')return aresLookup(input,context.signal);
  if(name==='cnb.rates')return cnbRates(input,context.signal);
  if(name==='czech.calc')return czechCalc(input);
  if(name==='transit.plan')return transitPlan(input,context.signal);
  if(name==='computer.read'){
    const names=Array.isArray(input.names)?input.names.map(String):[];
    assert(names.length<=20&&names.every(value=>/^[a-zA-Z0-9 ._-]{1,80}$/.test(value)),'PROCESS_NAME_INVALID','Use process names, not commands.');
    assert(['health','processes','open','edit','search'].includes(String(input.action)),'COMPUTER_ACTION_INVALID','Choose health, processes, open, edit or search.');
    const payload: Record<string, unknown> = {operation:input.action,names,details:input.details===true};
    if (typeof input.target === 'string') payload.target = input.target.slice(0, 500);
    if (typeof input.pattern === 'string') payload.pattern = input.pattern.slice(0, 100);
    if (typeof input.root === 'string') payload.root = input.root.slice(0, 500);
    const response=await runProcess('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(packageRoot,'scripts/computer.ps1')],
      {signal:context.signal,input:JSON.stringify(payload),maximum:180000,timeoutMs:15000});
    assert(response.code===0,'COMPUTER_INSPECTION_FAILED','Windows inspection did not complete.',503);return object(JSON.parse(response.stdout.replace(/^\uFEFF/,'')));
  }
  if(name==='github.read'){
    const repo=String(input.repository??'');
    assert(!repo||/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo),'GITHUB_REPOSITORY_INVALID','Use owner/repository.');
    let args:string[];
    if(input.action==='repositories')args=['repo','list','--limit','30','--json','nameWithOwner,description,url,isPrivate'];
    else {assert(repo,'GITHUB_REPOSITORY_REQUIRED','Select an owner/repository.');args=input.action==='issues'
      ?['issue','list','--repo',repo,'--limit','30','--json','number,title,state,url,updatedAt']
      :input.action==='pull_requests'?['pr','list','--repo',repo,'--limit','30','--json','number,title,state,url,updatedAt']
      :['repo','view',repo,'--json','nameWithOwner,description,url,defaultBranchRef'];}
    const response=await runProcess('gh',args,{signal:context.signal,timeoutMs:20000,maximum:180000});
    assert(response.code===0,'GITHUB_CONNECTION_REQUIRED','GitHub could not complete the read. Check the local gh account and repository access.',503);
    return {data:JSON.parse(response.stdout),observedAt:new Date().toISOString()};
  }
  throw new OperatorError('SERVICE_UNAVAILABLE','This task integration is not registered.',409);
}

export async function taskEffect(name:string,input:ObjectValue,context:ToolContext):Promise<ObjectValue>{
  if(name==='documents.create')return createDocument(context.actor,context.actionId,input,context.signal);
  if(name==='browser.run')return browserRead(input,context.signal,true);
  if(name==='sandbox.execute'){
    const container='jarvis-task-'+context.actionId;
    const image='ghcr.io/openclaw/openclaw:2026.9.6@sha256:0a5ff5e682e62afa19149df126aa50063bf65ef885b5c94713ce32dc0eb12e15';
    // Generated code runs only inside an actual isolated container. No host
    // filesystem/profile/secret/Docker socket is mounted or passed through.
    const wrapper="process.stdin.setEncoding('utf8');let s='';for await(const c of process.stdin)s+=c;const r=JSON.parse(s);globalThis.input=r.input;await import('data:text/javascript;base64,'+Buffer.from(r.code).toString('base64'));";
    try {
      const response=await runProcess('docker',['run','--rm','-i','--name',container,'--label','jarvis.operator.action='+context.actionId,
        '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--pids-limit','64',
        '--memory','256m','--memory-swap','256m','--cpus','1','--tmpfs','/tmp:rw,noexec,nosuid,size=16m',
        '--user','65534:65534','--workdir','/tmp','--log-driver','none','--entrypoint','/usr/bin/timeout',image,'--signal=KILL','20s','node','--input-type=module','-e',wrapper],
        {signal:context.signal,input:JSON.stringify({code:input.code,input:input.input??null}),timeoutMs:25000,maximum:64000});
      return {exitCode:response.code,stdout:response.stdout,stderr:response.stderr,network:'none',hostFilesMounted:false,language:'javascript',observedAt:new Date().toISOString()};
    } finally {
      // Aborting the Docker client does not stop its container; explicitly
      // retire only the action-specific container created above.
      await runProcess('docker',['rm','--force',container],{signal:AbortSignal.timeout(10000),timeoutMs:9000,maximum:4000}).catch(()=>{});
    }
  }
  if(name==='code.workspace')return codeWorkspace(input,context);
  throw new OperatorError('SERVICE_UNAVAILABLE','This effect adapter is unavailable.',409);
}
