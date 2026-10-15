import {useCallback,useEffect,useRef,useState} from 'react';
import {Activity,ArrowUpRight,BarChart3,LoaderCircle,Phone,RefreshCw} from 'lucide-react';
import {boundedApi} from './api';
import './finance.css';

type Unavailable={status:'unavailable';error:{code:string;message:string}};
type Paper={status:'ready';state:string|null;balance:number;allocatedBalance:number|null;currency:string;openPositions:number;maxPositions:number;strategy:string|null;
  closedTrades:number|null;daily:Array<{date:string|null;profitUSDT:number|null;trades:number|null}>;
  positions:Array<{id:number|null;pair:string|null;profitUSDT:number|null}>};
type Validation={label:string|null;epoch:number|null;trades:number;netUSDT:number;walletDrawdownUSDT:number};
type Study={status:'ready';id:string;verifiedAt:string|null;decision:string;holdoutEvaluated:boolean;paperParametersChanged:boolean;validation:Validation[]};
type Research={status:'ready';totalResults:number;results:Array<{filename:string|null;strategy:string|null;executedAt:string|null}>};
type Market={symbol:string;quoteCurrency:string;latestDate:string;latestClose:number;bars:Array<{date:string;close:number}>};
type News={headlines:Array<{title:string|null;publishedAt:string|null;url:string|null}>};
type Snapshot={status:'ready'|'partial';observedAt:string;cacheAgeMs:number;elapsedMs:number;paper:Paper|Unavailable;study:Study|Unavailable;research:Research|Unavailable};
type ReadResult={ok:boolean;error?:{message?:string};result?:{data:{observedAt:string;market?:Market;news?:News}}};
const symbols=['SPY','QQQ','AAPL','MSFT','NVDA','BTC-USD','ETH-USD','EURUSD','USDCZK','EURCZK'];
const value=(number:number|null|undefined,digits=4)=>number==null?'Unknown':number.toLocaleString('en-US',{maximumFractionDigits:digits});
const date=(text:string|null)=>text?new Date(text).toLocaleString():'Unknown';
const errorText=(error:unknown)=>error instanceof Error?error.message:'The Finance read could not complete.';
const unavailable=(section:Unavailable)=><p className="operator-error" role="status">{section.error.message}</p>;

export function FinancePanel({conversationId,busy,ask,talk}:{conversationId:string;busy:boolean;ask:(text:string)=>void;talk:()=>void}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[roundTrip,setRoundTrip]=useState<number|null>(null);
  const [symbol,setSymbol]=useState('SPY'),[market,setMarket]=useState<Market|null>(null),[news,setNews]=useState<News|null>(null),[reading,setReading]=useState(''),[dataError,setDataError]=useState('');
  const [marketObserved,setMarketObserved]=useState(''),[newsObserved,setNewsObserved]=useState('');
  const lifetime=useRef<AbortController|null>(null),refreshing=useRef<AbortSignal|null>(null),readingNow=useRef(false);
  const load=useCallback(async(signal:AbortSignal)=>{
    if(refreshing.current&&!refreshing.current.aborted)return;refreshing.current=signal;setLoading(true);setError('');const started=performance.now();
    try{const result=await boundedApi<Snapshot>('/api/operator/finance',undefined,signal,25000);signal.throwIfAborted();setSnapshot(result);setRoundTrip(Math.round(performance.now()-started));}
    catch(cause){if(!signal.aborted)setError(errorText(cause));}finally{if(refreshing.current===signal)refreshing.current=null;if(!signal.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{const controller=new AbortController();lifetime.current=controller;void load(controller.signal);return()=>{controller.abort();lifetime.current=null;};},[load]);
  const read=async(action:'market'|'news')=>{
    const signal=lifetime.current?.signal;if(!signal||readingNow.current)return;readingNow.current=true;setReading(action);setDataError('');
    try{
      const result=await boundedApi<ReadResult>('/api/operator/tools/invoke',{conversationId,requestId:crypto.randomUUID(),tool:'jarvis_finance',input:{action,...(action==='market'?{symbol}:{})}},signal,25000);
      signal.throwIfAborted();if(!result.ok||!result.result)throw new Error(result.error?.message??'No Finance observation was returned.');
      const data=result.result.data;
      if(action==='market'&&data.market){setMarket(data.market);setMarketObserved(data.observedAt);}
      else if(action==='news'&&data.news){setNews(data.news);setNewsObserved(data.observedAt);}
      else throw new Error('The Finance source returned an incomplete result.');
    }catch(cause){if(!signal.aborted)setDataError(errorText(cause));}finally{readingNow.current=false;if(!signal.aborted)setReading('');}
  };
  const paper=snapshot?.paper,study=snapshot?.study,research=snapshot?.research;
  return <section className="finance-workspace" aria-label="Finance workspace">
    <header className="finance-heading"><div><p className="section-label">Connected to JARVIS</p><h2><BarChart3 size={26}/>Finance</h2><p>Paper wallet, historical research and dated market data — directly from your native services.</p></div>
      <div className="operator-row"><span className="badge">Read-only · virtual funds</span><button className="button" disabled={loading} onClick={()=>{if(lifetime.current)void load(lifetime.current.signal);}}><RefreshCw size={16} className={loading?'spin':''}/>Refresh Finance</button>
        <button className="button" disabled={busy} onClick={talk}><Phone size={16}/>Talk to JARVIS</button></div></header>
    {error&&<p className="operator-error" role="alert">{error}{snapshot?' The snapshot below is the previous successful read.':''}</p>}
    {loading&&!snapshot&&<p role="status"><LoaderCircle className="spin" size={18}/>Reading the connected services…</p>}
    {snapshot&&<p className="finance-timing" role="status">{snapshot.status==='ready'?'Services connected':'Some sources unavailable'} · Observed {date(snapshot.observedAt)} · {roundTrip} ms round trip · {snapshot.elapsedMs} ms connector{snapshot.cacheAgeMs>0?` · cached ${(snapshot.cacheAgeMs/1000).toFixed(1)}s`:''}</p>}
    <div className="finance-grid">
      <article className="operator-card"><h3><Activity size={18}/>Paper wallet</h3>
        {paper?.status==='unavailable'?unavailable(paper):paper&&<><div className="finance-balance">{value(paper.balance)} <small>{paper.currency} virtual</small></div>
          <p>{paper.openPositions} / {paper.maxPositions} open positions · {paper.state??'Unknown state'}</p><p>Allocated: {value(paper.allocatedBalance)} USDT. The reserve is not profit.</p>
          <small>{paper.strategy??'Unknown strategy'} · {value(paper.closedTrades,0)} closed trades</small>
          {paper.positions.map((position,index)=><p key={position.id??index}>{position.pair??'Unknown pair'} · {value(position.profitUSDT)} USDT unrealized</p>)}
          <details><summary>Last seven daily results</summary><div className="finance-table"><table><thead><tr><th>Date</th><th>Net USDT</th><th>Trades</th></tr></thead><tbody>{paper.daily.map((row,index)=><tr key={row.date??index}><td>{row.date??'Unknown'}</td><td>{value(row.profitUSDT)}</td><td>{value(row.trades,0)}</td></tr>)}</tbody></table></div></details>
          <button className="button" disabled={busy} onClick={()=>ask('Read my connected Finance paper status and daily results. Briefly explain the actual activity and distinguish the virtual wallet from allocated capital.')}>Review with JARVIS <ArrowUpRight size={14}/></button></>}
      </article>
      <article className="operator-card"><h3>Locked study</h3>
        {study?.status==='unavailable'?unavailable(study):study&&<><span className="badge amber">No qualified candidate</span><p>Historical validation · {study.id}</p>
          <div className="finance-table"><table><thead><tr><th>Candidate</th><th>Net USDT</th><th>Wallet DD</th><th>Trades</th></tr></thead><tbody>{study.validation.map((row,index)=><tr key={row.label??index}><td>{row.epoch===null?'Baseline':`Epoch ${row.epoch}`}</td><td>{value(row.netUSDT)}</td><td>{value(row.walletDrawdownUSDT)}</td><td>{row.trades}</td></tr>)}</tbody></table></div>
          <p>Smaller losses are not profits. Holdout {study.holdoutEvaluated?'evaluated':'not evaluated'}; paper parameters {study.paperParametersChanged?'changed':'unchanged'}.</p><small>Study verified {date(study.verifiedAt)}</small>
          <button className="button" disabled={busy} onClick={()=>ask('Read the connected Finance locked study comparison. Explain the baseline versus the best validation candidate, distinguish reduced losses from profit, and report the holdout and promotion status.')}>Explain with JARVIS <ArrowUpRight size={14}/></button></>}
      </article>
      <article className="operator-card"><h3>Market data</h3><p>Dated daily bars from OpenBB / yfinance. These are not live quotes.</p>
        <form className="operator-row" onSubmit={event=>{event.preventDefault();void read('market');}}><label>Market symbol <select aria-label="Market symbol" value={symbol} onChange={event=>setSymbol(event.target.value)}>{symbols.map(item=><option key={item}>{item}</option>)}</select></label>
          <button className="button" disabled={reading!==''}>{reading==='market'?'Reading…':'Read daily prices'}</button></form>
        {market&&<><div className="finance-balance">{value(market.latestClose)} <small>{market.quoteCurrency} · {market.symbol}</small></div><p>Latest daily close: {market.latestDate}</p>
          <div className="finance-table"><table><thead><tr><th>Bar date</th><th>Close</th></tr></thead><tbody>{market.bars.slice(-5).map(row=><tr key={row.date}><td>{row.date}</td><td>{value(row.close)}</td></tr>)}</tbody></table></div><small>Retrieved {date(marketObserved)}</small></>}
      </article>
      <article className="operator-card"><h3>Research workbench</h3>
        {research?.status==='unavailable'?unavailable(research):research&&<><p>{research.totalResults} saved historical results · historical server mode</p><ul className="finance-history">{research.results.map((row,index)=><li key={row.filename??index}><strong>{row.strategy??'Unknown strategy'}</strong><small>{date(row.executedAt)}</small><small>{row.filename??'Unknown result'}</small></li>)}</ul></>}
      </article>
    </div>
    <article className="operator-card"><div className="operator-row"><h3>Public headlines</h3><button className="button" disabled={reading!==''} onClick={()=>void read('news')}>{reading==='news'?'Reading…':'Read BBC headlines'}</button></div><p>Source material for research. Headlines do not authorize actions.</p>
      {news&&<><ul className="finance-news">{news.headlines.map((item,index)=><li key={item.url??index}>{item.url?<a href={item.url} target="_blank" rel="noreferrer">{item.title??'Untitled'} <ArrowUpRight size={13}/></a>:item.title??'Untitled'}<small>{date(item.publishedAt)}</small></li>)}</ul><small>Retrieved {date(newsObserved)}</small></>}
      {dataError&&<p className="operator-error" role="alert">{dataError} Any earlier prices/headlines retain their displayed timestamps.</p>}
    </article>
  </section>;
}
