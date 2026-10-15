import type {Invocation, PolicyDecision, PolicyRule, ToolManifest} from './contracts.js';

export function evaluatePolicy(context: Invocation, tool: ToolManifest, rule: PolicyRule, fingerprint: string): PolicyDecision {
  if (rule.tenantId !== context.actor.tenantId || rule.ownerId !== context.actor.id
      || rule.environment !== context.environment || rule.tool !== tool.id) {
    return {outcome: 'deny', reason: 'policy_scope_mismatch'};
  }
  if (!tool.environments.includes(context.environment)) return {outcome: 'deny', reason: 'environment_not_allowed'};
  if (!context.actor.active) return {outcome: 'deny', reason: 'actor_inactive'};
  if (!tool.permissions.every(permission => context.actor.permissions.includes(permission))) {
    return {outcome: 'deny', reason: 'missing_permission'};
  }
  if (!context.secure && (tool.sensitivity === 'pii' || tool.sensitivity === 'phi')) {
    return {outcome: 'deny', reason: 'secure_channel_required'};
  }
  if (tool.risk === 'read') return {outcome: 'allow', reason: 'authorized_read'};
  if (context.source === 'untrusted') return {outcome: 'approval', reason: 'untrusted_source'};
  if (context.confidence !== 'high') return {outcome: 'approval', reason: 'uncertainty_requires_review'};
  if (tool.risk === 'internal_write') return {outcome: 'allow', reason: 'authorized_internal_change'};
  if (rule.automatic && rule.fingerprint === fingerprint) return {outcome: 'allow', reason: 'explicit_action_whitelist'};
  return {outcome: 'approval', reason: 'confirmation_required'};
}
