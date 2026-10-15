import type {AgentMessage, Json, ObjectValue, ToolCall} from './contracts.js';
import {assert} from './errors.js';

export const cancelledRequestNotice = 'The preceding request was cancelled. Do not resume it unless the user explicitly asks. Already admitted actions may have completed; check their recorded states before repeating anything.';

export function modelObservation(value:ObjectValue):ObjectValue {
  const original=JSON.stringify(value);if(original.length<=8000)return value;
  const shrink=(item:Json,stringLimit:number,arrayLimit:number,depth=0):Json=>{
    if(typeof item==='string')return item.length>stringLimit?item.slice(0,stringLimit)+' [truncated]':item;
    if(item===null||typeof item!=='object')return item;
    if(depth>8)return '[Nested result retained in the full observation]';
    if(Array.isArray(item))return item.slice(0,arrayLimit).map(child=>shrink(child,stringLimit,arrayLimit,depth+1));
    return Object.fromEntries(Object.entries(item).slice(0,30).map(([key,child])=>[key,shrink(child,stringLimit,arrayLimit,depth+1)]));
  };
  let stringLimit=1500,arrayLimit=12,result=shrink(value,stringLimit,arrayLimit) as ObjectValue;
  while(JSON.stringify(result).length>7000&&arrayLimit>1){stringLimit=Math.max(150,Math.floor(stringLimit/2));arrayLimit=Math.max(1,Math.floor(arrayLimit/2));result=shrink(value,stringLimit,arrayLimit) as ObjectValue;}
  if(JSON.stringify(result).length>7000)result={ok:value.ok??false,status:value.status??'recorded',observationId:value.observationId??null};
  return {...result,contextNotice:{truncated:true,originalCharacters:original.length,observationId:value.observationId??null,
    retrieval:'Use jarvis_observation_read with the observationId and a JSON pointer such as /result/data/processes or /result/data/text. A truncated preview cannot establish that something is absent.'}};
}

export function validateCallBatch(calls: ToolCall[], seen: Set<string>, remaining: number): void {
  assert(calls.length > 0 && calls.length <= remaining, 'AGENT_CALL_LIMIT', 'This task reached its tool-call limit.', 502);
  const ids = new Set<string>();
  for (const call of calls) {
    assert(typeof call.id === 'string' && call.id.length > 0 && call.id.length <= 200 && call.type === 'function'
      && typeof call.function?.name === 'string' && /^jarvis_[a-z0-9_]+$/.test(call.function.name)
      && typeof call.function.arguments === 'string' && call.function.arguments.length <= 32000,
    'INVALID_TOOL_CALL', 'The agent returned an invalid structured call.', 502);
    assert(!seen.has(call.id) && !ids.has(call.id), 'AGENT_CALL_REPLAY', 'The agent repeated a tool-call identity.', 502);
    ids.add(call.id);
  }
}

// Repair only the model's working view. Durable messages/effect receipts stay
// untouched, and an absent observation never means that an effect did not occur.
export function workingHistory(stored: Array<{message?: AgentMessage}>, limit = 80000): AgentMessage[] {
  const result: AgentMessage[] = [], pending = new Set<string>();
  const interrupt = () => {
    for (const id of pending) result.push({role: 'tool', tool_call_id: id, content: JSON.stringify({ok: false,
      error: {code: 'OBSERVATION_INTERRUPTED', message: 'No durable observation is available. The outcome may be unknown; inspect recorded actions before repeating work.'}})});
    pending.clear();
  };
  for (const storedMessage of stored) {
    // Protected history is omitted on an insecure channel, including its tool
    // roles/IDs. A redacted orphan tool frame is not valid conversation context.
    if (!storedMessage.message) continue;
    const item = structuredClone(storedMessage.message);
    if (item.role === 'system') {
      // Only this fixed, owner-written lifecycle marker is replayable. Never
      // restore arbitrary old system prompts or instructions from stored data.
      if ((item as AgentMessage & {notice?:unknown}).notice === 'request_cancelled' && item.content === cancelledRequestNotice) {
        interrupt();
        result.push({role:'system',content:cancelledRequestNotice});
      }
      continue;
    }
    if (item.role === 'tool') {
      if(item.content){try{item.content=JSON.stringify(modelObservation(JSON.parse(item.content) as ObjectValue));}catch{/* Legacy textual observations remain readable. */}}
      if (item.tool_call_id && pending.delete(item.tool_call_id)) result.push(item);
      continue;
    }
    interrupt();
    if (item.tool_calls?.length) {
      try {validateCallBatch(item.tool_calls, new Set(), 40);}
      catch {result.push({role:'assistant',content:'A previous task was interrupted. Review its recorded actions before retrying.'});continue;}
      for (const call of item.tool_calls) pending.add(call.id);
    }
    result.push(item);
  }
  interrupt();
  while (result.length && result[0]?.role !== 'user') result.shift();
  while (JSON.stringify(result).length > limit) {
    const next = result.findIndex((item, index) => index > 0 && item.role === 'user');
    if (next < 0) return [];
    result.splice(0, next);
  }
  return result;
}
