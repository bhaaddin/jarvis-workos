import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';

// The owner approved this exact first search. Never log profile/contact payloads,
// credentials or the assistant's free-form answer; saved evidence stays encrypted.
const execute=process.argv.includes('--run');
const folder=path.join(projectRoot,'logs','social-live-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const report={verified:false,executionRequested:execute,mode:'real configured platform sessions',searchSubmitted:false};
try{
  const session=await fetch('http://127.0.0.1:18791/api/session',{signal:AbortSignal.timeout(10000)});
  if(!session.ok)throw new Error('Hub unavailable');const cookie=session.headers.get('set-cookie')?.split(';')[0];
  async function call(route,body){
    const response=await fetch('http://127.0.0.1:18791/api/operator'+route,{method:body?'POST':'GET',signal:AbortSignal.timeout(30000),headers:{Cookie:cookie,Origin:'http://127.0.0.1:18791',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw new Error('Application request failed: '+response.status);return response.json();
  }
  const status=await call('/social/connections');
  report.connections=status.connections.map(value=>({platform:value.platform,state:value.state,hasSession:value.hasSession}));
  report.required=report.connections.filter(value=>!value.hasSession||['awaiting_login','saving_session','save_failed'].includes(value.state)).map(value=>value.platform);
  report.ready=report.required.length===0;
  if(execute&&report.ready){
    const conversation=await call('/conversations',{}),requestId=randomUUID();report.requestId=requestId;
    const message='Find and save up to 20 fitness creator profiles in Prague, Czech or English, for a paid collaboration, using my connected Instagram and TikTok sessions. Review saved source evidence in small batches and save quoted match explanations. Leave unknown criteria unverified. Report actual observed counts and platform limitations. Do not send messages, follow accounts or mark anyone contacted.';
    let run=await call('/chat',{conversationId:conversation.id,requestId,message,delivery:'web',waitMs:20000});report.searchSubmitted=true;
    const deadline=Date.now()+330000;
    while(['queued','running'].includes(run.state)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1000));run=await call('/runs/'+requestId);}
    report.runState=run.state;
    report.tools=run.result?.toolResults?.map(value=>value.tool)??[];
    const searches=await call('/social/searches');
    const searchIds=new Set((run.result?.toolResults??[]).filter(value=>value.tool==='jarvis_social_research').map(value=>value.observation?.result?.data?.searchId).filter(Boolean));
    report.searches=searches.searches.filter(value=>searchIds.has(value.id)).map(value=>({id:value.id,status:value.status,requested:value.requested,saved:value.saved,
      issues:(value.issues??[]).map(issue=>({platform:issue.platform,state:issue.state}))}));
    const contacts=(await call('/social/contacts')).contacts.filter(value=>searchIds.has(value.searchId));
    report.observedProfiles=contacts.length;report.sourceReadProfiles=contacts.filter(value=>value.sourceState==='profile_read').length;
    report.assessedProfiles=contacts.filter(value=>value.matchReason&&value.evidenceQuote&&!value.assessmentStale).length;
    report.verified=run.state==='completed'&&report.sourceReadProfiles>=20&&report.assessedProfiles>=20;
    if(!report.verified)process.exitCode=2;
  }else if(execute){report.blocker='Complete the selected platform sign-ins in the dedicated browser windows.';process.exitCode=2;}
}catch(error){report.error=error.cause?.code??error.message;process.exitCode=1;}
finally{writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,artifacts:folder},null,2));}
