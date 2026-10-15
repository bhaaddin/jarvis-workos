export type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
export type ObjectValue = {[key: string]: Json};
export type Environment = 'dev' | 'staging' | 'prod';
export type Channel = 'web' | 'voice' | 'telegram' | 'whatsapp' | 'phone' | 'scheduler';
export type Sensitivity = 'public' | 'internal' | 'pii' | 'phi';
export type Confidence = 'high' | 'medium' | 'low' | 'unknown';
export type Risk = 'read' | 'internal_write' | 'external_write' | 'money' | 'code' | 'automation';
export type ActionState = 'awaiting_approval' | 'approved' | 'queued' | 'running' | 'succeeded'
  | 'failed' | 'denied' | 'expired' | 'cancelled' | 'uncertain' | 'undone';

export interface Actor {
  id: string;
  tenantId: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  revision: number;
  active: boolean;
  language: 'en' | 'cs';
  timezone: string;
}

export interface Invocation {
  actor: Actor;
  environment: Environment;
  conversationId: string;
  intentId: string;
  channel: Channel;
  secure: boolean;
  confidence: Confidence;
  source: 'user' | 'approved_schedule' | 'untrusted';
  signal: AbortSignal;
}

export interface ToolManifest {
  manifestVersion: 1;
  id: string;
  version: string;
  description: string;
  handler: string;
  environments: Environment[];
  permissions: string[];
  risk: Risk;
  serviceOperations: string[];
  sensitivity: Sensitivity;
  requires: string[];
  inputSchema: ObjectValue;
  outputSchema: ObjectValue;
  idempotent: boolean;
  supportsUndo: boolean;
  publicProjection: boolean;
  timeoutMs: number;
  providerMode?: 'live' | 'fixture';
}

export interface ToolOutput {
  data: Json;
  sensitivity: Sensitivity;
  outcome?: 'success' | 'failed';
  publicSummary?: {kind: string; data: ObjectValue};
  provenance?: {provider: string; mode: 'fixture' | 'live'; observedAt: string};
  undo?: ObjectValue;
}

export interface ToolContext extends Invocation {
  actionId: string;
  idempotencyKey: string;
  services: ToolServices;
  assertCurrent(): Promise<void>;
}

export interface ToolServices {
  invoke(name: string, input: ObjectValue): Promise<ToolOutput>;
}

export type ToolHandler = (input: ObjectValue, context: ToolContext) => Promise<ToolOutput>;

export interface SkillHealth {
  id: string;
  version: string;
  fingerprint: string;
  enabled: boolean;
  state: 'ready' | 'missing_config' | 'disabled' | 'invalid' | 'changed_without_version';
  mode: 'fixture' | 'live';
  missing: string[];
  reason?: string;
}

export interface PolicyRule {
  tenantId: string;
  ownerId: string;
  environment: Environment;
  tool: string;
  fingerprint: string;
  automatic: boolean;
  revision: number;
  maxPerMinute: number;
  maxPerDay: number;
}

export interface PolicyDecision {
  outcome: 'allow' | 'approval' | 'deny';
  reason: string;
}

export interface Action {
  id: string;
  tenantId: string;
  environment: Environment;
  ownerId: string;
  conversationId: string;
  intentId: string;
  tool: string;
  toolVersion: string;
  fingerprint: string;
  state: ActionState;
  input: ObjectValue;
  inputHash: string;
  submissionKey: string;
  stateRevision: number;
  sensitivity: Sensitivity;
  confidence: Confidence;
  source: Invocation['source'];
  channel: Channel;
  secure: boolean;
  actorRevision: number;
  policyRevision: number;
  reason: string;
  createdAt: number;
  expiresAt: number;
  notBefore: number;
  approvedBy: string | null;
  approvedAt: number | null;
  approverRevision: number | null;
  approvalKind: 'manual' | 'automatic' | null;
  leaseToken: string | null;
  leaseExpires: number | null;
  dispatchedAt: number | null;
  attempts: number;
  attemptId: string | null;
  providerReceipt: ObjectValue | null;
  result: ToolOutput | null;
  errorCode: string | null;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  /** Ephemeral provider continuation only; never append to history/audit/UI. */
  thinking?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {name: string; arguments: string};
}

export interface ModelResponse {
  text: string;
  calls: ToolCall[];
  usage?: ObjectValue;
  /** Kept only for tool continuation inside the current run. */
  thinking?: string;
}

export interface Model {
  complete(messages: AgentMessage[], tools: ObjectValue[], signal: AbortSignal,
    onText?: (text: string) => void, toolChoice?: 'auto' | 'required' | 'none'): Promise<ModelResponse>;
}

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface OperatorEvent {
  id: string;
  kind: string;
  tenantId: string;
  actorId: string;
  conversationId?: string;
  at: number;
  data: ObjectValue;
}
