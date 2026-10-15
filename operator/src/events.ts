import type {OperatorEvent} from './contracts.js';

export class EventBus {
  private readonly listeners = new Set<(event: OperatorEvent) => void | Promise<void>>();
  subscriberFailures = 0;
  publish(event: OperatorEvent): void {
    for (const listener of this.listeners) {
      try { void Promise.resolve(listener(structuredClone(event))).catch(() => {this.subscriberFailures++;}); }
      catch { this.subscriberFailures++; }
    }
  }
  subscribe(tenantId: string, actorId: string, listener: (event: OperatorEvent) => void | Promise<void>): () => void {
    const scoped = (event: OperatorEvent) => {
      if (event.tenantId === tenantId && event.actorId === actorId) return listener(event);
    };
    this.listeners.add(scoped);
    return () => {this.listeners.delete(scoped);};
  }
}
