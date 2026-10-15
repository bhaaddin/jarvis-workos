import type {ObjectValue} from './contracts.js';

const object=(value:unknown):ObjectValue=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as ObjectValue:{};
const numeric=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const amount=(value:number)=>value.toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:8});

// A model may opt into this only for a simple wallet/status or study-result
// question. No provider text, news, prose, URLs or arbitrary "answer" fields
// enter the response. Complex requests continue through normal reasoning.
export function directFinance(tool:string,input:ObjectValue,observed:ObjectValue,batchSize:number):string|null{
  if(tool!=='jarvis_finance'||input._respond!==true||batchSize!==1||observed.ok!==true)return null;
  const data=object(object(observed.result).data);
  if(data.status!=='ready'||data.readOnly!==true||data.action!==input.action||typeof data.observedAt!=='string'
    ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.observedAt))return null;
  const at=' Observed '+data.observedAt.replace('T',' ').replace(/\.\d{3}Z$/,' UTC')+'.';
  if(input.action==='paper'){
    const paper=object(data.paper);
    if(paper.status!=='ready'||paper.dryRun!==true||paper.currency!=='USDT'||!numeric(paper.balance)||!numeric(paper.allocatedBalance)
      ||!numeric(paper.openPositions)||!numeric(paper.maxPositions)||!['running','stopped','reload_config'].includes(String(paper.state)))return null;
    return `Paper simulation is ${paper.state}: ${amount(paper.balance)} USDT virtual balance, ${paper.openPositions} of ${paper.maxPositions} positions open. `
      +`The allocated balance is ${amount(paper.allocatedBalance)} USDT; the reserve is not profit.`+at;
  }
  if(input.action==='study'){
    const study=object(data.study);
    if(study.status!=='ready'||study.decision!=='NO_QUALIFIED_CANDIDATE'||study.holdoutEvaluated!==false||study.paperParametersChanged!==false
      ||!Array.isArray(study.validation)||study.validation.length<2||study.validation.length>10)return null;
    const rows=study.validation.map(object);
    if(!rows.every(row=>numeric(row.netUSDT)&&row.netUSDT<0&&numeric(row.walletDrawdownUSDT)&&row.qualified===false
      &&(row.label==='baseline-validation'||(numeric(row.epoch)&&Number.isInteger(row.epoch)))))return null;
    const baseline=rows.find(row=>row.label==='baseline-validation'),candidates=rows.filter(row=>row.label!=='baseline-validation');
    if(!baseline||!candidates.length)return null;
    const best=candidates.reduce((a,b)=>Number(a.netUSDT)>Number(b.netUSDT)?a:b);
    return `No candidate qualified. In historical validation, the baseline lost ${Math.abs(Number(baseline.netUSDT)).toFixed(8)} USDT; `
      +`candidate ${best.epoch} lost ${Math.abs(Number(best.netUSDT)).toFixed(8)} USDT, with ${Number(best.walletDrawdownUSDT).toFixed(8)} USDT wallet drawdown. `
      +'That is a smaller loss, not a profit. The holdout was not evaluated and paper parameters are unchanged.'+at;
  }
  return null;
}
