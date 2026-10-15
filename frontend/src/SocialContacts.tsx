import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Check,Copy,Download,ExternalLink,LoaderCircle,Search,Users,X} from 'lucide-react';
import {api} from './api';
import './social.css';

type Platform='instagram'|'tiktok';
type Connection={platform:Platform;hasSession:boolean;state:string;loginId:string|null;expiresAt:number|null;label:string|null;savedAt:string|null};
type Contact={id:string;revision:number;platform:Platform;handle:string;url:string;displayName:string;bio:string;followers:string|null;emails:string[];phones:string[];websites:string[];
  stage:string;notes:string;draft:string;draftPurpose:string;matchReason:string;evidenceQuote:string;assessmentStale:boolean;observedAt:string;sourceState:string;purpose:string;query:string};
type SearchRecord={id:string;brief:{query:string;location:string;purpose:string};status:string;requested:number;saved:number;issues:Array<{platform:string;state:string;message?:string}>;observedAt:string};
type Props={conversationId:string;runTask:(text:string)=>Promise<string>;stopTask:()=>void;busy:boolean};
const base='/api/operator/social';
const errorText=(error:unknown)=>error instanceof Error?error.message:'The social-contact operation could not complete.';
const platformLabel=(value:Platform)=>value==='instagram'?'Instagram':'TikTok';
const connectionLabel:Record<string,string>={not_connected:'Not signed in',awaiting_login:'Sign-in window open on PC',session_saved:'Session saved — ready to check',read_verified:'Profile reads verified',
  login_required:'Sign in again',challenge_required:'Platform verification needed',platform_unavailable:'Platform unavailable',no_visible_results:'No inspectable search results',
  login_expired:'Sign-in window timed out — open it again',login_closed:'Sign-in window closed before saving',rate_limited:'Platform rate limit — wait before another search',
  saving_session:'Saving verified sign-in…',save_failed:'Automatic save needs attention — try Save connection',login_permission_changed:'Account permissions changed; sign-in stopped'};
const pendingConnection=(value:Connection)=>['awaiting_login','saving_session','save_failed'].includes(value.state);

export function SocialContacts({conversationId,runTask,stopTask,busy}:Props){
  const [connections,setConnections]=useState<Connection[]>([]),[contacts,setContacts]=useState<Contact[]>([]),[searches,setSearches]=useState<SearchRecord[]>([]);
  const [query,setQuery]=useState('fitness creators'),[location,setLocation]=useState('Prague'),[languages,setLanguages]=useState('Czech, English'),[purpose,setPurpose]=useState('Paid collaboration');
  const [limit,setLimit]=useState(20),[platforms,setPlatforms]=useState<Platform[]>(['instagram','tiktok']),[urls,setUrls]=useState('');
  const [filter,setFilter]=useState(''),[stage,setStage]=useState('all'),[selected,setSelected]=useState<Contact|null>(null),[picked,setPicked]=useState<string[]>([]);
  const [working,setWorking]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=async(signal?:AbortSignal)=>{
    const [account,list,history]=await Promise.all([api<{connections:Connection[]}>(base+'/connections',undefined,{signal}),api<{contacts:Contact[]}>(base+'/contacts',undefined,{signal}),api<{searches:SearchRecord[]}>(base+'/searches',undefined,{signal})]);
    if(signal?.aborted)return;setConnections(account.connections);setContacts(list.contacts);setSearches(history.searches);
  };
  useEffect(()=>{const controller=new AbortController();void load(controller.signal).catch(cause=>{if(!controller.signal.aborted)setError(errorText(cause));});return()=>controller.abort();},[]);
  const pendingLogin=connections.some(pendingConnection);
  useEffect(()=>{
    if(!pendingLogin)return;
    const controller=new AbortController(),timer=setInterval(()=>{void api<{connections:Connection[]}>(base+'/connections',undefined,{signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted){setConnections(value.connections);if(value.connections.length===2&&value.connections.every(item=>item.hasSession&&!pendingConnection(item)))setNotice('Both sessions are saved privately. Profile access will be checked during research.');}}).catch(()=>{});},2000);
    return()=>{clearInterval(timer);controller.abort();};
  },[pendingLogin]);
  const accountAction=async(platform:Platform,action:'start'|'save'|'disconnect'|'close',loginId?:string|null)=>{
    setWorking(platform);setError('');setNotice(action==='start'?'Opening a separate '+platformLabel(platform)+' sign-in window on the PC…':'');
    try{await api(base+'/connections/'+platform+'/'+action,action==='save'||action==='close'?{loginId}:{});await load();
      setNotice(action==='start'?'A separate sign-in window is open on the PC. Complete login and verification there. JARVIS will save the session privately and close the window automatically.':action==='save'?'Session saved privately. Profile access will be checked during research.':'Connection updated.');}
    catch(cause){setError(errorText(cause));}finally{setWorking('');}
  };
  const task=async(prompt:string)=>{
    setWorking('research');setError('');setNotice('');
    try{const answer=await runTask(prompt);await load();setNotice(answer.trim()?answer.slice(0,1200)+(answer.length>1200?'… Full response is in Assistant.':''):'Task finished. Review the saved profiles, source states and any platform limitations below.');}
    catch(cause){setError(errorText(cause));await load().catch(()=>{});}finally{setWorking('');}
  };
  const search=()=>{
    const known=urls.split(/\s+/).map(value=>value.trim()).filter(Boolean);
    if(known.length>20){setError('Provide up to 20 known profile URLs.');return;}
    const brief={query:query.trim(),location:location.trim(),languages:languages.trim(),purpose:purpose.trim(),platforms,limit,...(known.length?{profileUrls:known}:{})};
    void task('Find and save public social-profile candidates using the connected social research tool with this brief: '+JSON.stringify(brief)+
      '. Then review saved profiles in batches of up to five and save source-supported match explanations with exact evidence quotations. Shortlist clear matches; leave unknown location/language criteria unverified. Report the actual number observed and any login, verification or partial-result limits. Do not invent contact details, mark contacted, or send messages.');
  };
  const draft=(ids:string[])=>{void task('Read the saved social contacts with these IDs: '+JSON.stringify(ids)+'. Review their actual source evidence against this outreach purpose: '+purpose+
    '. Save a concise personalized outreach draft for each using the social contact update tool and current revisions. Explain a genuine match only with an exact quotation from sourceText; leave unknown criteria unverified. Do not invent a brand, budget, relationship or claim to have watched content. Use Czech or English as supported by the profile and brief. Draft only; do not send or mark contacted.');};
  const save=async(contact:Contact,values:Partial<Contact>)=>{
    const response=await api<{ok:boolean;status?:string;error?:{message?:string}}>('/api/operator/tools/invoke',{conversationId,requestId:crypto.randomUUID(),tool:'jarvis_social_contact_update',
      input:{edits:[{id:contact.id,expectedRevision:contact.revision,...values}],_confidence:'high'}});
    if(!response.ok||response.status!=='succeeded')throw new Error(response.error?.message??'The contact edit was not completed. Refresh the saved state.');
    await load();
  };
  const listed=contacts.filter(contact=>(stage==='all'||contact.stage===stage)&&[contact.handle,contact.displayName,contact.bio,contact.matchReason].join(' ').toLowerCase().includes(filter.toLowerCase()));
  const canSearch=query.trim()&&platforms.length>0&&platforms.every(platform=>connections.some(value=>value.platform===platform&&value.hasSession));
  const unavailable=working!==''||busy;
  return <section className="social-workspace" aria-label="Social contacts">
    <header className="social-heading"><div><p className="section-label">Search → review → reach out</p><h2><Users size={25}/> Social contacts</h2><p>Find relevant Instagram and TikTok profiles. Keep evidence, public contact details and drafts in one place.</p></div>
      <button className="button" onClick={()=>{void load().catch(cause=>setError(errorText(cause)));}}>Refresh</button></header>
    {error&&<p className="operator-error" role="alert">{error}</p>}{notice&&<p className="social-notice" role="status">{notice}</p>}
    <div className="social-connections">{(['instagram','tiktok'] as const).map(platform=>{
      const connection=connections.find(value=>value.platform===platform);
      return <article className="operator-card" key={platform}><h3>{platformLabel(platform)}</h3><p>{connectionLabel[connection?.state??'not_connected']??connection?.state.replaceAll('_',' ')}</p>
        {connection?.savedAt&&<small>Session saved {new Date(connection.savedAt).toLocaleString()}</small>}
        {connection&&pendingConnection(connection)?<><p>Sign in on the PC (through TeamViewer if needed). Complete verification directly on the platform. JARVIS saves the session and closes the window automatically once ready.</p>
          <div className="operator-row"><button className="button" disabled={unavailable||connection.state==='saving_session'} onClick={()=>void accountAction(platform,'save',connection.loginId)}>Save {platformLabel(platform)} connection</button>
            <button className="button" disabled={unavailable} onClick={()=>void accountAction(platform,'close',connection.loginId)}>Close sign-in</button></div></>
          :<div className="operator-row"><button className="button" disabled={unavailable} onClick={()=>void accountAction(platform,'start')}>Sign in to {platformLabel(platform)}</button>
            {connection?.hasSession&&<button className="button" disabled={unavailable} onClick={()=>void accountAction(platform,'disconnect')}>Disconnect</button>}</div>}
      </article>;
    })}</div>
    <form className="operator-card social-brief" onSubmit={event=>{event.preventDefault();search();}}>
      <h3>Who are you looking for?</h3><div className="social-fields">
        <label>Niche / keywords<input value={query} maxLength={200} required onChange={event=>setQuery(event.target.value)}/></label>
        <label>Location<input value={location} maxLength={100} onChange={event=>setLocation(event.target.value)}/></label>
        <label>Languages<input value={languages} maxLength={100} onChange={event=>setLanguages(event.target.value)}/></label>
        <label>Profiles to research<input type="number" min={1} max={20} value={limit} onChange={event=>setLimit(Number(event.target.value))}/></label>
      </div><label>Outreach purpose / offer<textarea value={purpose} maxLength={500} onChange={event=>setPurpose(event.target.value)}/></label>
      <div className="operator-row social-platform-picks">{(['instagram','tiktok'] as const).map(platform=><label key={platform}><input type="checkbox" checked={platforms.includes(platform)} onChange={event=>setPlatforms(values=>event.target.checked?[...values,platform]:values.filter(value=>value!==platform))}/>{platformLabel(platform)}</label>)}</div>
      <details><summary>Already have profile links?</summary><label>Known profile URLs (one per line)<textarea value={urls} onChange={event=>setUrls(event.target.value)} placeholder="https://www.instagram.com/profile/"/></label><small>These profiles can be inspected directly instead of using site search.</small></details>
      <div className="operator-row"><button className="button primary" disabled={unavailable||!canSearch}><Search size={16}/>{working==='research'?'Researching…':'Find and save profiles'}</button>
        {(busy||working==='research')&&<button className="button" type="button" onClick={stopTask}>Stop current task</button>}
        {!canSearch&&<small>Save a session for every selected platform first.</small>}</div>
      <small>Results are candidates. Review niche, location and language evidence before choosing whom to contact. This workflow does not send messages.</small>
    </form>
    {searches[0]&&<div className="social-last-search" role="status"><strong>Last search: {searches[0].saved} saved / {searches[0].requested} requested · {searches[0].status}</strong>
      {searches[0].issues.map((issue,index)=><p key={index}>{issue.platform}: {issue.state.replaceAll('_',' ')}{issue.message?' — '+issue.message:''}</p>)}</div>}
    <div className="social-toolbar"><label>Filter saved contacts<input value={filter} onChange={event=>setFilter(event.target.value)} placeholder="Name, bio or match reason"/></label>
      <label>Stage<select aria-label="Filter by contact stage" value={stage} onChange={event=>setStage(event.target.value)}>{['all','new','shortlisted','contacted','dismissed'].map(value=><option key={value}>{value}</option>)}</select></label>
      <a className="button" href={base+'/contacts/export'} download><Download size={16}/>Export CSV</a>
      <button className="button" disabled={unavailable||picked.length===0} onClick={()=>draft(picked)}>Draft selected ({picked.length}/5)</button></div>
    <p className="muted">{listed.length} shown · {contacts.length} saved (most recent 100). “Contacted” is your manual tracking status.</p>
    {contacts.length===0?<div className="social-empty"><Users size={28}/><h3>Your shortlist will appear here</h3><p>Connect the platforms, enter a search brief and inspect the resulting profiles.</p></div>:
      <div className="social-results">{listed.map(contact=><article className="social-contact operator-card" key={contact.id}>
        <div className="social-contact-title"><input type="checkbox" aria-label={'Select '+contact.handle} checked={picked.includes(contact.id)} disabled={!picked.includes(contact.id)&&picked.length>=5}
          onChange={event=>setPicked(values=>event.target.checked?[...values,contact.id]:values.filter(value=>value!==contact.id))}/>
          <div><h3>{contact.displayName||contact.handle}</h3><a href={contact.url} target="_blank" rel="noreferrer">{platformLabel(contact.platform)} · @{contact.handle} <ExternalLink size={12}/></a></div><span className="badge">{contact.stage}</span></div>
        <p className="social-bio">{contact.bio}</p><small>{contact.followers?contact.followers+' followers shown · ':''}{contact.sourceState.replaceAll('_',' ')} · observed {new Date(contact.observedAt).toLocaleString()}</small>
        <p>{contact.matchReason||'Match not yet assessed — review the observed profile.'}</p>{contact.evidenceQuote&&<blockquote>{contact.evidenceQuote}</blockquote>}
        {contact.assessmentStale&&<p className="error-text">Profile evidence changed; review the earlier assessment.</p>}
        <div className="social-contact-details">{contact.emails.map(email=><a key={email} href={'mailto:'+encodeURIComponent(email)}>{email}</a>)}{contact.phones.map(phone=><span key={phone}>{phone}</span>)}
          {contact.websites.map(website=><a href={website} key={website} target="_blank" rel="noreferrer">{website} <ExternalLink size={12}/></a>)}
          {!contact.emails.length&&!contact.phones.length&&<small>No public email/phone observed. Open the profile for its available contact options.</small>}</div>
        {contact.draft&&<details><summary>Saved message draft</summary><p>{contact.draft}</p><small>Purpose: {contact.draftPurpose||contact.purpose}</small></details>}
        <div className="operator-row"><button className="button" disabled={unavailable} onClick={()=>setSelected(contact)}>Review / edit</button>
          <button className="button" disabled={unavailable} onClick={()=>draft([contact.id])}>Generate draft</button>
          {contact.draft&&<button className="button" onClick={()=>{void navigator.clipboard.writeText(contact.draft).then(()=>setNotice('Draft copied. Send it yourself from the profile or your email app.')).catch(()=>setError('Clipboard access failed; open Review / edit and copy the draft.'));}}><Copy size={14}/>Copy draft</button>}</div>
      </article>)}</div>}
    {selected&&<ContactEditor contact={selected} close={()=>setSelected(null)} save={async values=>{await save(selected,values);setSelected(null);setNotice('Contact updated. No message was sent.');}}/>}
  </section>;
}

function ContactEditor({contact,close,save}:{contact:Contact;close:()=>void;save:(values:Partial<Contact>)=>Promise<void>}){
  const [draft,setDraft]=useState(contact.draft),[notes,setNotes]=useState(contact.notes),[stage,setStage]=useState(contact.stage),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  useLayoutEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  return <dialog ref={dialog} className="social-editor operator-card" aria-labelledby="social-editor-title" onCancel={event=>{event.preventDefault();if(!busy)close();}}>
    <header className="operator-row"><h3 id="social-editor-title">Review @{contact.handle}</h3><button className="button" aria-label="Close contact editor" disabled={busy} onClick={close}><X size={16}/></button></header>
    <p>{contact.bio}</p><a href={contact.url} target="_blank" rel="noreferrer">Open source profile</a>
    <form onSubmit={event=>{event.preventDefault();setBusy(true);void save({draft,notes,stage}).catch(cause=>setError(errorText(cause))).finally(()=>setBusy(false));}}>
      <label>Message draft<textarea value={draft} maxLength={1500} onChange={event=>setDraft(event.target.value)}/></label>
      <label>Your notes<textarea value={notes} maxLength={2000} onChange={event=>setNotes(event.target.value)}/></label>
      <label>Stage<select aria-label="Contact stage" value={stage} onChange={event=>setStage(event.target.value)}>{['new','shortlisted','contacted','dismissed'].map(value=><option key={value}>{value}</option>)}</select></label>
      {error&&<p className="operator-error" role="alert">{error}</p>}
      <button className="button primary" disabled={busy}>{busy?<LoaderCircle size={16}/>:<Check size={16}/>}Save contact</button>
    </form><small>Observed profile/contact fields are read-only. Mark contacted only when you have actually reached out.</small>
  </dialog>;
}
