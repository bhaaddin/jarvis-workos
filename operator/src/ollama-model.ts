import {randomUUID} from 'node:crypto';
import type {AgentMessage,Model,ModelResponse,ObjectValue,ToolCall} from './contracts.js';
import {assert,OperatorError} from './errors.js';
import {object} from './store-context.js';

export interface OllamaModelOptions {
  model:string;
  think:true|'high'|'xhigh';
  contextTokens:number;
  maxTokens:number;
  timeoutMs?:number;
  sampling?:ObjectValue;
  keepAliveSeconds?:number;
}

// Ollama's native tools and thinking protocol, pinned against api/types.go in
// ollama/ollama v0.34.4. This transport supplies no native agent or host tools;
// the existing Node owner remains the only executor of returned proposals.
export class OllamaModel implements Model {
  constructor(private readonly base:URL,private readonly options:OllamaModelOptions){
    assert(base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname)&&!base.username&&!base.password,
      'CONFIG_INVALID','The direct model must use the reviewed loopback inference service.',503);
    assert(options.contextTokens>=32768&&options.maxTokens>=4096&&options.model.length>0,
      'CONFIG_INVALID','The local reasoning model requires an explicit model and reviewed context/output budget.',503);
    assert(options.keepAliveSeconds===undefined||options.keepAliveSeconds===-1||Number.isInteger(options.keepAliveSeconds)&&options.keepAliveSeconds>=60&&options.keepAliveSeconds<=86400,
      'CONFIG_INVALID','Use a bounded idle timeout or explicitly resident mode.',503);
  }

  async complete(messages:AgentMessage[],tools:ObjectValue[],parent:AbortSignal,onText?:(text:string)=>void,
    toolChoice:'auto'|'required'|'none'='auto'):Promise<ModelResponse>{
    const signal=AbortSignal.any([parent,AbortSignal.timeout(this.options.timeoutMs??180000)]);
    const names=new Map<string,string>();
    const history=messages.map(message=>{
      const calls=message.tool_calls?.map(call=>{
        names.set(call.id,call.function.name);
        // Invalid legacy arguments already have a corresponding recorded error.
        // Keep that conversation pairing, without inventing usable parameters.
        let args:ObjectValue={};try{args=object(JSON.parse(call.function.arguments));}catch{}
        return {id:call.id,function:{name:call.function.name,arguments:args}};
      });
      return {role:message.role,content:message.content??'',...(message.thinking?{thinking:message.thinking}:{}),
        ...(calls?{tool_calls:calls}:{}),...(message.tool_call_id?{tool_call_id:message.tool_call_id,tool_name:names.get(message.tool_call_id)??''}:{})};
    });
    const response=await fetch(new URL('/api/chat',this.base),{method:'POST',redirect:'error',signal,
      headers:{'Content-Type':'application/json'},body:JSON.stringify({model:this.options.model,messages:history,
        tools:toolChoice==='none'?[]:tools,think:this.options.think,stream:true,keep_alive:this.options.keepAliveSeconds??-1,truncate:false,shift:false,
        options:{num_ctx:this.options.contextTokens,num_predict:this.options.maxTokens,...this.options.sampling}})});
    if(!response.ok||!response.body){await response.body?.cancel();throw new OperatorError('AGENT_UNAVAILABLE','The local inference service could not complete this step.',503);}
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer='',text='',thinking='',bytes=0,done=false,reason='';
    const calls:ToolCall[]=[];let usage:ObjectValue|undefined;
    const consume=(line:string)=>{
      if(!line.trim())return;
      let chunk:ObjectValue;try{chunk=object(JSON.parse(line));}catch{throw new OperatorError('AGENT_INCOMPLETE','The local model returned an invalid stream frame.',502);}
      assert(!chunk.error,'AGENT_STEP_FAILED','The local inference engine reported an incomplete step.',502);
      assert(chunk.model===undefined||chunk.model===this.options.model,'AGENT_MODEL_CHANGED','The inference response did not identify the selected model.',502);
      const message=object(chunk.message??{});
      if(typeof message.thinking==='string')thinking+=message.thinking;
      if(typeof message.content==='string'){text+=message.content;onText?.(message.content);}
      if(message.tool_calls!==undefined){
        assert(Array.isArray(message.tool_calls),'INVALID_TOOL_CALL','The local model returned invalid function calls.',502);
        for(const value of message.tool_calls){
          const call=object(value),fn=object(call.function),args=object(fn.arguments);
          assert(typeof fn.name==='string'&&/^jarvis_[a-z0-9_]+$/.test(fn.name),'INVALID_TOOL_CALL','The local model requested an unrecognized tool namespace.',502);
          const argumentsText=JSON.stringify(args);assert(argumentsText.length<=32000&&calls.length<12,'INVALID_TOOL_CALL','The local tool batch exceeded its bound.',502);
          calls.push({id:typeof call.id==='string'&&call.id?call.id:randomUUID(),type:'function',function:{name:fn.name,arguments:argumentsText}});
        }
      }
      if(chunk.done===true){
        done=true;reason=String(chunk.done_reason??'');
        const count=(key:string)=>typeof chunk[key]==='number'?chunk[key]:0;
        usage={prompt_tokens:count('prompt_eval_count'),completion_tokens:count('eval_count'),
          total_tokens:count('prompt_eval_count')+count('eval_count'),load_ms:count('load_duration')/1e6,
          prompt_ms:count('prompt_eval_duration')/1e6,generation_ms:count('eval_duration')/1e6,model:this.options.model};
      }
    };
    try{
      while(!done){
        const part=await reader.read();
        if(part.done){buffer+=decoder.decode();if(buffer.trim())consume(buffer);break;}
        bytes+=part.value.length;assert(bytes<=2*1024*1024,'AGENT_OUTPUT_LIMIT','The local model response exceeded its bound.',502);
        buffer+=decoder.decode(part.value,{stream:true});
        let newline;while(!done&&(newline=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,newline));buffer=buffer.slice(newline+1);}
      }
    }finally{await reader.cancel().catch(()=>{});}
    assert(done&&(reason==='stop'||reason==='tool_calls'),'AGENT_INCOMPLETE','The model did not finish within its output/context budget; unfinished proposals were not executed.',502);
    assert(toolChoice!=='none'||!calls.length,'AGENT_FINAL_INVALID','The model requested a tool during final delivery.',502);
    assert(toolChoice!=='required'||calls.length>0,'AGENT_PLAN_INVALID','The model did not select a required tool.',502);
    return {text,calls,...(usage?{usage}:{}),...(thinking?{thinking}:{})};
  }
}
