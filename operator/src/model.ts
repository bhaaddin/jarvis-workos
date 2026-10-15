import {randomUUID} from 'node:crypto';
import type {AgentMessage, Model, ModelResponse, ObjectValue, ToolCall} from './contracts.js';
import {OperatorError, assert} from './errors.js';

export class OpenClawModel implements Model {
  constructor(private readonly base: URL, private readonly token: string, private readonly timeoutMs = 180000,
    private readonly onProtocolError: (value: unknown) => void = () => {}, private readonly modelOverride?: string) {
    assert(token.length >= 32, 'CONFIG_INVALID', 'A private operational Gateway credential is required.', 503);
  }

  async readiness(signal: AbortSignal): Promise<void> {
    const response = await fetch(new URL('/jarvis/operator-boundary', this.base), {
      headers: {Authorization: `Bearer ${this.token}`}, signal, redirect: 'error',
    });
    if (!response.ok) throw new OperatorError('AGENT_BOUNDARY_UNAVAILABLE', 'The operational agent boundary is not ready.', 503);
    const result: unknown = await response.json();
    assert(result !== null && typeof result === 'object' && 'boundaryVersion' in result && result.boundaryVersion === 2
      && 'nativeLogsDisabled' in result && result.nativeLogsDisabled === true,
      'AGENT_BOUNDARY_UNAVAILABLE', 'The operational agent boundary version is unsupported.', 503);
  }

  async complete(messages: AgentMessage[], tools: ObjectValue[], parent: AbortSignal,
    onText?: (text: string) => void, toolChoice: 'auto' | 'required' | 'none' = 'auto'): Promise<ModelResponse> {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(this.timeoutMs)]);
    await this.readiness(signal);
    // Public pinned session-key contract: incognito storage is process-local.
    // Never retry this request without the explicit mode or persist PHI natively.
    const response = await fetch(new URL('/v1/chat/completions', this.base), {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${this.token}`,
        'x-openclaw-session-key': `agent:main:dashboard:incognito-jarvis-${randomUUID()}`,
        ...(this.modelOverride?{'x-openclaw-model':this.modelOverride}:{})},
      body: JSON.stringify({model: 'openclaw/default', messages, tools, tool_choice: toolChoice,
        stream: true, stream_options: {include_usage: true}}), signal, redirect: 'error',
    });
    if (!response.ok || !response.body) throw new OperatorError('AGENT_UNAVAILABLE', 'The agent could not complete this step.', 503, true);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', text = '', total = 0, terminal = false;
    let usage: ObjectValue | undefined;
    let finishReason: string | undefined;
    const calls = new Map<number, {id: string; name: string; arguments: string}>();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.length;
        if (total > 2 * 1024 * 1024) throw new OperatorError('AGENT_OUTPUT_LIMIT', 'The agent response exceeded its limit.', 502);
        buffer += decoder.decode(part.value, {stream: true});
        for (;;) {
          const end = buffer.indexOf('\n');
          if (end < 0) break;
          const line = buffer.slice(0, end).trimEnd(); buffer = buffer.slice(end + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { terminal = true; break; }
          const chunk = JSON.parse(payload) as {error?: unknown; usage?: ObjectValue; choices?: Array<{finish_reason?:string|null;delta?: {content?: string; tool_calls?: Array<{index: number; id?: string; function?: {name?: string; arguments?: string}}>}}>};
          if (chunk.error) {
            this.onProtocolError(chunk.error);
            throw new OperatorError('AGENT_STEP_FAILED', 'The agent reported an incomplete step.', 502);
          }
          if (chunk.usage) usage = chunk.usage;
          for (const choice of chunk.choices ?? []) {
            if(choice.finish_reason)finishReason=choice.finish_reason;
            const delta = choice.delta;
            if (delta?.content) { text += delta.content; onText?.(delta.content); }
            for (const entry of delta?.tool_calls ?? []) {
              assert(Number.isSafeInteger(entry.index) && entry.index >= 0 && entry.index < 12, 'INVALID_TOOL_CALL', 'The agent returned an invalid tool index.', 502);
              const call = calls.get(entry.index) ?? {id: '', name: '', arguments: ''};
              if (entry.id) call.id = entry.id;
              if (entry.function?.name) call.name += entry.function.name;
              if (entry.function?.arguments) call.arguments += entry.function.arguments;
              assert(call.arguments.length <= 32000, 'INVALID_TOOL_CALL', 'Tool arguments exceeded their limit.', 502);
              calls.set(entry.index, call);
            }
          }
        }
        if (terminal) break;
      }
    } finally { await reader.cancel().catch(() => {}); }
    assert(terminal, 'AGENT_INCOMPLETE', 'The agent stream ended without a terminal result.', 502);
    assert(finishReason==='stop'||finishReason==='tool_calls','AGENT_INCOMPLETE',
      finishReason==='length'?'The model reached its output limit; the unfinished result was not executed.':'The agent did not report a successful terminal completion.',502);
    const structured: ToolCall[] = [...calls].sort(([a], [b]) => a - b).map(([, value]) => {
      assert(value.id && /^jarvis_[a-z0-9_]+$/.test(value.name), 'INVALID_TOOL_CALL', 'The agent requested an unrecognized tool namespace.', 502);
      return {id: value.id, type: 'function', function: {name: value.name, arguments: value.arguments || '{}'}};
    });
    // This is OpenClaw's documented empty-result placeholder, not an answer.
    if(!structured.length&&text.trim()==='No response from OpenClaw.')text='';
    return {...(usage ? {usage} : {}), text, calls: structured};
  }
}
