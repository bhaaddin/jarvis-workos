type RequestState = {
  id: string;
  controller: AbortController;
  parent?: AbortSignal;
  cancelled: boolean;
  finished: boolean;
  detach(): void;
  cancel(): void;
};

/** One foreground request; an interrupted predecessor may settle asynchronously. */
export class TaskRequests {
  private current: RequestState | null = null;

  constructor(private cancelRemote: (id: string) => Promise<unknown>, private cancellationFailed: () => void) {}

  begin(parent?: AbortSignal) {
    parent?.throwIfAborted();
    if (this.current && !this.current.controller.signal.aborted)
      throw new Error("The preceding task is still active.");
    const job: RequestState = {
      id: crypto.randomUUID(), controller: new AbortController(), parent,
      cancelled: false, finished: false,
      detach: () => parent?.removeEventListener("abort", job.cancel),
      cancel: () => {
        if (job.cancelled || job.finished) return;
        job.cancelled = true;
        job.controller.abort();
        // The immutable request ID makes a late cancellation harmless to a
        // replacement question. Never cancel the entire conversation here.
        void Promise.resolve().then(() => this.cancelRemote(job.id)).catch(() => this.cancellationFailed());
      },
    };
    this.current = job;
    parent?.addEventListener("abort", job.cancel, { once: true });
    if (parent?.aborted) job.cancel();
    return {
      id: job.id, signal: job.controller.signal,
      finish: () => {
        job.finished = true;
        job.detach();
        if (this.current !== job) return false;
        this.current = null;
        return true;
      },
    };
  }

  cancel() { this.current?.cancel(); }

  dispose() {
    const job = this.current;
    if (!job) return;
    // Leaving a voice call cancels its run. Navigating away from a typed task
    // merely detaches the browser; its durable job remains inspectable.
    if (job.parent) job.cancel();
    else job.controller.abort();
    job.detach();
    this.current = null;
  }
}
