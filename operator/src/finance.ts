import {open,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Config} from './config.js';
import type {Actor,ObjectValue} from './contracts.js';
import {assert,OperatorError} from './errors.js';
import {boundedResponse,financeSymbols,number,readMarket,record} from './finance-market.js';

const endpoints={paper:'http://127.0.0.1:18812/api/v1/',research:'http://127.0.0.1:18814/api/v1/'};
const routes={paper:['show_config','balance','count','daily?timescale=7','status','trades?limit=5'],research:['show_config','backtest/history']};
const safeText=(value:unknown,pattern:RegExp):string|null=>typeof value==='string'&&pattern.test(value)?value:null;
const label=(value:unknown)=>safeText(value,/^[a-zA-Z0-9_. -]{1,80}$/);
const finite=(value:unknown):number=>{const result=number(value);assert(result!==null,'FINANCE_DATA_INVALID','A required Finance number is missing or invalid.',502);return result;};
const boolean=(value:unknown):boolean=>{assert(typeof value==='boolean','FINANCE_DATA_INVALID','A required Finance status is missing.',502);return value;};

export class Finance {
  private readonly cache=new Map<string,{at:number;value:ObjectValue}>();
  constructor(private readonly config:Pick<Config,'tenantId'|'finance'>){}

  private permit(actor:Actor){
    assert(actor.active&&actor.tenantId===this.config.tenantId&&['operator.chat','connections.manage'].every(permission=>actor.permissions.includes(permission)),
      'FORBIDDEN','Finance read access is not permitted.',403);
    assert(this.config.finance,'FINANCE_NOT_CONFIGURED','The local Finance connection is not configured.',503);
    assert(actor.id===this.config.finance.ownerId,'FORBIDDEN','This Finance connection belongs to another account.',403);
  }

  private async file(relative:string,maximum:number,signal:AbortSignal):Promise<string>{
    signal.throwIfAborted();
    const root=await realpath(this.config.finance!.root),target=await realpath(path.join(root,relative));
    assert(target.startsWith(root+path.sep),'FINANCE_FILE_REJECTED','A Finance file escaped its configured root.',403);
    const handle=await open(target,'r');
    try{
      const stat=await handle.stat();assert(stat.isFile()&&stat.size<=maximum,'FINANCE_FILE_REJECTED','The Finance file is not a bounded regular file.',502);
      const buffer=Buffer.alloc(maximum+1);let length=0;
      while(length<buffer.length){signal.throwIfAborted();const read=await handle.read(buffer,length,buffer.length-length,null);if(!read.bytesRead)break;length+=read.bytesRead;}
      assert(length<=maximum,'FINANCE_FILE_REJECTED','The Finance file exceeded its limit.',502);
      return buffer.subarray(0,length).toString('utf8').replace(/^\uFEFF/,'');
    }finally{await handle.close();}
  }

  private async authorization(service:'paper'|'research',signal:AbortSignal):Promise<string>{
    const content=await this.file('state/'+service+'/credentials.env',16384,signal);
    const prefix=service.toUpperCase()+'_MCP_AUTHORIZATION=';
    const found=content.split(/\r?\n/).filter(line=>line.startsWith(prefix));
    const value=found.length===1?found[0]!.slice(prefix.length).trim():'';
    assert(/^Basic [A-Za-z0-9+/]+=*$/.test(value)&&value.length<2048,'FINANCE_CREDENTIALS_MISSING','The native Finance read credentials are unavailable.',503);
    return value;
  }

  private async get(service:'paper'|'research',route:string,authorization:string,signal:AbortSignal):Promise<unknown>{
    assert(routes[service].includes(route),'FINANCE_ROUTE_REJECTED','Only selected Finance reads are permitted.',403);
    const response=await fetch(endpoints[service]+route,{method:'GET',headers:{Authorization:authorization,Accept:'application/json'},redirect:'error',signal});
    if(!response.ok){await response.body?.cancel();throw new OperatorError('FINANCE_SOURCE_UNAVAILABLE','The '+service+' service rejected its read. Check the native connection.',502);}
    return boundedResponse(response).json();
  }

  private async paper(signal:AbortSignal):Promise<ObjectValue>{
    const authorization=await this.authorization('paper',signal);
    const config=record(await this.get('paper','show_config',authorization,signal));
    assert(config.dry_run===true&&config.runmode==='dry_run','FINANCE_MODE_REJECTED','The connected simulator is not in dry-run mode.',409);
    const [balanceValue,countValue,dailyValue,positionsValue,tradesValue]=await Promise.all(routes.paper.slice(1).map(route=>this.get('paper',route,authorization,signal)));
    const balance=record(balanceValue),count=record(countValue),daily=record(dailyValue),trades=record(tradesValue);
    assert(Array.isArray(daily.data)&&Array.isArray(positionsValue)&&Array.isArray(trades.trades),'FINANCE_DATA_INVALID','The simulator returned an invalid observation.',502);
    const position=(value:unknown):ObjectValue=>{const row=record(value);return {id:number(row.trade_id),pair:safeText(row.pair,/^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/),
      open:typeof row.is_open==='boolean'?row.is_open:null,stake:number(row.stake_amount),profitUSDT:number(row.profit_abs??row.close_profit_abs),
      openedAt:safeText(row.open_date,/^[0-9T: .+Z-]{10,40}$/),closedAt:safeText(row.close_date,/^[0-9T: .+Z-]{10,40}$/)};};
    assert(balance.stake==='USDT'&&config.stake_currency==='USDT','FINANCE_CURRENCY_REJECTED','The simulator must report the configured USDT units.',409);
    return {status:'ready',source:'Freqtrade native API',dryRun:true,runmode:'dry_run',state:safeText(config.state,/^(running|stopped|reload_config)$/),
      strategy:label(config.strategy),timeframe:label(config.timeframe),currency:'USDT',balance:finite(balance.total),allocatedBalance:number(balance.total_bot),
      startingAllocatedCapital:number(balance.starting_capital),openPositions:finite(count.current),maxPositions:finite(count.max),
      positions:positionsValue.slice(0,10).map(position),recentTrades:trades.trades.slice(0,5).map(position),closedTrades:number(trades.total_trades),
      daily:daily.data.slice(0,7).map(value=>{const row=record(value);return {date:safeText(row.date,/^\d{4}-\d{2}-\d{2}$/),profitUSDT:number(row.abs_profit),trades:number(row.trade_count)};}),
      note:'Virtual funds. Allocated capital and wallet balance differ; the reserve is not profit.'};
  }

  private async research(signal:AbortSignal):Promise<ObjectValue>{
    const authorization=await this.authorization('research',signal),config=record(await this.get('research','show_config',authorization,signal));
    assert(config.dry_run===true&&config.runmode==='webserver','FINANCE_MODE_REJECTED','The research service must remain a historical webserver.',409);
    const history=await this.get('research','backtest/history',authorization,signal);
    assert(Array.isArray(history),'FINANCE_DATA_INVALID','The research history is not available.',502);
    const ordered=history.map(record).sort((a,b)=>(number(b.backtest_start_time)??0)-(number(a.backtest_start_time)??0));
    return {status:'ready',source:'Freqtrade native API',runmode:'webserver',historicalOnly:true,totalResults:ordered.length,
      results:ordered.slice(0,8).map(row=>({filename:safeText(row.filename,/^backtest-result-[a-zA-Z0-9_-]{1,100}$/),strategy:label(row.strategy),
        executedAt:typeof row.backtest_start_time==='number'?new Date(row.backtest_start_time*1000).toISOString():null,
        startEpoch:number(row.backtest_start_ts),endEpoch:number(row.backtest_end_ts),timeframe:label(row.timeframe)}))};
  }

  private async study(signal:AbortSignal):Promise<ObjectValue>{
    const id=this.config.finance!.studyId;
    assert(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,40}$/.test(id),'FINANCE_FILE_REJECTED','The registered study identifier is invalid.',503);
    const source=await this.file('evidence/'+id+'/COMPARISON.json',128*1024,signal),data=record(JSON.parse(source));
    assert(data.decision==='NO_QUALIFIED_CANDIDATE'&&Array.isArray(data.validation_rows)&&data.validation_rows.length<=10,
      'FINANCE_DATA_INVALID','The registered study no longer matches its reviewed comparison contract.',502);
    return {status:'ready',source:'Locked study comparison',id,sha256:createHash('sha256').update(source).digest('hex'),
      verifiedAt:safeText(data.verified_at,/^[0-9T:.+Z-]{10,40}$/),decision:data.decision,holdoutEvaluated:boolean(data.holdout_evaluated),
      paperParametersChanged:boolean(data.paper_parameter_changes),epochs:finite(data.epoch_count),
      validation:data.validation_rows.map(value=>{const row=record(value);return {label:safeText(row.label,/^(baseline|candidate-\d+)-validation$/),epoch:number(row.epoch),
        buyRSI:finite(row.buy_rsi),sellRSI:finite(row.sell_rsi),trades:finite(row.trades),netUSDT:finite(row.net_usdt),returnPercent:finite(row.return_pct),
        closedDrawdownUSDT:finite(row.closed_drawdown_usdt),walletDrawdownUSDT:finite(row.wallet_drawdown_usdt),qualified:boolean(row.qualified)};}),
      lossReductionPercent:finite(data.loss_reduction_pct),walletDrawdownReductionPercent:finite(data.wallet_drawdown_reduction_pct),
      note:'Historical validation only. Reduced losses are not profits; no candidate qualified for promotion.'};
  }

  async read(actor:Actor,input:ObjectValue,parent:AbortSignal):Promise<ObjectValue>{
    this.permit(actor);parent.throwIfAborted();
    const action=String(input.action??'');
    assert(['overview','paper','research','study','market','news'].includes(action)&&Object.keys(input).every(key=>['action','symbol'].includes(key))
      &&(action==='market'?typeof input.symbol==='string'&&financeSymbols.includes(input.symbol):input.symbol===undefined),
      'FINANCE_INPUT_INVALID','Choose a supported Finance read and, for market data, a listed symbol.');
    const start=performance.now(),key=JSON.stringify([action,input.symbol??null]),cached=this.cache.get(key);
    const ttl=action==='market'||action==='news'?30000:5000;
    if(cached&&Date.now()-cached.at<ttl)return {...structuredClone(cached.value),cacheAgeMs:Date.now()-cached.at,elapsedMs:Math.round(performance.now()-start)};
    const signal=AbortSignal.any([parent,AbortSignal.timeout(22000)]);
    try{
      let values:ObjectValue;
      if(action==='overview'){
        const settled=await Promise.allSettled([this.paper(signal),this.research(signal),this.study(signal)]);
        values=Object.fromEntries(['paper','research','study'].map((name,index)=>{const result=settled[index]!;return [name,result.status==='fulfilled'?result.value
          :{status:'unavailable',error:this.safeError(result.reason)}];}));
      }else values={[action]:action==='paper'?await this.paper(signal):action==='research'?await this.research(signal):action==='study'?await this.study(signal)
        :await readMarket(action as 'market'|'news',typeof input.symbol==='string'?input.symbol:undefined,signal)};
      signal.throwIfAborted();this.permit(actor);
      const result:ObjectValue={action,readOnly:true,status:Object.values(values).every(value=>record(value).status==='ready')?'ready':'partial',
        observedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-start),cacheAgeMs:0,...values};
      if(result.status==='ready'){if(this.cache.size>=32)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{at:Date.now(),value:structuredClone(result)});}
      return result;
    }catch(error){
      parent.throwIfAborted();const safe=this.safeError(error);
      throw new OperatorError(String(safe.code),String(safe.message),502);
    }
  }

  private safeError(error:unknown):ObjectValue{
    // Never forward HTTP/MCP error bodies, paths, headers or native credentials.
    if(error instanceof OperatorError&&error.code.startsWith('FINANCE_'))return {code:error.code,message:error.message};
    return {code:'FINANCE_UNAVAILABLE',message:'The Finance source could not complete its bounded read. Check that the local native services and connection files are available.'};
  }
}
