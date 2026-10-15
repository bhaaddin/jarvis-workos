import {forwardRef,useCallback,useEffect,useImperativeHandle,useRef,useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Bot,Check,Download,FileUp,LoaderCircle,Phone,Plus,Send,Square,X} from 'lucide-react';
import {api,waitFor,boundedApi,ApiError} from './api';
import {useVoice} from './useVoice';
import {CallScreen} from './CallScreen';
import {TaskRequests} from './taskRequests';
import {SocialContacts} from './SocialContacts';
import {FinancePanel} from './FinancePanel';
import './operator.css';

export type OperatorPanelHandle={startCall():void};
type TaskThreadHandle=OperatorPanelHandle&{runTask(text:string):Promise<string>;stopTask():void};
type Message={role:string;content:string|null;tool_call_id?:string;tool_calls?:Array<{id:string;function:{name:string}}>};
type Action={id:string;tool:string;state:string;reason:string;inputHash:string;fingerprint:string;input?:unknown;result?:unknown};
type Artifact={id:string;name:string;format:string;bytes:number;url:string};
type Run={id:string;state:string;result?:{text:string;toolResults:unknown[];completion?:'complete'|'incomplete'}|null;error?:{message?:string}|null};
type Skill={id:string;state:string;mode:string;missing:string[];reason?:string};
const base='/api/operator';
const errorText=(error:unknown)=>error instanceof Error?error.message:'The task could not complete.';
const uuid=/^[0-9a-f-]{36}$/i;
const toolLabels:Record<string,string>={jarvis_document_read:'Read document',jarvis_document_create:'Create document',jarvis_table_query:'Analyze table data',
  jarvis_projects:'Inspect project source',jarvis_calculate:'Verify calculation',jarvis_files:'Find files',jarvis_sportmedical:'Check Medical',
  jarvis_web:'Read web source',jarvis_remind_after:'Save reminder',jarvis_memory_remember:'Remember information',jarvis_memory_search:'Recall information',
  jarvis_social_research:'Research social profiles',jarvis_social_contacts:'Read contact evidence',jarvis_social_contact_update:'Save outreach drafts',jarvis_finance:'Read connected Finance',jarvis_code:'Change project code',jarvis_code_read:'Read project code',jarvis_ares:'Look up company',jarvis_cnb:'CNB rates',jarvis_czech_calc:'Czech business math',jarvis_owner_todo:'Owner checklist',jarvis_transit:'Plan transit'};
const request=<T,>(route:string,body?:unknown,signal?:AbortSignal)=>api<T>(base+route,body,{signal});
const examples=[
  'Check which Claude and OpenCode processes are running, and report free RAM and disk space.',
  'Create an Excel spending sheet: groceries 85, transport 24, utilities 110. Calculate the total and give me the download.',
  'Read the actual React version in the connected Medical frontend and cite the source line.',
  'Read https://example.com and summarize what the page actually says.',
  'Remind me in 10 minutes to review the invoices.',
];

export const OperatorPanel=forwardRef<OperatorPanelHandle,{voiceId:string}>(function OperatorPanel({voiceId},ref){
  const [conversations,setConversations]=useState<Array<{id:string}>>([]),[selected,setSelected]=useState(''),[error,setError]=useState('');
  const [loading,setLoading]=useState(true),[workspace,setWorkspace]=useState<'chat'|'contacts'|'finance'>('chat'),[threadBusy,setThreadBusy]=useState(false);
  const alive=useRef<AbortController|null>(null),thread=useRef<TaskThreadHandle>(null);
  useImperativeHandle(ref,()=>({startCall:()=>{setWorkspace('chat');thread.current?.startCall();}}),[]);
  useEffect(()=>{
    const controller=new AbortController();alive.current=controller;
    void (async()=>{
      const value=await request<{conversations:Array<{id:string}>}>('/conversations',undefined,controller.signal);
      controller.signal.throwIfAborted();
      const list=value.conversations.length?value.conversations:[await request<{id:string}>('/conversations',{},controller.signal)];
      controller.signal.throwIfAborted();setConversations(list);
      const saved=localStorage.getItem('jarvis-task-conversation');setSelected(list.find(item=>item.id===saved)?.id??list[0]!.id);setLoading(false);
    })().catch(cause=>{if(!controller.signal.aborted){setError(errorText(cause));setLoading(false);}});
    return()=>{controller.abort();alive.current=null;};
  },[]);
  useEffect(()=>{if(selected)localStorage.setItem('jarvis-task-conversation',selected);},[selected]);
  const [autoCall]=useState(()=>new URLSearchParams(location.search).has('call'));
  useEffect(()=>{
    if(!autoCall||!selected)return;
    const timer=setInterval(()=>{
      if(thread.current){clearInterval(timer);thread.current.startCall();
        history.replaceState(null,'',location.pathname+location.hash);}
    },400);
    const stop=setTimeout(()=>clearInterval(timer),15000);
    return()=>{clearInterval(timer);clearTimeout(stop);};
  },[autoCall,selected]);
  const create=async()=>{
    if(!alive.current)return;setLoading(true);
    try{const item=await request<{id:string}>('/conversations',{},alive.current.signal);if(alive.current.signal.aborted)return;setConversations(value=>[item,...value]);setSelected(item.id);setError('');}
    catch(cause){setError(errorText(cause));}finally{setLoading(false);}
  };
  return <section className="operator-panel">
    <div className="page-heading"><div><p className="section-label">Give me the job</p><h1>JARVIS Tasks</h1><p>Files, documents, your computer, projects and connected accounts.</p></div>
      <div className="operator-row"><select aria-label="Task conversation" value={selected} onChange={event=>setSelected(event.target.value)} disabled={loading}>
        {conversations.map((item,index)=><option key={item.id} value={item.id}>Conversation {conversations.length-index} · {item.id.slice(0,8)}</option>)}</select>
        <button className="button" disabled={loading} onClick={()=>void create()}><Plus size={16}/>New</button></div></div>
    {error&&<p className="operator-error" role="alert">{error}</p>}
    <nav className="operator-workspace-tabs" aria-label="Task workspace"><button className={'button '+(workspace==='chat'?'primary':'')} onClick={()=>setWorkspace('chat')}>Assistant</button>
      <button className={'button '+(workspace==='contacts'?'primary':'')} onClick={()=>setWorkspace('contacts')}>Social contacts</button>
      <button className={'button '+(workspace==='finance'?'primary':'')} onClick={()=>setWorkspace('finance')}>Finance</button></nav>
    {loading&&!selected&&<p role="status"><LoaderCircle className="spin" size={18}/>Connecting the task engine…</p>}
    {selected&&<div hidden={workspace!=='chat'}><TaskThread key={selected} ref={thread} id={selected} voiceId={voiceId} onBusyChange={setThreadBusy}/></div>}
    {selected&&workspace==='contacts'&&<SocialContacts conversationId={selected} busy={threadBusy}
      runTask={text=>thread.current?.runTask(text)??Promise.reject(new Error('The task engine is still connecting.'))} stopTask={()=>thread.current?.stopTask()}/>}
    {selected&&workspace==='finance'&&<FinancePanel key={selected} conversationId={selected} busy={threadBusy}
      ask={text=>{setWorkspace('chat');void thread.current?.runTask(text).catch(()=>{});}} talk={()=>{setWorkspace('chat');thread.current?.startCall();}}/>}
  </section>;
});

const TaskThread=forwardRef<TaskThreadHandle,{id:string;voiceId:string;onBusyChange:(busy:boolean)=>void}>(function TaskThread({id,voiceId,onBusyChange},ref){
  const [messages,setMessages]=useState<Message[]>([]),[draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState('Ready');
  const [actions,setActions]=useState<Action[]>([]),[artifacts,setArtifacts]=useState<Artifact[]>([]),[skills,setSkills]=useState<Skill[]>([]);
  const [modelName,setModelName]=useState('Local reasoning model');
  const [tasks,setTasks]=useState<Array<{id:string;data:{title:string;state:string;dueAt:number|null;dueAtLocal?:string;timezone?:string;notifiedAt:number|null}}>>([]);
  const [callOpen,setCallOpen]=useState(false),[uploading,setUploading]=useState(false),[refresh,setRefresh]=useState(0);
  const lifetime=useRef<AbortController|null>(null),bottom=useRef<HTMLDivElement>(null);
  const path='/conversations/'+id;
  const [requests]=useState(()=>new TaskRequests(requestId=>boundedApi(base+path+'/runs/'+requestId+'/cancel',{},undefined,8000),()=>{
    if(lifetime.current&&!lifetime.current.signal.aborted)setError("A previous task's cancellation could not be confirmed. Check its recorded state before repeating actions.");
  }));
  useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false);},[busy,onBusyChange]);
  useEffect(()=>{const controller=new AbortController();lifetime.current=controller;return()=>{controller.abort();requests.dispose();lifetime.current=null;};},[requests]);
  useEffect(()=>{
    const controller=new AbortController();
    void(async()=>{
      while(!controller.signal.aborted){
        try{
          const [history,queue,files,capabilities,reminders]=await Promise.all([
            request<{messages:Array<{message:Message}>}>(path+'/messages',undefined,controller.signal),request<{actions:Action[]}>('/actions',undefined,controller.signal),
             request<{artifacts:Artifact[]}>('/artifacts',undefined,controller.signal),request<{skills:Skill[];model?:{name:string}}>('/skills',undefined,controller.signal),request<{tasks:typeof tasks}>('/tasks',undefined,controller.signal)]);
           controller.signal.throwIfAborted();setMessages(history.messages.map(value=>value.message));setActions(queue.actions);setArtifacts(files.artifacts);setSkills(capabilities.skills);setTasks(reminders.tasks);
           if(capabilities.model)setModelName(capabilities.model.name.replace(/^jarvis-/,'').replace(':',' ').replace('-text-gpu',''));
        }catch(cause){if(controller.signal.aborted)return;setError(errorText(cause));}
        try{await waitFor(2500,controller.signal);}catch{return;}
      }
    })();return()=>controller.abort();
  },[id,path,refresh]);
  useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[messages.length]);
   const send=useCallback(async(text:string,parent?:AbortSignal,delivery:'text'|'voice'='text'):Promise<string>=>{
    if(!text.trim())throw new Error('Enter a task.');
    const execution=requests.begin(parent),requestId=execution.id,signal=execution.signal;setBusy(true);setError('');setStatus('Working');
    try{
       const accepted=await request<Run>('/chat',{conversationId:id,requestId,message:text,delivery,waitMs:20000},signal);signal.throwIfAborted();
       if(accepted.state==='completed'){setRefresh(value=>value+1);setStatus(accepted.result?.completion==='incomplete'?'Partial results — needs attention':'Completed');return accepted.result?.text??'';}
       if(['failed','cancelled'].includes(accepted.state))throw new Error(accepted.error?.message??'The task was cancelled.');
       const deadline=Date.now()+330000;
      while(Date.now()<deadline){
        const run=await request<Run>('/runs/'+requestId,undefined,signal);signal.throwIfAborted();setStatus(run.state);
         if(run.state==='completed'){setRefresh(value=>value+1);setStatus(run.result?.completion==='incomplete'?'Partial results — needs attention':'Completed');return run.result?.text??'';}
        if(['failed','cancelled'].includes(run.state))throw new Error(run.error?.message??'The task was cancelled.');
        await waitFor(350,signal);
      }
      throw new Error('The task is taking too long. Its recorded state remains available.');
    }catch(cause){if(!signal.aborted){setError(errorText(cause));setStatus('Needs attention');}throw cause;}
    finally{if(execution.finish()&&lifetime.current&&!lifetime.current.signal.aborted)setBusy(false);}
  },[id,requests]);
   const voice=useVoice('operator:'+id,voiceId,setDraft,setError,(text,signal)=>send(text,signal,'voice'));
  useEffect(()=>()=>{voice.cancel();},[voice.cancel]);
  const startCall=()=>{if(!voice.conversationSupported){setError('Use a microphone-enabled HTTPS browser for calls.');return;}setCallOpen(true);void voice.startConversation().catch(cause=>setError(errorText(cause)));};
  const stop=()=>{voice.cancel();setCallOpen(false);requests.cancel();setStatus('Cancellation requested');};
  useImperativeHandle(ref,()=>({startCall,runTask:text=>send(text),stopTask:stop}));
  const upload=async(file:File)=>{
    if(file.size>20*1024*1024){setError('Upload a file up to 20 MiB.');return;}setUploading(true);
    try{
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.onerror=()=>reject(new Error('File could not be read.'));reader.readAsDataURL(file);});
      if(!lifetime.current)return;
      const value=await request<{root:string;path:string}>('/files/upload',{name:file.name,data},lifetime.current.signal);
       if(!lifetime.current)return;setDraft(current=>(current?current+'\n':'')+`Attached document: root=${value.root}, path=${value.path}`);setError('');
    }catch(cause){setError(errorText(cause));}finally{setUploading(false);}
  };
  const pending=actions.filter(action=>['awaiting_approval','queued','running','uncertain'].includes(action.state));
  const currentMessages=messages.slice(messages.map(message=>message.role).lastIndexOf('user')+1);
  const completedIds=new Set(currentMessages.filter(message=>message.role==='tool').map(message=>message.tool_call_id));
  const steps=currentMessages.flatMap(message=>message.tool_calls??[]).filter(call=>call.function.name!=='jarvis_finish').slice(-6);
  return <><div className="operator-layout"><div className="operator-main">
     <div className="operator-status"><span className={busy?'badge amber':'badge green'}>{status}</span><span>{modelName}</span>
      <button className="button" onClick={startCall} disabled={busy}><Phone size={16}/>Talk</button>{busy&&<button className="button" onClick={stop}><Square size={15}/>Stop</button>}</div>
    <div className="operator-messages" aria-label="Task conversation messages">
      {!messages.some(message=>message.role==='user')&&<div className="operator-welcome"><Bot size={34}/><h2>Tell me what you need done.</h2><p>I can inspect the PC, work with documents, read projects, browse public pages and use your connected accounts.</p></div>}
      {messages.map((message,index)=>message.role==='tool'||message.tool_calls?.length?<details className="operator-tool" key={index}><summary>{message.role==='tool'?'Tool result':message.tool_calls?.map(call=>call.function.name).join(', ')}</summary><pre>{message.content}</pre></details>
        :<article className={'operator-message '+message.role} key={index}><strong>{message.role==='user'?'You':message.role==='system'?'Task update':'JARVIS'}</strong><div className="markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml>{message.content??''}</Markdown></div></article>)}
       {busy&&<div className="operator-thinking" role="status"><p><LoaderCircle className="spin" size={16}/>JARVIS is carrying out the task…</p>
         {steps.length>0&&<ul>{steps.map(step=><li key={step.id}>{completedIds.has(step.id)?'Result received':'In progress'} · {toolLabels[step.function.name]??step.function.name.replace('jarvis_','').replaceAll('_',' ')}</li>)}</ul>}</div>}<div ref={bottom}/>
    </div>
    {error&&<p className="operator-error" role="alert">{error}</p>}
    <form className="operator-composer" onSubmit={event=>{event.preventDefault();const text=draft;setDraft('');void send(text).catch(()=>{});}}>
      <textarea aria-label="Task or message" placeholder="Describe the job, or attach a document…" value={draft} maxLength={12000} onChange={event=>setDraft(event.target.value)} disabled={busy}/>
      <div className="operator-row"><label className="button operator-upload"><FileUp size={16}/>{uploading?'Uploading…':'Attach document'}<input type="file" accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.json" disabled={uploading||busy} onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value='';}}/></label>
        <button className="button primary" type="submit" disabled={busy||!draft.trim()}><Send size={16}/>Do this</button></div>
    </form>
    <div className="operator-examples">{examples.map(text=><button key={text} onClick={()=>setDraft(text)} disabled={busy}>{text}</button>)}</div>
    {pending.length>0&&<section><h2>Needs your attention</h2>{pending.map(action=><ActionCard key={action.id+action.state} action={action} changed={()=>setRefresh(value=>value+1)}/>)}</section>}
    <details><summary>Recent executed actions</summary>{actions.filter(action=>!pending.includes(action)).slice(0,12).map(action=><ActionCard key={action.id+action.state} action={action} changed={()=>setRefresh(value=>value+1)}/>)}</details>
  </div><aside className="operator-side">
     <RuntimeStatus/>
    <section className="operator-card"><h2>Your results</h2>{artifacts.length===0?<p>Created files appear here with real downloads.</p>:artifacts.map(file=><a className="operator-artifact" href={uuid.test(file.id)?base+'/artifacts/'+file.id+'/download':undefined} key={file.id} download><Download size={18}/><span>{file.name}<small>{file.format.toUpperCase()} · {file.bytes.toLocaleString()} bytes</small></span></a>)}</section>
    <section className="operator-card"><h2>Tasks & reminders</h2>{tasks.filter(task=>task.data.state==='open').map(task=><div className="operator-task" key={task.id}><strong>{task.data.title}</strong><small>{task.data.dueAtLocal?task.data.dueAtLocal+' '+task.data.timezone:task.data.dueAt?new Date(task.data.dueAt).toISOString():'No due time'}{task.data.notifiedAt?' · DUE':''}</small>
      <button className="button" onClick={()=>{void request('/tools/invoke',{conversationId:id,requestId:crypto.randomUUID(),tool:'jarvis_task_save',input:{action:'complete',id:task.id,_confidence:'high'}}).then(()=>setRefresh(value=>value+1)).catch(cause=>setError(errorText(cause)));}}><Check size={14}/>Done</button></div>)}{!tasks.some(task=>task.data.state==='open')&&<p>Ask JARVIS to remember a task or remind you at a time.</p>}</section>
    <ClinicConnection/>
    <MailConnection/>
    <details className="operator-card"><summary>Available tools</summary>{skills.map(skill=><p key={skill.id}><strong>{skill.id.replace('jarvis_','').replaceAll('_',' ')}</strong><small>{skill.state} · {skill.mode}{skill.missing.length?' · '+skill.missing.join(', '):''}{skill.reason?' · '+skill.reason:''}</small></p>)}</details>
  </aside></div>
    <audio ref={voice.audioRef} hidden/><CallScreen open={callOpen} project="JARVIS Tasks" state={voice.conversation} playbackPhase={voice.phase} playbackStatus={voice.status} audioVisual={voice.audioVisual}
      onHangUp={stop} onMute={muted=>{void voice.setMuted(muted).catch(cause=>setError(errorText(cause)));}} onResumeAudio={()=>{void voice.resumePlayback();}} onRetry={startCall}/>
  </>;
});

type RuntimeInfo={
  selected:{transport:string;model?:string;reasoning?:string|boolean;contextTokens?:number};
  resources:{profile:string;keepAliveSeconds:number;transition:string|null};
  model:{state:string;warm:boolean|null;reportedGpuBytes?:number|null;version?:string|null};
  inference:{requests:number;failures:number;cancellations?:number;active:number;medianModelMs:number|null;last:{elapsedMs:number;cancelled?:boolean;outputTokensPerSecond?:number|null;load_ms?:number}|null};
};
function RuntimeStatus(){
  const [value,setValue]=useState<RuntimeInfo|null>(null),[error,setError]=useState(''),[hidden,setHidden]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    void(async()=>{
      while(!controller.signal.aborted){
        try{const status=await request<RuntimeInfo>('/runtime',undefined,controller.signal);controller.signal.throwIfAborted();setValue(status);setError('');}
        catch(cause){if(controller.signal.aborted)return;if(cause instanceof ApiError&&cause.status===403){setHidden(true);return;}setError('Runtime diagnostics are unavailable.');}
        try{await waitFor(5000,controller.signal);}catch{return;}
      }
    })();return()=>controller.abort();
  },[]);
  if(hidden)return null;
  const states:Record<string,string>={ready:'Model loaded',cold:'Cold — loads on the next task',missing:'Selected model is not installed',offline:'Model service offline',context_mismatch:'Loaded context differs from configuration',gateway:'Gateway available'};
  return <details className="operator-card"><summary>Runtime & resources</summary>
    {error&&<p role="status">{error}</p>}
    {value&&<>
      <p><strong>{value.resources.transition?'Changing model resources':states[value.model.state]??value.model.state}</strong></p>
      <p>{value.resources.profile==='balanced'?'Balanced · model idle timeout15 minutes':'Interactive · model stays loaded'}</p>
      <p>Reasoning: {String(value.selected.reasoning??'configured')} · Context: {value.selected.contextTokens?.toLocaleString()??'configured'}</p>
      {typeof value.model.reportedGpuBytes==='number'&&<p>Model-reported GPU allocation: {(value.model.reportedGpuBytes/1024**3).toFixed(2)} GiB</p>}
      <p>{value.inference.active} active model calls · {value.inference.requests} calls · {value.inference.cancellations??0} cancelled · {value.inference.failures} failures since restart</p>
      {value.inference.last&&<p>Last model call: {(value.inference.last.elapsedMs/1000).toFixed(2)}s
        {value.inference.last.cancelled?' · cancelled':''}
        {typeof value.inference.last.outputTokensPerSecond==='number'?` · ${value.inference.last.outputTokensPerSecond.toFixed(1)} output tokens/s`:''}</p>}
      <small>Model timing excludes tools and audio. Resource changes use the local development CLI.</small>
    </>}
  </details>;
}

function ActionCard({action,changed}:{action:Action;changed():void}){
  const [detail,setDetail]=useState<Action|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);const alive=useRef(true);
  useEffect(()=>{alive.current=true;const controller=new AbortController();void request<Action>('/actions/'+action.id,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setDetail(value);}).catch(cause=>{if(!controller.signal.aborted)setError(errorText(cause));});return()=>{alive.current=false;controller.abort();};},[action.id]);
  const decide=async(decision:'approve'|'deny'|'cancel')=>{
    if(!detail||busy)return;setBusy(true);setError('');
    try{await request('/actions/'+action.id+(decision==='cancel'?'/cancel':'/decision'),decision==='cancel'?{}:{decision,inputHash:detail.inputHash,fingerprint:detail.fingerprint,eventKey:crypto.randomUUID()});if(alive.current)changed();}
    catch(cause){if(alive.current)setError(errorText(cause));}finally{if(alive.current)setBusy(false);}
  };
  return <article className="operator-action"><div className="operator-row"><strong>{action.tool.replace('jarvis_','').replaceAll('_',' ')}</strong><span className="badge">{action.state.replaceAll('_',' ')}</span></div>
    {detail&&<details open={action.state==='awaiting_approval'}><summary>{action.state==='awaiting_approval'?'Proposed action — review before approving':'Arguments and actual result'}</summary><pre>{JSON.stringify(action.state==='awaiting_approval'?detail.input:{input:detail.input,result:detail.result},null,2)}</pre></details>}
    {action.state==='awaiting_approval'&&<div className="operator-row"><button className="button primary" disabled={!detail||busy} onClick={()=>void decide('approve')}><Check size={15}/>Approve</button><button className="button" disabled={!detail||busy} onClick={()=>void decide('deny')}><X size={15}/>Deny</button></div>}
    {['queued','running'].includes(action.state)&&<button className="button" disabled={!detail||busy} onClick={()=>void decide('cancel')}>Cancel action</button>}
    {error&&<p role="alert" className="operator-error">{error}</p>}</article>;
}

function ClinicConnection(){
  const [status,setStatus]=useState<{connected:boolean;displayName?:string;configuredOrigin?:string;apiReachable?:boolean;apiProfile?:string;contractVerified?:boolean;message?:string}|null>(null),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();void request<typeof status>('/connections/clinic',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setStatus(value);}).catch(()=>{});return()=>controller.abort();},[]);
  return <section className="operator-card"><h2>SportMedical</h2>{status?.message&&<p>{status.message}{status.apiProfile&&status.apiProfile!=='unknown'?' Profile: '+status.apiProfile+'.':''}</p>}{status?.connected?<p className="operator-connected">Connected · {status.displayName}</p>:<><p>Connect your existing clinic sign-in to read real appointments, invoices and prices.</p><form onSubmit={event=>{event.preventDefault();setBusy(true);setError('');void request<NonNullable<typeof status>>('/connections/clinic',{email,password}).then(setStatus).catch(cause=>setError(errorText(cause))).finally(()=>{setPassword('');setBusy(false);});}}>
    <label>Clinic email<input type="email" autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} required/></label>
    <label>Clinic password<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required/></label>
    <button className="button" disabled={busy}>{busy?'Connecting…':'Connect SportMedical'}</button></form></>}
    {error&&<p className="operator-error" role="alert">{error}</p>}</section>;
}

function MailConnection(){
  const [status,setStatus]=useState<{connected:boolean;user?:string;sendingConfigured?:boolean}|null>(null),[values,setValues]=useState({imapHost:'',user:'',password:'',smtpHost:'',smtpPort:465}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();void request<typeof status>('/connections/mail',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setStatus(value);}).catch(()=>{});return()=>controller.abort();},[]);
  return <details className="operator-card"><summary>Email {status?.connected?'· connected':''}</summary>
    {status?.connected?<p>{status.user} · inbox connected{status.sendingConfigured?' · SMTP configured':''}</p>:<p>Connect an IMAP mailbox with its password/app password. Providers that require OAuth need that provider's OAuth connection.</p>}
    <form onSubmit={event=>{event.preventDefault();setBusy(true);setError('');void request<NonNullable<typeof status>>('/connections/mail',values).then(setStatus).catch(cause=>setError(errorText(cause))).finally(()=>{setValues(value=>({...value,password:''}));setBusy(false);});}}>
      {(['imapHost','user','password','smtpHost'] as const).map(key=><label key={key}>{{imapHost:'IMAP hostname (TLS 993)',user:'Mailbox username',password:'Password / app password',smtpHost:'SMTP hostname (optional)'}[key]}
        <input type={key==='password'?'password':'text'} autoComplete={key==='password'?'current-password':key==='user'?'username':'off'} value={values[key]} required={key!=='smtpHost'} onChange={event=>setValues(value=>({...value,[key]:event.target.value}))}/></label>)}
      <label>SMTP security<select value={values.smtpPort} onChange={event=>setValues(value=>({...value,smtpPort:Number(event.target.value)}))}><option value={465}>TLS · 465</option><option value={587}>Required STARTTLS · 587</option></select></label>
      <button className="button" disabled={busy}>{busy?'Checking mailbox…':'Connect email'}</button>
    </form>{error&&<p className="operator-error" role="alert">{error}</p>}
  </details>;
}
