import {Worker} from 'node:worker_threads';
import type {ObjectValue} from './contracts.js';
import {OperatorError} from './errors.js';

interface Reply {id: number; ok: boolean; value?: unknown; error?: {code: string; message: string; status: number}}

export class Store {
  private readonly worker: Worker;
  private sequence = 0;
  private closed = false;
  private readonly pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void}>();
  readonly ready: Promise<void>;

  constructor(options: {path: string; key: string; environment: string}) {
    this.worker = new Worker(new URL('./store-worker.js', import.meta.url), {workerData: options});
    this.worker.on('message', (reply: Reply) => {
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      if (reply.ok) pending.resolve(reply.value);
      else pending.reject(new OperatorError(reply.error?.code ?? 'STORE_ERROR', reply.error?.message ?? 'Storage operation failed.', reply.error?.status ?? 500));
    });
    this.worker.on('error', () => this.fail());
    this.worker.on('exit', () => this.fail());
    this.ready = this.call<void>('ready', {});
  }

  private fail(): void {
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(new OperatorError('STORE_UNAVAILABLE', 'Protected storage is unavailable.', 503));
    this.pending.clear();
  }

  call<T>(operation: string, args: ObjectValue): Promise<T> {
    if (this.closed) return Promise.reject(new OperatorError('STORE_UNAVAILABLE', 'Protected storage is unavailable.', 503));
    const id = ++this.sequence;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.worker.postMessage({id, operation, args});
    }) as Promise<T>; // One typed internal RPC boundary; the worker validates every operation.
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.call('close', {});
    this.closed = true;
    await this.worker.terminate();
  }
}
