import type {Actor, Channel, Invocation, ObjectValue} from './contracts.js';
import {AgentCore} from './agent.js';
import {Auth} from './auth.js';
import type {Config} from './config.js';
import {OperatorError, publicError} from './errors.js';
import {Store} from './store.js';
import {json} from './store-context.js';

interface ClaimedRun {id: string; conversationId: string; actor: Actor; message: string; channel: Channel; secure: boolean; source: Invocation['source']}

export class Runs {
  private active = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly stopping = new AbortController();
  private idle: Promise<void> = Promise.resolve();
  private pendingFinalization: ObjectValue | null = null;
  private current: {run: ClaimedRun; controller: AbortController} | null = null;
  lastFailure: ObjectValue | null = null;
  constructor(private readonly store: Store, private readonly core: AgentCore, private readonly auth: Auth, private readonly config: Config,
    private readonly admission?:{assertAdmission():void;canDrain():boolean}) {}

  async start(background = true): Promise<void> {
    await this.store.call('run.recover', {now: Date.now()});
    if (!background) return;
    this.timer = setInterval(() => {void this.drain().catch(error => {this.lastFailure = publicError(error);});}, 250);
    this.timer.unref();
  }

  async accept(message: string, context: Invocation): Promise<ObjectValue> {
    this.admission?.assertAdmission();
    this.stopping.signal.throwIfAborted();
    const result = await this.store.call<ObjectValue>('run.accept', {tenantId: context.actor.tenantId, actorId: context.actor.id,
      now: Date.now(), id: context.intentId, conversationId: context.conversationId, message,
      channel: context.channel, secure: context.secure, source: context.source});
    if (this.timer) setImmediate(() => {void this.drain().catch(error => {this.lastFailure = publicError(error);});});
    return result;
  }

  async drain(): Promise<void> {
    if(this.admission&&!this.admission.canDrain())return;
    if (this.active) return this.idle;
    if (this.stopping.signal.aborted) return;
    this.active = true;
    let complete!: () => void;
    this.idle = new Promise<void>(resolve => {complete = resolve;});
    let current: ClaimedRun | null = null;
    let release: (() => void) | undefined;
    try {
      if (this.pendingFinalization) {
        await this.store.call('run.finish', this.pendingFinalization);
        this.pendingFinalization = null; this.lastFailure = null;
        return;
      }
      current = await this.store.call<ClaimedRun | null>('run.claim', {now: Date.now()});
      if (!current) return;
      const controller = new AbortController(); this.current = {run: current, controller};
      const bound = this.auth.bind(current.actor, AbortSignal.any([this.stopping.signal, controller.signal])); release = bound.release;
      const recorded = await this.store.call<ObjectValue>('run.get', {tenantId:current.actor.tenantId,actorId:current.actor.id,id:current.id,now:Date.now(),secure:false});
      if (recorded.state !== 'running') return;
      const context: Invocation = {actor: current.actor, environment: this.config.environment, conversationId: current.conversationId,
        intentId: current.id, channel: current.channel, secure: current.secure, source: current.source, confidence: 'unknown', signal: bound.signal};
      let completion: ObjectValue;
      try {completion = {result:json(await this.core.run(current.message, context))};}
      catch (error) {completion = {error:publicError(error)};}
      // Persisting an outcome is idempotent. A failed acknowledgement must never
      // turn successful execution into an execution failure or rerun its tools.
      this.pendingFinalization = {tenantId: current.actor.tenantId, actorId: current.actor.id, id: current.id, now:Date.now(), ...completion};
      await this.store.call('run.finish', this.pendingFinalization);
      this.pendingFinalization = null;
      this.lastFailure = null;
    } catch (error) {
      this.lastFailure = publicError(error);
    } finally {release?.();this.current = null;this.active = false;complete();}
  }

  async cancel(actor: Actor, conversationId: string): Promise<ObjectValue> {
    const result = await this.store.call<ObjectValue>('run.cancel', {tenantId:actor.tenantId,actorId:actor.id,conversationId,now:Date.now()});
    const current = this.current;
    if (current?.run.actor.tenantId === actor.tenantId && current.run.actor.id === actor.id && current.run.conversationId === conversationId)
      current.controller.abort(new OperatorError('CANCELLED','The current request was cancelled.',409));
    this.core.cancel(actor, conversationId);
    return result;
  }

  async cancelRequest(actor: Actor, conversationId: string, id: string): Promise<ObjectValue> {
    const result = await this.store.call<ObjectValue>('run.cancel', {tenantId:actor.tenantId,actorId:actor.id,conversationId,id,now:Date.now()});
    const current = this.current;
    if (current?.run.id === id && current.run.conversationId === conversationId && current.run.actor.tenantId === actor.tenantId && current.run.actor.id === actor.id) {
      current.controller.abort(new OperatorError('CANCELLED','The current request was cancelled.',409));
      this.core.cancel(actor, conversationId);
    }
    return result;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.stopping.abort(new OperatorError('SHUTTING_DOWN', 'The assistant is stopping.', 503));
    await this.idle;
    if (this.pendingFinalization) await this.store.call('run.finish', this.pendingFinalization);
  }
}
