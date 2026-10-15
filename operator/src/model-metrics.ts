import type {AgentMessage,Model,ModelResponse,ObjectValue} from './contracts.js';
import {publicError} from './errors.js';

export function usageNumbers(usage:ObjectValue|undefined):Record<string,number>{
  const result:Record<string,number>={};
  for(const key of ['prompt_tokens','completion_tokens','total_tokens','load_ms','prompt_ms','generation_ms']){
    const value=usage?.[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER)result[key]=value;
  }
  return result;
}

export class MeteredModel implements Model{
  active=0;
  private total=0;
  private failures=0;
  private cancellations=0;
  private readonly recent:ObjectValue[]=[];
  constructor(private readonly inner:Model){}
  async complete(messages:AgentMessage[],tools:ObjectValue[],signal:AbortSignal,onText?:(text:string)=>void,
    choice:'auto'|'required'|'none'='auto'):Promise<ModelResponse>{
    const began=performance.now();this.active++;this.total++;
    let record:ObjectValue={at:new Date().toISOString(),success:false};
    try{
      const result=await this.inner.complete(messages,tools,signal,onText,choice);
      const usage=usageNumbers(result.usage);
      record={...record,success:true,...usage,outputTokensPerSecond:usage.generation_ms&&usage.completion_tokens
        ?Math.round(usage.completion_tokens*100000/usage.generation_ms)/100:null};
      return result;
    }catch(error){
      const cancellation=(value:unknown)=>publicError(value).code==='CANCELLED'||value instanceof DOMException&&value.name==='AbortError';
      const cancelled=cancellation(error)||signal.aborted&&cancellation(signal.reason);
      if(cancelled)this.cancellations++;else this.failures++;
      record={...record,cancelled,code:cancelled?'CANCELLED':publicError(error).code??'INTERNAL_ERROR'};
      throw error;
    }
    finally{record.elapsedMs=Math.round(performance.now()-began);this.recent.push(record);if(this.recent.length>32)this.recent.shift();this.active--;}
  }
  snapshot():ObjectValue{
    const durations=this.recent.filter(value=>value.success===true).map(value=>Number(value.elapsedMs)).sort((a,b)=>a-b);
    return {scope:'process-local; counters reset on restart; latency median includes completed calls only',requests:this.total,failures:this.failures,cancellations:this.cancellations,active:this.active,
      recentCount:this.recent.length,medianModelMs:durations.length?durations[Math.floor(durations.length/2)]!:null,
      last:this.recent.length?structuredClone(this.recent.at(-1)!):null};
  }
}
