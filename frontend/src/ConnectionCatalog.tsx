import {useEffect,useState} from 'react';
import {RefreshCw,Search} from 'lucide-react';
import {api} from './api';
import type {Project} from './types';
import './connections.css';

type Entry=Project&{sourceAvailable:boolean;runtimeMode:string;connections:Array<{id:string;adapter:string;configured:boolean;description:string}>};
type Compatibility={project:string;sourceReady:boolean;mode:string;note:string;checkedAt:string;roots:Array<{root:string;state:string;adapter?:string;revision?:string|null;upstream?:string|null;sparse?:boolean;
  manifests?:Array<{path:string;state:string;requirements:Record<string,string>}>;sample?:{path:string}}>;
  runtimes:Array<{id:string;adapter:string;state:string;compatible:boolean;description:string;required:string[];baseUrl?:string;details?:Record<string,unknown>}>};

export function ConnectionCatalog({selected,onSelect}:{selected?:string;onSelect:(id:string)=>void}){
  const [query,setQuery]=useState(''),[entries,setEntries]=useState<Entry[]>([]),[total,setTotal]=useState(0),[error,setError]=useState('');
  const [detail,setDetail]=useState<Compatibility|null>(null),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>{void api<{projects:Entry[];total:number}>('/api/connections?limit=100&q='+encodeURIComponent(query),undefined,{signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted){setEntries(value.projects);setTotal(value.total);setError('');}})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Connection catalogue is unavailable.');});},180);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,revision]);
  useEffect(()=>{
    if(!selected){setDetail(null);return;}
    const controller=new AbortController();setBusy(true);setDetail(null);
    void api<Compatibility>('/api/connections/'+encodeURIComponent(selected)+(revision?'?refresh=1':''),undefined,{signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted)setDetail(value);})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Compatibility check failed.');})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[selected,revision]);
  return <section className="connection-catalog" aria-label="Project connections">
    <div className="section-heading"><div><h2>Connections & cloned projects</h2><p>Inspect source and check explicitly configured service contracts.</p></div>
      <button className="button" onClick={()=>setRevision(value=>value+1)}><RefreshCw size={16}/>Refresh checks</button></div>
    <label className="connection-search"><Search size={16}/><input aria-label="Find connected projects" placeholder="Search a project or cloned repository…" value={query} onChange={event=>setQuery(event.target.value)}/></label>
    {error&&<p className="error-text" role="alert">{error}</p>}
    <div className="connection-grid">
      <div className="connection-list" aria-label="Connected repository catalogue">
        <p className="muted">{total} matching projects{entries.length<total?` · first ${entries.length} shown`:''}</p>
        {entries.map(entry=><button key={entry.id} className={'connection-entry '+(entry.id===selected?'selected':'')} onClick={()=>onSelect(entry.id)}>
          <strong>{entry.name}</strong><code>{entry.id}</code>
          <small>{entry.metadata?.category?.replaceAll('-',' ')??'workspace'} · {entry.sourceAvailable?'source available':'source unavailable'} · {entry.runtimeMode.replaceAll('-',' ')}</small>
        </button>)}
      </div>
      <div className="connection-detail" aria-live="polite">
        {busy&&<p>Checking the selected connection…</p>}
        {detail&&<>
          <h3>Connection check</h3><p><strong>{detail.sourceReady?'Source inspection ready':'Source inspection needs attention'}</strong></p>
          <small>Checked {new Date(detail.checkedAt).toLocaleString()}</small>
          {detail.roots.map(root=><div className="connection-root" key={root.root}>
            <p><strong>{root.root}</strong> · {root.adapter??'unavailable'} · {root.state.replaceAll('_',' ')}</p>
            {root.revision&&<small>HEAD {root.revision.slice(0,12)}{root.sparse?' · sparse checkout':''}</small>}
            {root.sample&&<p>Verified source: <code>{root.sample.path}</code></p>}
            {root.upstream?.startsWith('https://')&&<a href={root.upstream} target="_blank" rel="noreferrer">Upstream repository</a>}
            {root.manifests?.some(item=>Object.keys(item.requirements).length>0)&&<details><summary>Declared development requirements</summary>
              {root.manifests.filter(item=>Object.keys(item.requirements).length>0).map(item=><p key={item.path}><code>{item.path}</code>: {Object.entries(item.requirements).map(([name,value])=>`${name} ${value}`).join(' · ')}</p>)}
              <small>Manifest requirements are source evidence, not proof that this checkout builds or runs here.</small>
            </details>}
          </div>)}
          <h3>Runtime connections</h3>
          {detail.runtimes.length===0?<p>Source-only connection. No runtime endpoint is declared.</p>:detail.runtimes.map(item=><div className="connection-runtime" key={item.id}>
            <strong>{item.id}</strong> <span className={'badge '+(item.compatible?'green':'amber')}>{item.compatible?'Probe passed':item.state.replaceAll('_',' ')}</span>
            <p>{item.description}</p><small>{item.adapter}{item.baseUrl?' · '+item.baseUrl:''}</small>
            {item.required.length>0&&<p>Needed: {item.required.join(', ')}</p>}
          </div>)}
          <p className="muted">{detail.note}</p>
        </>}
      </div>
    </div>
  </section>;
}
