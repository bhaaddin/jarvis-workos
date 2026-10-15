import type {Action, Actor, Invocation, ObjectValue, ToolContext} from './contracts.js';
import {EventBus} from './events.js';
import {IntegrationError} from './resilience.js';
import {OperatorError} from './errors.js';
import {Registry} from './registry.js';
import {Services} from './services.js';
import {Store} from './store.js';
import {json} from './store-context.js';
import {randomUUID} from 'node:crypto';

export function actionView(action: Action): ObjectValue {
  return {id: action.id, tool: action.tool, state: action.state, reason: action.reason, inputHash: action.inputHash,
    fingerprint: action.fingerprint, sensitivity: action.sensitivity, expiresAt: action.expiresAt,
    approvalKind: action.approvalKind, approvedAt: action.approvedAt, notBefore: action.notBefore,
    attempts: action.attempts, errorCode: action.errorCode};
}

export class ActionRunner {
  private active = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly stopping = new AbortController();
  private idle: Promise<void> = Promise.resolve();
  lastFailure: ObjectValue | null = null;
  onSettled: ((action:Action)=>Promise<void>) | undefined;
  private execution: {tenantId:string;id:string;controller:AbortController}|null=null;
  constructor(private readonly store: Store, private readonly registry: Registry,
    private readonly services: Services, private readonly bus: EventBus) {}

  start(): void {
    this.timer = setInterval(() => { void this.drain().catch(() => {this.lastFailure = {code:'ACTION_WORKER_UNAVAILABLE',at:Date.now()};}); }, 500);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.stopping.abort(new OperatorError('SHUTTING_DOWN', 'The operator is stopping.', 503));
    await this.idle;
  }

  async runOne(id?: string, tenantId?: string): Promise<Action | null> {
    if (this.active || this.stopping.signal.aborted) return null;
    this.active = true;
    let complete!: () => void;
    this.idle = new Promise<void>(resolve => {complete = resolve;});
    let action: Action | null = null;
    let dispatched = false;
    try {
      action = await this.store.call<Action | null>('action.claim', {now: Date.now(), leaseMs: 120000,
        ...(id ? {id, tenantId: tenantId ?? ''} : {})});
      if (!action) return null;
      const current = action;
      const controller=new AbortController();this.execution={tenantId:current.tenantId,id:current.id,controller};
      const {manifest, fingerprint} = this.registry.descriptor(current.tool);
      if (fingerprint !== current.fingerprint) throw new OperatorError('SKILL_CHANGED', 'The approved skill changed.', 409);
      const actor = await this.store.call<Actor>('actor.get', {tenantId: current.tenantId, actorId: current.ownerId});
      const check = async (dispatch: boolean) => {
        await this.store.call('action.authorize', {tenantId: current.tenantId, id: current.id,
          leaseToken: current.leaseToken, now: Date.now(), dispatch});
        if (dispatch) dispatched = true;
      };
      const context: ToolContext = {actor, environment: current.environment, conversationId: current.conversationId,
        intentId: current.intentId, channel: current.channel, secure: current.secure,
        confidence: current.confidence, source: current.source,
        signal: AbortSignal.any([this.stopping.signal, controller.signal, AbortSignal.timeout(manifest.timeoutMs)]),
        actionId: current.id, idempotencyKey: current.id,
        assertCurrent: () => check(false), services: {invoke: async () => {throw new OperatorError('UNBOUND_SERVICE', 'Service binding is unavailable.', 503);}}};
      context.services = this.services.bind(manifest, context, {leaseToken: current.leaseToken!, authorize: () => check(true)});
      const result = await this.registry.execute(current.tool, current.input, context);
      const completed = await this.store.call<Action>('action.complete', {tenantId: current.tenantId, id: current.id,
        leaseToken: current.leaseToken, attemptId: current.attemptId, now: Date.now(), outcome: result.outcome==='failed'?'definite_failure':'success',
        ...(result.outcome==='failed'?{errorCode:'TASK_EXECUTION_FAILED'}:{}), result: json(result)});
      this.changed(completed);
      await this.onSettled?.(completed);
      this.lastFailure = null;
      return completed;
    } catch (error) {
      if (!action) throw error;
      const current = await this.store.call<Action>('action.inspect', {tenantId: action.tenantId, id: action.id});
      if (current.state !== 'running' || current.leaseToken !== action.leaseToken) {this.changed(current);return current;}
      const outcome = error instanceof IntegrationError
        ? error.outcome === 'unknown' ? 'unknown' : 'definite_failure'
        : dispatched ? 'unknown' : 'definite_failure';
      const completed = await this.store.call<Action>('action.complete', {tenantId: action.tenantId, id: action.id,
        leaseToken: action.leaseToken, attemptId: action.attemptId, now: Date.now(), outcome,
        errorCode: error instanceof OperatorError ? error.code : 'EXECUTION_FAILED', result: null});
      this.changed(completed);
      return completed;
    } finally { this.execution=null;this.active = false; complete(); }
  }

  async drain(): Promise<void> { await this.runOne(); }

  async cancel(context:Invocation,id:string):Promise<Action>{
    const action=await this.store.call<Action>('action.cancel',{tenantId:context.actor.tenantId,actorId:context.actor.id,id,now:Date.now()});
    if(this.execution?.tenantId===action.tenantId&&this.execution.id===id)this.execution.controller.abort(new OperatorError('CANCELLED','The action was cancelled.',409));
    this.changed(action);return action;
  }

  changed(action: Action): void {
    this.bus.publish({id: randomUUID(), kind: 'action.changed', tenantId: action.tenantId, actorId: action.ownerId,
      conversationId: action.conversationId, at: Date.now(), data: actionView(action)});
  }

  async decide(context: Invocation, id: string, decision: 'approve' | 'deny', inputHash: string, fingerprint: string, eventKey: string): Promise<Action> {
    let action = await this.store.call<Action>('action.decide', {tenantId: context.actor.tenantId, actorId: context.actor.id,
      id, decision, inputHash, fingerprint, eventKey, secure: context.secure, now: Date.now()});
    if (action.state === 'approved') action = await this.store.call<Action>('action.enqueue', {tenantId: action.tenantId, id: action.id, now: Date.now()});
    this.changed(action);
    return action;
  }
}
