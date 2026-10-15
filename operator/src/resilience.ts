import {setTimeout as delay} from 'node:timers/promises';
import type {Clock} from './contracts.js';
import {OperatorError} from './errors.js';

export const systemClock: Clock = {now: () => Date.now(), sleep: async (ms, signal) => { await delay(ms, undefined, {signal}); }};

export class IntegrationError extends OperatorError {
  constructor(code: string, message: string, public readonly outcome: 'not_sent' | 'rejected' | 'unknown',
    status = 503, retryable = false) { super(code, message, status, retryable); }
}

interface Circuit {failures: number; openUntil: number; probe: boolean}
interface RequestOptions {
  integration: string;
  url: URL;
  method: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal: AbortSignal;
  safety: 'read' | 'provider_idempotent' | 'non_idempotent';
  idempotencyKey?: string;
  timeoutMs?: number;
  maximumBytes?: number;
  acceptedStatuses?: readonly number[];
  beforeSend?: () => Promise<void>;
  onRetry?: (attempt: number, delayMs: number) => void;
}

export class ResilientHttp {
  private readonly circuits = new Map<string, Circuit>();
  constructor(private readonly clock: Clock = systemClock, private readonly fetcher: typeof fetch = fetch,
    private readonly jitter: () => number = Math.random) {}

  async request(options: RequestOptions): Promise<{status: number; headers: Headers; body: Uint8Array}> {
    const circuit = this.circuits.get(options.integration) ?? {failures: 0, openUntil: 0, probe: false};
    this.circuits.set(options.integration, circuit);
    if (circuit.openUntil > this.clock.now() || circuit.probe) {
      throw new IntegrationError('CIRCUIT_OPEN', 'This integration is temporarily unavailable. Its retry window has not opened.', 'not_sent');
    }
    const halfOpen = circuit.failures >= 3;
    if (halfOpen) circuit.probe = true;
    const timeout = options.timeoutMs ?? 15000;
    const end = this.clock.now() + timeout;
    const repeatable = options.safety === 'read' || (options.safety === 'provider_idempotent' && Boolean(options.idempotencyKey));
    const attempts = repeatable ? 3 : 1;
    let sent = false;
    try {
      for (let attempt = 0; attempt < attempts; attempt++) {
        options.signal.throwIfAborted();
        if (this.clock.now() >= end) throw new IntegrationError('INTEGRATION_TIMEOUT', 'The integration did not respond before its deadline.', sent && !repeatable ? 'unknown' : 'not_sent');
        const signal = AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, end - this.clock.now()))]);
        try {
          await options.beforeSend?.();
          signal.throwIfAborted();
          sent = true;
          const response = await this.fetcher(options.url, {
            method: options.method, ...(options.headers ? {headers: options.headers} : {}),
            body: options.body === undefined ? null : typeof options.body === 'string' ? options.body : new Uint8Array(options.body),
            signal, redirect: 'error',
          });
          if (response.status === 429 || response.status >= 500) {
            await response.body?.cancel();
            if (attempt + 1 < attempts) {
              const retryAfter = Number(response.headers.get('retry-after'));
              const wait = Math.min(30000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt + this.jitter() * 100);
              if (this.clock.now() + wait < end) { options.onRetry?.(attempt + 1, wait); await this.clock.sleep(wait, options.signal); continue; }
            }
            throw new IntegrationError(response.status === 429 ? 'INTEGRATION_RATE_LIMITED' : 'INTEGRATION_UNAVAILABLE',
              'The integration could not confirm this request.', options.safety === 'non_idempotent' ? 'unknown' : 'rejected', 503, repeatable);
          }
          if (!response.ok && !options.acceptedStatuses?.includes(response.status)) {
            await response.body?.cancel();
            throw new IntegrationError(response.status === 401 || response.status === 403 ? 'INTEGRATION_AUTH_REQUIRED' : 'INTEGRATION_REJECTED',
              'The integration rejected the request. Check its account configuration or the referenced record.', 'rejected', 502);
          }
          const maximum = options.maximumBytes ?? 2 * 1024 * 1024;
          const chunks: Uint8Array[] = [];
          let total = 0;
          const reader = response.body?.getReader();
          try {
            if (reader) for (;;) {
              const item = await reader.read();
              if (item.done) break;
              total += item.value.length;
              if (total > maximum) throw new IntegrationError('RESPONSE_TOO_LARGE', 'The integration response exceeded its limit.', options.safety === 'read' ? 'rejected' : 'unknown', 502);
              chunks.push(item.value);
            }
          } finally { await reader?.cancel().catch(() => {}); }
          circuit.failures = 0; circuit.openUntil = 0;
          return {status: response.status, headers: response.headers, body: Buffer.concat(chunks)};
        } catch (error) {
          if (options.signal.aborted) throw options.signal.reason;
          if (error instanceof OperatorError) throw error;
          if (attempt + 1 < attempts) {
            const wait = 250 * 2 ** attempt + this.jitter() * 100;
            if (this.clock.now() + wait < end) { options.onRetry?.(attempt + 1, wait); await this.clock.sleep(wait, options.signal); continue; }
          }
          throw new IntegrationError('INTEGRATION_CONNECTION_FAILED', 'The integration connection failed.', sent && !repeatable ? 'unknown' : 'not_sent', 503, repeatable);
        }
      }
      throw new IntegrationError('INTEGRATION_TIMEOUT', 'The integration did not finish.', 'unknown');
    } catch (error) {
      if (error instanceof IntegrationError && !['INTEGRATION_REJECTED','INTEGRATION_AUTH_REQUIRED'].includes(error.code)) {
        circuit.failures++;
        if (circuit.failures >= 3) circuit.openUntil = this.clock.now() + 30000;
      }
      throw error;
    } finally { circuit.probe = false; }
  }

  status(): Array<{integration: string; failures: number; openUntil: number}> {
    return [...this.circuits].map(([integration, state]) => ({integration, failures: state.failures, openUntil: state.openUntil}));
  }
}
