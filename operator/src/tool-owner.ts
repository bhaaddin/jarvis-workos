import {randomUUID} from 'node:crypto';
import type {Action, Actor, Invocation, Json, ObjectValue, ToolContext, ToolOutput} from './contracts.js';
import {assert, OperatorError, publicError} from './errors.js';
import {evaluatePolicy} from './policy.js';
import {fingerprint} from './privacy.js';
import type {Registry} from './registry.js';
import {Services} from './services.js';
import {Store} from './store.js';
import {json} from './store-context.js';
import {ActionRunner, actionView} from './actions.js';
import {EventBus} from './events.js';

export class ToolOwner {
  constructor(private readonly store: Store, private readonly registry: Registry, private readonly services: Services,
    private readonly actions: ActionRunner, private readonly bus: EventBus) {}

  async invoke(name: string, raw: unknown, caller: Invocation): Promise<ObjectValue> {
    const started = Date.now(), callId = randomUUID();
    let privacy: ToolOutput['sensitivity'] = 'pii';
    const base = {tenantId: caller.actor.tenantId, actorId: caller.actor.id};
    try {
      caller.signal.throwIfAborted();
      const {manifest, fingerprint: identity} = this.registry.descriptor(name);
      privacy = manifest.sensitivity;
      const parsed = this.registry.input(name, raw);
      const actor = await this.store.call<Actor>('actor.get', base);
      assert(actor.revision === caller.actor.revision, 'AUTHORITY_CHANGED', 'Account authority changed before tool admission.', 403);
      await this.store.call('conversation.require', {...base, conversationId: caller.conversationId});
      const context: Invocation = {...caller, actor, confidence: parsed.confidence};
      await this.services.preflight(manifest,context,parsed.input);
      const rule = await this.store.call<import('./contracts.js').PolicyRule>('policy.get', {...base, tool: name, now: Date.now()});
      const decision = evaluatePolicy(context, manifest, rule, identity);
      await this.store.call('audit.record', {...base, kind: 'tool.requested', now: started, sensitivity: privacy,
        payload: {callId, tool: name, input: parsed.input, decision: json(decision), intentId: caller.intentId}});
      this.bus.publish({id: randomUUID(), kind: 'tool.started', ...{tenantId: actor.tenantId, actorId: actor.id},
        conversationId: caller.conversationId, at: started, data: {callId, tool: name}});
      assert(decision.outcome !== 'deny', 'TOOL_FORBIDDEN', 'This tool is not permitted in the current user/channel context.', 403);
      let result: ObjectValue;
      if (manifest.risk === 'read') {
        const invocation: ToolContext = {...context, actionId: callId, idempotencyKey: callId,
          signal: AbortSignal.any([caller.signal, AbortSignal.timeout(manifest.timeoutMs)]),
          assertCurrent: async () => {
            invocation.signal.throwIfAborted();
            const live = await this.store.call<Actor>('actor.get', base);
            assert(live.revision === actor.revision && manifest.permissions.every(permission => live.permissions.includes(permission)),
              'AUTHORITY_CHANGED', 'Account authority changed during this request.', 403);
          }, services: {invoke: async () => {throw new OperatorError('UNBOUND_SERVICE', 'Service binding is unavailable.', 503);}}};
        invocation.services = this.services.bind(manifest, invocation);
        const output = await this.registry.execute(name, parsed.input, invocation);
        privacy = output.sensitivity;
        result = {ok: true, status: 'completed', result: json(output)};
      } else {
        let action = await this.store.call<Action>('action.propose', {tool: name, input: parsed.input, now: Date.now(),
          submissionKey: fingerprint({intent: caller.intentId, tool: name, input: parsed.input}),
          scope: {...base, conversationId: caller.conversationId, intentId: caller.intentId, channel: caller.channel,
            secure: caller.secure, confidence: parsed.confidence, source: caller.source}});
        if (action.state === 'approved') action = await this.store.call<Action>('action.enqueue', {tenantId: actor.tenantId, id: action.id, now: Date.now()});
        if (action.state === 'queued' && manifest.risk === 'internal_write') action = await this.actions.runOne(action.id, action.tenantId) ?? action;
        this.actions.changed(action);
        privacy = action.result?.sensitivity ?? action.sensitivity;
        assert(caller.secure || !['pii','phi'].includes(privacy), 'PROTECTED_TOOL_OUTPUT', 'This result is available only in the secure application.', 403);
        result = {ok: !['failed','denied','expired','cancelled','uncertain'].includes(action.state),
          status: action.state === 'awaiting_approval' ? 'approval_required' : action.state,
          action: actionView(action), ...(action.result ? {result: json(action.result)} : {})};
      }
      const recorded=await this.store.call<{id:string}>('audit.record', {...base, kind: 'tool.completed', now: Date.now(), sensitivity: privacy,
        payload: {callId, tool: name, result, elapsedMs: Date.now() - started}});
      this.bus.publish({id: randomUUID(), kind: 'tool.completed', tenantId: actor.tenantId, actorId: actor.id,
        conversationId: caller.conversationId, at: Date.now(), data: {callId, tool: name, elapsedMs: Date.now() - started}});
      return {...result,observationId:recorded.id};
    } catch (error) {
      const safe = publicError(error);
      await this.store.call('audit.record', {...base, kind: 'tool.failed', now: Date.now(), sensitivity: privacy,
        payload: {callId, tool: name, error: safe, elapsedMs: Date.now() - started}});
      if (caller.signal.aborted) throw error;
      return {ok: false, status: 'error', error: safe};
    }
  }
}
