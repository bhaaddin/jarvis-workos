import {randomUUID} from 'node:crypto';
import type {Action, Actor, Invocation, ObjectValue, ToolOutput} from './contracts.js';
import {assert, OperatorError} from './errors.js';
import {evaluatePolicy} from './policy.js';
import {StoreContext, RecordedRejection, integer, json, object, text} from './store-context.js';
import {sensitivityRank} from './privacy.js';

export class ActionStore {
  constructor(private readonly store: StoreContext) {}

  load(tenant: string, id: string): Action {
    const row = this.store.get('SELECT * FROM actions WHERE tenant=? AND id=?', tenant, id);
    assert(row, 'NOT_FOUND', 'Action not found.', 404);
    const action = this.store.seal.open(text(row.payload, 1000000), `action:${tenant}:${row.owner}:${id}`) as unknown as Action;
    assert(action.tenantId === tenant && action.id === id && action.ownerId === row.owner
      && action.state === row.state && action.inputHash === this.store.seal.digest(action.input),
    'DATA_INTEGRITY', 'Action integrity verification failed.', 500);
    return action;
  }

  private save(action: Action): void {
    const payload = this.store.seal.seal(json(action), `action:${action.tenantId}:${action.ownerId}:${action.id}`);
    this.store.run(`INSERT INTO actions VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET
      state=excluded.state,not_before=excluded.not_before,expires=excluded.expires,lease_expires=excluded.lease_expires,payload=excluded.payload`,
    action.tenantId, action.ownerId, action.id, action.submissionKey, action.state, action.tool,
    action.createdAt, action.notBefore, action.expiresAt, action.leaseExpires, payload);
  }

  private transition(action: Action, state: Action['state'], reason: string, now: number, by = action.ownerId): void {
    const previous = action.state;
    action.state = state;
    action.stateRevision++;
    action.reason = reason;
    this.save(action);
    this.store.audit(action.tenantId, by, 'action.transition', {
      actionId: action.id, previous, next: state, reason, attemptId: action.attemptId,
      tool: action.tool, fingerprint: action.fingerprint, inputHash: action.inputHash,
      policyRevision: action.policyRevision, actorRevision: action.actorRevision,
    }, now, action.sensitivity);
    if (['awaiting_approval','succeeded','failed','uncertain','denied','expired','cancelled'].includes(state))
      this.store.notify(action.tenantId, action.ownerId, 'action.' + state,
        {actionId: action.id, tool: action.tool, state, reason}, now);
  }

  private context(action: Action, actor: Actor, signal = new AbortController().signal): Invocation {
    return {actor, environment: action.environment, conversationId: action.conversationId,
      intentId: action.intentId, channel: action.channel, secure: action.secure,
      confidence: action.confidence, source: action.source, signal};
  }

  private valid(action: Action, now: number): string | null {
    if (now >= action.expiresAt) return 'approval_expired';
    let actor: Actor;
    try { actor = this.store.actor(action.tenantId, action.ownerId); } catch { return 'actor_unavailable'; }
    if (actor.revision !== action.actorRevision) return 'actor_authority_changed';
    const current = this.store.skill(action.tool);
    if (!current.ready || current.fingerprint !== action.fingerprint || current.manifest.version !== action.toolVersion) return 'skill_changed';
    const rule = this.store.policy(action.tenantId, action.ownerId, action.tool, current.fingerprint);
    if (rule.revision !== action.policyRevision) return 'policy_changed';
    const decision = evaluatePolicy(this.context(action, actor), current.manifest, rule, current.fingerprint);
    if (decision.outcome === 'deny') return decision.reason;
    if (action.approvalKind === 'automatic' && decision.outcome !== 'allow') return 'automatic_authority_ended';
    if (action.approvalKind === 'manual') {
      let approver: Actor;
      try { approver = this.store.require(action.tenantId, action.approvedBy ?? '', ['actions.approve']); }
      catch { return 'approver_unavailable'; }
      if (approver.revision !== action.approverRevision) return 'approver_authority_changed';
      if (approver.id !== action.ownerId && !approver.permissions.includes('actions.approve_any')) return 'approver_scope_changed';
      if (!current.manifest.permissions.every(permission => approver.permissions.includes(permission))) return 'approver_permission_changed';
    }
    return null;
  }

  propose(args: ObjectValue): Action {
    return this.store.transaction(() => {
      const scope = object(args.scope);
      const now = integer(args.now);
      const tenant = text(scope.tenantId, 150), owner = text(scope.actorId, 150);
      const actor = this.store.actor(tenant, owner);
      const tool = this.store.skill(text(args.tool, 100));
      assert(tool.ready, 'TOOL_UNAVAILABLE', 'The skill is not ready.', 409);
      this.store.conversation(tenant, owner, text(scope.conversationId, 150));
      const input = object(args.input);
      const inputHash = this.store.seal.digest(input);
      const submissionKey = text(args.submissionKey, 200);
      const prior = this.store.get('SELECT id FROM actions WHERE tenant=? AND owner=? AND submission_key=?', tenant, owner, submissionKey);
      if (prior) {
        const existing = this.load(tenant, text(prior.id));
        assert(existing.inputHash === inputHash && existing.tool === tool.manifest.id && existing.fingerprint === tool.fingerprint,
          'IDEMPOTENCY_CONFLICT', 'The submission identity was reused for different work.', 409);
        return existing;
      }
      for (const row of this.store.all("SELECT id FROM actions WHERE tenant=? AND owner=? AND tool=? AND state='uncertain'", tenant, owner, tool.manifest.id)) {
        const uncertain = this.load(tenant, text(row.id));
        assert(uncertain.inputHash !== inputHash, 'RECONCILIATION_REQUIRED', 'A matching earlier action has an unknown outcome. Reconcile it before trying again.', 409);
      }
      const confidence = scope.confidence === 'high' || scope.confidence === 'medium' || scope.confidence === 'low' ? scope.confidence : 'unknown';
      const source = scope.source === 'user' || scope.source === 'approved_schedule' ? scope.source : 'untrusted';
      const channel = text(scope.channel, 30) as Invocation['channel'];
      assert(['web','voice','telegram','whatsapp','phone','scheduler'].includes(channel), 'INVALID_CHANNEL', 'Unknown channel.');
      const rule = this.store.policy(tenant, owner, tool.manifest.id, tool.fingerprint);
      const invocation: Invocation = {actor, environment: this.store.environment, conversationId: text(scope.conversationId),
        intentId: text(scope.intentId, 150), channel, secure: scope.secure === true, confidence, source, signal: new AbortController().signal};
      const decision = evaluatePolicy(invocation, tool.manifest, rule, tool.fingerprint);
      const pending = this.store.get("SELECT COUNT(*) total FROM actions WHERE tenant=? AND owner=? AND state IN ('awaiting_approval','approved','queued','running')", tenant, owner);
      assert(Number(pending?.total ?? 0) < 50, 'QUEUE_LIMIT', 'Too many actions are pending. Review the existing queue first.', 429);
      const action: Action = {id: randomUUID(), tenantId: tenant, environment: this.store.environment, ownerId: owner,
        conversationId: invocation.conversationId, intentId: invocation.intentId, tool: tool.manifest.id, toolVersion: tool.manifest.version,
        fingerprint: tool.fingerprint, state: 'awaiting_approval', input, inputHash, submissionKey, stateRevision: 0,
        sensitivity: tool.manifest.sensitivity, confidence, source, channel, secure: invocation.secure,
        actorRevision: actor.revision, policyRevision: rule.revision, reason: decision.reason, createdAt: now,
        expiresAt: now + 15 * 60_000, notBefore: now, approvedBy: null, approvedAt: null, approverRevision: null,
        approvalKind: null, leaseToken: null, leaseExpires: null, dispatchedAt: null, attempts: 0,
        attemptId: null, providerReceipt: null, result: null, errorCode: null};
      if (decision.outcome === 'allow') {
        action.approvalKind = 'automatic'; action.approvedAt = now;
      }
      const state = decision.outcome === 'deny' ? 'denied' : decision.outcome === 'approval' ? 'awaiting_approval' : 'approved';
      this.transition(action, state, decision.reason, now);
      this.store.audit(tenant, owner, 'action.proposed', {actionId: action.id, tool: action.tool, input, decision: json(decision)}, now, action.sensitivity);
      return action;
    });
  }

  decide(args: ObjectValue): Action {
    return this.store.transaction(() => {
      const tenant = text(args.tenantId), actor = this.store.require(tenant, text(args.actorId), ['actions.approve']);
      const action = this.load(tenant, text(args.id));
      assert(actor.id === action.ownerId || actor.permissions.includes('actions.approve_any'), 'FORBIDDEN', 'This action belongs to another account.', 403);
      if (action.sensitivity === 'pii' || action.sensitivity === 'phi') assert(args.secure === true, 'SECURE_CHANNEL_REQUIRED', 'Review this action in the secure application.', 403);
      const eventKey = text(args.eventKey, 240), decision = text(args.decision, 20), now = integer(args.now);
      assert(decision === 'approve' || decision === 'deny', 'INVALID_DECISION', 'Choose approve or deny.');
      const repeated = this.store.get('SELECT payload FROM approvals WHERE tenant=? AND event_key=?', tenant, eventKey);
      if (repeated) {
        const saved = object(this.store.seal.open(text(repeated.payload, 100000), `approval-event:${tenant}:${eventKey}`));
        assert(saved.actionId === action.id && saved.actorId === actor.id && saved.decision === decision, 'APPROVAL_REPLAY_CONFLICT', 'This approval event belongs to a different decision.', 409);
        return action;
      }
      assert(action.state === 'awaiting_approval', 'ACTION_ALREADY_SETTLED', 'This proposal has already been decided.', 409);
      assert(text(args.inputHash, 100) === action.inputHash && text(args.fingerprint, 100) === action.fingerprint,
        'PROPOSAL_CHANGED', 'The displayed proposal is stale. Reload it before deciding.', 409);
      const refusal = this.valid(action, now);
      if (refusal) {
        this.transition(action, refusal === 'approval_expired' ? 'expired' : 'denied', refusal, now, actor.id);
        throw new RecordedRejection('PROPOSAL_STALE', 'The proposal is no longer authorized. Create a fresh proposal.', 409);
      }
      const tool = this.store.skill(action.tool);
      assert(tool.manifest.permissions.every(permission => actor.permissions.includes(permission)), 'FORBIDDEN', 'The approver lacks the action permission.', 403);
      const decisionId = randomUUID();
      const evidence = {actionId: action.id, actorId: actor.id, actorRevision: actor.revision, decision,
        inputHash: action.inputHash, fingerprint: action.fingerprint, at: now, eventKey};
      this.store.run('INSERT INTO approvals VALUES(?,?,?,?,?,?,?)', tenant, decisionId, action.id, actor.id, eventKey,
        this.store.seal.seal(evidence, `approval-event:${tenant}:${eventKey}`), now);
      if (decision === 'approve') {
        action.approvedBy = actor.id; action.approverRevision = actor.revision; action.approvedAt = now; action.approvalKind = 'manual';
        action.notBefore = now + (tool.manifest.risk === 'external_write' ? 10_000 : 0);
      }
      this.transition(action, decision === 'approve' ? 'approved' : 'denied', `manual_${decision}`, now, actor.id);
      return action;
    });
  }

  enqueue(args: ObjectValue): Action {
    return this.store.transaction(() => {
      const action = this.load(text(args.tenantId), text(args.id)), now = integer(args.now);
      assert(action.state === 'approved', 'NOT_APPROVED', 'Approval is required before execution can be queued.', 409);
      const refusal = this.valid(action, now);
      if (refusal) {
        this.transition(action, refusal === 'approval_expired' ? 'expired' : 'denied', refusal, now);
        throw new RecordedRejection('AUTHORITY_CHANGED', 'Action authority changed before queue admission.', 409);
      }
      this.transition(action, 'queued', 'execution_admitted', now);
      return action;
    });
  }

  claim(args: ObjectValue): Action | null {
    return this.store.transaction(() => {
      const now = integer(args.now), leaseMs = integer(args.leaseMs, 1000, 120_000);
      for (const row of this.store.all("SELECT tenant,id FROM actions WHERE state='running' AND lease_expires<=?", now)) {
        const stale = this.load(text(row.tenant), text(row.id));
        stale.leaseToken = null; stale.leaseExpires = null;
        this.transition(stale, stale.dispatchedAt === null ? 'queued' : 'uncertain',
          stale.dispatchedAt === null ? 'lease_expired_before_dispatch' : 'dispatch_outcome_unknown', now);
      }
      const selected = typeof args.id === 'string'
        ? this.store.all("SELECT tenant,id FROM actions WHERE tenant=? AND id=? AND state='queued' AND not_before<=?", text(args.tenantId), args.id, now)
        : this.store.all("SELECT tenant,id FROM actions WHERE state='queued' AND not_before<=? ORDER BY created LIMIT 20", now);
      for (const row of selected) {
        const action = this.load(text(row.tenant), text(row.id));
        const refusal = this.valid(action, now);
        if (refusal) { this.transition(action, refusal === 'approval_expired' ? 'expired' : 'denied', refusal, now); continue; }
        action.leaseToken = randomUUID(); action.leaseExpires = now + leaseMs;
        action.attemptId = randomUUID(); action.attempts++; action.dispatchedAt = null;
        this.transition(action, 'running', 'execution_leased', now);
        this.store.run('INSERT INTO attempts VALUES(?,?,?,?,?)', action.tenantId, action.attemptId, action.id,
          this.store.seal.seal(json({leaseToken: action.leaseToken, attempt: action.attempts, startedAt: now}), `attempt:${action.tenantId}:${action.attemptId}`), now);
        return action;
      }
      return null;
    });
  }

  authorize(args: ObjectValue): Action {
    return this.store.transaction(() => {
      const action = this.load(text(args.tenantId), text(args.id)), now = integer(args.now);
      assert(action.state === 'running' && action.leaseToken === args.leaseToken && (action.leaseExpires ?? 0) > now,
        'LEASE_LOST', 'Execution authority is no longer current.', 409);
      const refusal = this.valid(action, now);
      if (refusal) {
        this.transition(action, action.dispatchedAt === null ? 'denied' : 'uncertain', refusal, now);
        throw new RecordedRejection('AUTHORITY_CHANGED', 'Authority changed before the external request.', 409);
      }
      if (args.dispatch !== true) return action;
      assert(action.dispatchedAt === null, 'ALREADY_DISPATCHED', 'This attempt has already authorized its effect.', 409);
      const rule = this.store.policy(action.tenantId, action.ownerId, action.tool, action.fingerprint);
      const minute = Number(this.store.get('SELECT COUNT(*) total FROM usage_reservations WHERE tenant=? AND owner=? AND tool=? AND created>?', action.tenantId, action.ownerId, action.tool, now - 60_000)?.total ?? 0);
      const day = Number(this.store.get('SELECT COUNT(*) total FROM usage_reservations WHERE tenant=? AND owner=? AND tool=? AND created>?', action.tenantId, action.ownerId, action.tool, now - 86_400_000)?.total ?? 0);
      const globalMinute = Number(this.store.get('SELECT COUNT(*) total FROM usage_reservations WHERE tenant=? AND owner=? AND created>?', action.tenantId, action.ownerId, now - 60_000)?.total ?? 0);
      const globalDay = Number(this.store.get('SELECT COUNT(*) total FROM usage_reservations WHERE tenant=? AND owner=? AND created>?', action.tenantId, action.ownerId, now - 86_400_000)?.total ?? 0);
      if (minute >= rule.maxPerMinute || day >= rule.maxPerDay || globalMinute >= 10 || globalDay >= 500) {
        action.notBefore = now + (day >= rule.maxPerDay || globalDay >= 500 ? 60 * 60_000 : 60_000);
        action.leaseToken = null; action.leaseExpires = null;
        this.transition(action, 'queued', 'rate_limit_wait', now);
        throw new RecordedRejection('RATE_LIMITED', 'This action is waiting for its rate-limit window.', 429, true);
      }
      this.store.run('INSERT INTO usage_reservations VALUES(?,?,?,?,?,?)', randomUUID(), action.tenantId, action.ownerId, action.tool, action.id, now);
      action.dispatchedAt = now;
      this.transition(action, 'running', 'dispatch_authorized', now);
      return action;
    });
  }

  complete(args: ObjectValue): Action {
    return this.store.transaction(() => {
      const action = this.load(text(args.tenantId), text(args.id)), now = integer(args.now);
      const outcome = text(args.outcome, 30);
      assert(['success','definite_failure','unknown'].includes(outcome), 'INVALID_OUTCOME', 'Unknown execution outcome.');
      if (action.state !== 'running' || action.leaseToken !== args.leaseToken || (action.leaseExpires ?? 0) <= now) {
        const id = randomUUID();
        this.store.run('INSERT INTO late_receipts VALUES(?,?,?,?,?)', action.tenantId, id, action.id,
          this.store.seal.seal(json(args), `late:${action.tenantId}:${id}`), now);
        this.store.audit(action.tenantId, action.ownerId, 'action.late_receipt', {actionId: action.id, attemptId: args.attemptId ?? null, outcome}, now);
        throw new RecordedRejection('STALE_COMPLETION', 'A late result was retained for reconciliation; it did not overwrite current state.', 409);
      }
      assert(outcome !== 'success' || action.dispatchedAt !== null, 'DISPATCH_NOT_RECORDED', 'An effect cannot succeed without dispatch authorization.', 409);
      action.result = args.result === null || args.result === undefined ? null : object(args.result) as unknown as ToolOutput;
      if (action.result) {
        assert(Object.hasOwn(sensitivityRank, action.result.sensitivity), 'TOOL_OUTPUT_INVALID', 'A result sensitivity classification is required.', 502);
        if (sensitivityRank[action.result.sensitivity] > sensitivityRank[action.sensitivity]) action.sensitivity = action.result.sensitivity;
      }
      action.providerReceipt = args.receipt === null || args.receipt === undefined ? null : object(args.receipt);
      action.errorCode = args.errorCode === null || args.errorCode === undefined ? null : text(args.errorCode, 100);
      action.leaseToken = null; action.leaseExpires = null;
      this.transition(action, outcome === 'success' ? 'succeeded' : outcome === 'unknown' ? 'uncertain' : 'failed', outcome, now);
      this.store.audit(action.tenantId, action.ownerId, 'action.result', {actionId: action.id, outcome,
        result: action.result ? json(action.result) : null, receipt: action.providerReceipt}, now, action.sensitivity);
      return action;
    });
  }

  cancel(args: ObjectValue): Action {
    return this.store.transaction(() => {
      const tenant = text(args.tenantId), actor = this.store.require(tenant, text(args.actorId), ['actions.cancel']);
      const action = this.load(tenant, text(args.id)), now = integer(args.now);
      assert(actor.id === action.ownerId || actor.permissions.includes('actions.approve_any'), 'FORBIDDEN', 'This action belongs to another account.', 403);
      assert(!['succeeded','undone','failed','denied','expired','cancelled'].includes(action.state), 'ACTION_TERMINAL', 'The action already has a terminal result.', 409);
      action.leaseToken = null; action.leaseExpires = null;
      this.transition(action, action.dispatchedAt === null ? 'cancelled' : 'uncertain',
        action.dispatchedAt === null ? 'cancelled_before_dispatch' : 'cancel_requested_after_dispatch', now, actor.id);
      return action;
    });
  }

  visible(args: ObjectValue): Action {
    const tenant = text(args.tenantId), actor = this.store.require(tenant, text(args.actorId), ['actions.read']);
    const action = this.load(tenant, text(args.id));
    assert(actor.id === action.ownerId || actor.permissions.includes('actions.approve_any'), 'NOT_FOUND', 'Action not found.', 404);
    if (action.sensitivity === 'pii' || action.sensitivity === 'phi') assert(args.secure === true, 'SECURE_CHANNEL_REQUIRED', 'Use the secure application for this action.', 403);
    return action;
  }
}
