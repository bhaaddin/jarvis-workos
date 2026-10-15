import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {ObjectValue} from './contracts.js';
import {assert,OperatorError} from './errors.js';

export const financeSymbols=['SPY','QQQ','AAPL','MSFT','NVDA','BTC-USD','ETH-USD','EURUSD','USDCZK','EURCZK'];
const endpoint='http://127.0.0.1:18815/mcp';
export const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
export const number=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
const text=(value:unknown,limit:number):string|null=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,limit):null;

// Bound bytes while consuming HTTP/SSE, not after an unbounded response allocation.
export function boundedResponse(response:Response,maximum=512*1024):Response{
  if(!response.body)return response;
  let bytes=0;
  return new Response(response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){
    bytes+=chunk.byteLength;
    if(bytes>maximum)throw new OperatorError('FINANCE_RESPONSE_LIMIT','The Finance source returned too much data.',502);
    controller.enqueue(chunk);
  }})),{status:response.status,statusText:response.statusText,headers:response.headers});
}

export async function readMarket(action:'market'|'news',symbol:string|undefined,signal:AbortSignal):Promise<ObjectValue>{
  assert(action==='news'||financeSymbols.includes(symbol??''),'FINANCE_INPUT_INVALID','Choose a supported market symbol.');
  const client=new Client({name:'jarvis-workos-finance-read',version:'1.0.0'},{capabilities:{}});
  const transport=new StreamableHTTPClientTransport(new URL(endpoint),{
    requestInit:{redirect:'error'},reconnectionOptions:{initialReconnectionDelay:100,maxReconnectionDelay:100,reconnectionDelayGrowFactor:1,maxRetries:0},
    fetch:async(url,init)=>{
      assert(String(url)===endpoint,'FINANCE_ENDPOINT_REJECTED','Finance redirects and alternative endpoints are not permitted.',502);
      return boundedResponse(await fetch(url,{...init,redirect:'error',signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[])])}));
    },
  });
  try{
    // SDK 1.32.1's implementation allows an undefined sessionId getter, while
    // its Transport interface uses sessionId?:string (exactOptionalPropertyTypes).
    await client.connect(transport as Transport,{signal,timeout:20000});
    const today=new Date().toISOString().slice(0,10),start=new Date(Date.now()-14*86400000).toISOString().slice(0,10);
    const kind=symbol?.endsWith('-USD')?'crypto':symbol&&['EURUSD','USDCZK','EURCZK'].includes(symbol)?'currency':'equity';
    const result=await client.callTool({name:action==='news'?'news_rss':kind+'_price_historical',arguments:action==='news'
      ?{outlet:'bbc',limit:5,fetch_body:false}:{symbol,provider:'yfinance',start_date:start,end_date:today,interval:'1d',chart:false}},undefined,{signal,timeout:20000});
    assert(!result.isError,'FINANCE_PROVIDER_FAILED','The public data provider could not complete this read.',502);
    const data=record(result.structuredContent);
    assert(Array.isArray(data.results)&&data.results.length>0,'FINANCE_DATA_UNAVAILABLE','The provider returned no usable observations.',502);
    if(action==='news')return {status:'ready',source:'BBC RSS via OpenBB',untrusted:true,headlines:data.results.slice(0,5).map(value=>{
      const row=record(value);let url:string|null=null;
      try{const link=new URL(String(row.url));if(link.protocol==='https:'&&!link.username&&!link.password&&['www.bbc.com','www.bbc.co.uk','bbc.com','bbc.co.uk'].includes(link.hostname))url=link.href.slice(0,1000);}catch{/* Omit invalid source links. */}
      return {title:text(row.title,240),publishedAt:text(row.date,40),url};
    })};
    const dated=data.results.map(value=>{
      const row=record(value);
      assert(typeof row.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&Number.isFinite(Date.parse(row.date))
        &&['open','high','low','close'].every(key=>number(row[key])!==null),'FINANCE_DATA_INVALID','The provider returned invalid dated prices.',502);
      return {date:row.date,open:number(row.open),high:number(row.high),low:number(row.low),close:number(row.close),volume:number(row.volume)};
    }).sort((a,b)=>a.date.localeCompare(b.date));
    // The installed crypto/FX provider can append today's unfinished bar even
    // with end_date=today. Do not present that moving value as a daily close.
    const bars=dated.filter(row=>row.date>=start&&row.date<today).slice(-15);
    assert(bars.length>0,'FINANCE_DATA_UNAVAILABLE','No completed daily bars were returned for this window.',502);
    return {status:'ready',source:'OpenBB / yfinance',symbol:symbol!,quoteCurrency:symbol?.endsWith('CZK')?'CZK':'USD',interval:'1d',startDate:start,endDateExclusive:today,
      latestDate:bars.at(-1)!.date,latestClose:bars.at(-1)!.close,bars,excludedBars:dated.length-bars.length,liveQuote:false,providerWarningsPresent:Array.isArray(data.warnings)&&data.warnings.length>0};
  }finally{await client.close().catch(()=>{});}
}
