import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChat, api, boundedApi } from "./api";
import type { ChatEvent } from "./api";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function response(parts: Uint8Array[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("assistant streaming", () => {
  it("bounds a stalled request instead of keeping call admission pending indefinitely", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_path, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    })));
    const result = boundedApi("/api/conversations/abort", {}, undefined, 25);
    const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(30);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("includes JSON-body reading in the request deadline and preserves caller cancellation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (_path, options) => new Response(new ReadableStream({
      start(controller) { options.signal.addEventListener("abort", () => controller.error(options.signal.reason), { once: true }); },
    }))));
    const timeout = boundedApi("/api/conversations/history", undefined, undefined, 25);
    const timed = expect(timeout).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(30); await timed;
    const controller = new AbortController();
    const cancelled = boundedApi("/api/conversations/history", undefined, controller.signal, 1000);
    const stopped = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await stopped;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not split an already-completed short voice answer into extra speech requests", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response('{"status":"running"}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "A complete short answer. One more sentence.", next_offset: 42, has_more: false, status: "completed" }))));
    const events: ChatEvent[] = [];
    await streamChat({ project: "fixture", thread: "turn", voice_mode: true }, (event) => events.push(event), new AbortController().signal);
    expect(events.map((event) => event.type)).toEqual(["start", "done"]);
    expect(events.at(-1)?.answer).toContain("One more sentence.");
  });
  it("delivers notebook voice deltas before completion using replayable server cursors", async () => {
    let finish!: (response: Response) => void;
    const terminal = new Promise<Response>((resolve) => { finish = resolve; });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{"status":"running"}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "Hello 🧠. ", next_offset: 9, has_more: true, status: "running" })))
      .mockReturnValueOnce(terminal);
    vi.stubGlobal("fetch", fetcher);
    const events: ChatEvent[] = [];
    const running = streamChat({ project: "fixture", thread: "turn", voice_mode: true }, (event) => events.push(event), new AbortController().signal);
    await vi.waitFor(() => expect(events.some((event) => event.type === "delta")).toBe(true));
    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(fetcher.mock.calls[2][0]).toContain("offset=9");
    finish(new Response(JSON.stringify({ text: "Next.", next_offset: 14, has_more: false, status: "completed" })));
    await running;
    expect(events.at(-1)?.answer).toBe("Hello 🧠. Next.");
  });
  it("uses a completed buffered reply on the notebook relay without SSE", async () => {
    vi.stubGlobal("document", { querySelector: () => ({ getAttribute: () => "true" }) });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ answer: "Notebook answer", thread: "test-thread" })));
    vi.stubGlobal("fetch", fetcher);
    const events: ChatEvent[] = [];
    await streamChat({ message: "Question", stream: true }, (event) => events.push(event), new AbortController().signal);
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).stream).toBe(false);
    expect(events).toEqual([{ type: "done", answer: "Notebook answer", thread: "test-thread" }]);
  });
  it("renews an expired local session once without retrying ambiguous failures", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":"expired"}', { status: 401 }),
      )
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(new Response('{"saved":true}'));
    vi.stubGlobal("fetch", fetcher);
    expect(await api("/api/preferences", { theme: "dark" })).toEqual({
      saved: true,
    });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "/api/preferences",
      "/api/session",
      "/api/preferences",
    ]);
    fetcher
      .mockReset()
      .mockResolvedValue(
        new Response('{"error":"upstream failed"}', { status: 503 }),
      );
    await expect(api("/api/chat", { message: "test" })).rejects.toThrow(
      "upstream failed",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves UTF-8 and CRLF framing at every byte split", async () => {
    const raw = new TextEncoder().encode(
      'data: {"type":"delta","text":"Žluťoučký 🧠"}\r\n\r\ndata: {"type":"done","answer":"Žluťoučký 🧠"}\r\n\r\n',
    );
    for (let split = 0; split <= raw.length; split++) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response([raw.slice(0, split), raw.slice(split)])),
      );
      const events: ChatEvent[] = [];
      await streamChat(
        {},
        (event) => events.push(event),
        new AbortController().signal,
      );
      expect(events.map((event) => event.type)).toEqual(["delta", "done"]);
      expect(events[0].text).toBe("Žluťoučký 🧠");
    }
  });
  it("never resubmits a rejected business login, but renews a proven pre-admission Hub session failure", async () => {
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('{"error":"Clinic sign-in rejected"}',{status:401}));
    vi.stubGlobal('fetch',fetcher);
    await expect(api('/api/operator/connections/clinic',{email:'synthetic@example.test',password:'synthetic'})).rejects.toThrow('Clinic sign-in rejected');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockReset().mockResolvedValueOnce(new Response('{"error":"expired"}',{status:401,headers:{'X-Jarvis-Session-Rejected':'true'}}))
      .mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('{"connected":true}'));
    expect(await api('/api/operator/connections/clinic',{email:'synthetic@example.test',password:'synthetic'})).toEqual({connected:true});
    expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['/api/operator/connections/clinic','/api/session','/api/operator/connections/clinic']);
  });
  it("does not turn premature EOF or a server error into a completed answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response([
          new TextEncoder().encode(
            'data: {"type":"delta","text":"partial"}\n\n',
          ),
        ]),
      ),
    );
    await expect(
      streamChat({}, () => {}, new AbortController().signal),
    ).rejects.toThrow("before completion");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response([
          new TextEncoder().encode(
            'data: {"type":"error","error":"model failed"}\n\n',
          ),
        ]),
      ),
    );
    await expect(
      streamChat({}, () => {}, new AbortController().signal),
    ).rejects.toThrow("model failed");
  });
});
