import { describe, expect, it, vi } from "vitest";
import { TaskRequests } from "./taskRequests";

const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

describe("foreground task ownership", () => {
  it("allows a replacement only after interruption and stale settlement cannot clear it", async () => {
    const cancelled = vi.fn(async (_id: string) => {}), failed = vi.fn();
    const requests = new TaskRequests(cancelled, failed), firstParent = new AbortController();
    const first = requests.begin(firstParent.signal);
    expect(() => requests.begin()).toThrow("preceding task");
    firstParent.abort();
    const second = requests.begin();
    expect(first.signal.aborted).toBe(true);
    expect(first.finish()).toBe(false);
    requests.cancel(); requests.cancel(); await flush();
    expect(cancelled.mock.calls.map(call => call[0])).toEqual([first.id, second.id]);
    expect(first.id).not.toBe(second.id);
    expect(second.finish()).toBe(true);
    expect(failed).not.toHaveBeenCalled();
  });

  it("does not cancel a completed request or manufacture one from an already-aborted signal", async () => {
    const cancelled = vi.fn(async (_id: string) => {}), requests = new TaskRequests(cancelled, () => {});
    const parent = new AbortController(), done = requests.begin(parent.signal);
    expect(done.finish()).toBe(true); parent.abort(); requests.cancel();
    expect(() => requests.begin(parent.signal)).toThrow();
    await flush(); expect(cancelled).not.toHaveBeenCalled();
  });

  it("reports uncertain cancellation and distinguishes navigation from ending a call", async () => {
    const cancelled = vi.fn(async (_id: string) => { throw new Error("Synthetic lost acknowledgement"); }), failed = vi.fn();
    const requests = new TaskRequests(cancelled, failed), typed = requests.begin();
    requests.dispose(); expect(typed.signal.aborted).toBe(true); await flush();
    expect(cancelled).not.toHaveBeenCalled();
    const voice = requests.begin(new AbortController().signal);
    requests.dispose(); await flush();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(cancelled).toHaveBeenCalledWith(voice.id);
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
