import test from 'node:test';
import assert from 'node:assert/strict';
import {OllamaModel} from '../ollama-model.js';
import {OperatorError} from '../errors.js';

const options={model:'qualification',think:'high' as const,contextTokens:32768,maxTokens:8192,keepAliveSeconds:900};
test('native inference retains structured tool continuation and exposes no reasoning as answer text',async t=>{
  let body:Record<string,unknown>={};
  t.mock.method(globalThis,'fetch',async(input:URL|string,request?:RequestInit)=>{
    assert.equal(new URL(String(input)).pathname,'/api/chat');body=JSON.parse(String(request?.body));
    const frames=[{model:'qualification',message:{thinking:'SYNTHETIC_PRIVATE_REASONING'}},
      {message:{content:'Čas',tool_calls:[{function:{name:'jarvis_clock',arguments:{}}},{function:{name:'jarvis_calculate',arguments:{expression:'5*7'}}}]}},
      {message:{},done:true,done_reason:'stop',prompt_eval_count:100,eval_count:20}];
    const bytes=new TextEncoder().encode(frames.map(frame=>JSON.stringify(frame)).join('\n'));
    return new Response(new ReadableStream<Uint8Array>({start(controller){for(let offset=0;offset<bytes.length;offset+=3)controller.enqueue(bytes.slice(offset,offset+3));controller.close();}}));
  });
  const text:string[]=[];
  const model=new OllamaModel(new URL('http://127.0.0.1:11436'),options);
  const result=await model.complete([{role:'user',content:'Synthetic task'},{role:'assistant',content:null,thinking:'PREVIOUS_PRIVATE_REASONING',
    tool_calls:[{id:'old',type:'function',function:{name:'jarvis_clock',arguments:'{}'}}]},{role:'tool',tool_call_id:'old',content:'{"ok":true}'}],
    [{type:'function',function:{name:'jarvis_clock'}}],AbortSignal.timeout(2000),value=>{text.push(value);});
  assert.equal(body.think,'high');assert.equal(body.truncate,false);assert.equal(body.shift,false);assert.equal(body.keep_alive,900);
  assert.equal((body.options as Record<string,number>).num_predict,8192);
  assert.equal((body.messages as Array<Record<string,unknown>>)[1]?.thinking,'PREVIOUS_PRIVATE_REASONING');
  assert.equal((body.messages as Array<Record<string,unknown>>)[2]?.tool_name,'jarvis_clock');
  assert.equal(text.join(''),'Čas');assert.equal(result.text,'Čas');assert.equal(result.thinking,'SYNTHETIC_PRIVATE_REASONING');
  assert.equal(result.calls.length,2);assert.notEqual(result.calls[0]?.id,result.calls[1]?.id);
  assert.equal(result.calls[1]?.function.arguments,'{"expression":"5*7"}');assert.equal(result.usage?.total_tokens,120);
});

test('native truncation, malformed streams and context errors cannot yield executable proposals',async t=>{
  let mode='length';
  t.mock.method(globalThis,'fetch',async()=>{
    const frame={message:{tool_calls:[{function:{name:'jarvis_clock',arguments:{}}}]},done:true,done_reason:mode};
    return new Response(mode==='malformed'?'{invalid}\n':mode==='error'?'{"error":"Synthetic context exhausted"}\n':JSON.stringify(frame)+'\n');
  });
  const model=new OllamaModel(new URL('http://127.0.0.1:11436'),options);
  for(mode of ['length','load','malformed','error'])await assert.rejects(model.complete([],[],AbortSignal.timeout(2000)),error=>error instanceof OperatorError);
  mode='stop';await assert.rejects(model.complete([],[],AbortSignal.timeout(2000),undefined,'none'),error=>error instanceof OperatorError&&error.code==='AGENT_FINAL_INVALID');
  assert.throws(()=>new OllamaModel(new URL('https://unreviewed.example'),options));
});
