import { afterEach, describe, expect, it, vi } from "vitest";
import { callGreeting, VoiceConversation } from "./voiceConversation";
import type { ConversationState, SpeechEvents } from "./voiceConversation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

function fixture() {
  let events!: SpeechEvents;
  let signal!: AbortSignal;
  let enabled = false;
  const detector = {
    start: vi.fn(async () => { enabled = true; }),
    pause: vi.fn(async () => { enabled = false; }),
    destroy: vi.fn(async () => { enabled = false; }),
  };
  const state: ConversationState[] = [];
  const dependencies = {
    openDetector: vi.fn(async (value: AbortSignal, callbacks: SpeechEvents) => { signal = value; events = callbacks; return detector; }),
    transcribe: vi.fn(async () => "Synthetic question"),
    reply: vi.fn(async (_text: string, _signal: AbortSignal, _partial: (answer: string) => void) => "Synthetic answer"),
    speak: vi.fn(async (_text: string, _signal: AbortSignal, ready: () => Promise<void>) => { await ready(); }),
    update: (value: ConversationState) => state.push(value),
    error: vi.fn(),
  };
  const conversation = new VoiceConversation(dependencies);
  return { conversation, dependencies, detector, state,
    get events() { return events; }, get signal() { return signal; }, get enabled() { return enabled; } };
}

describe("one-button JARVIS call", () => {
  it("keeps listening during reasoning and a confirmed interruption discards the old answer", async () => {
    const f = fixture();
    const first = deferred<string>();
    let oldSignal!: AbortSignal;
    f.dependencies.reply.mockImplementationOnce(async (_text, signal) => { oldSignal = signal; return first.promise; });
    await f.conversation.start("");
    f.events.end(new Blob(["first question"])); await flush();
    expect(f.state.at(-1)?.phase).toBe("thinking");
    expect(f.enabled).toBe(true);
    f.events.start(); f.events.misfire();
    expect(oldSignal.aborted).toBe(false);
    expect(f.state.at(-1)?.phase).toBe("thinking");
    f.events.confirmed();
    expect(oldSignal.aborted).toBe(true);
    expect(f.signal.aborted).toBe(false);
    f.events.end(new Blob(["replacement question"])); await flush();
    first.resolve("Stale first answer must not be spoken"); await flush();
    expect(f.dependencies.reply).toHaveBeenCalledTimes(2);
    expect(f.dependencies.speak.mock.calls.map(call => call[0])).toEqual(["Synthetic answer"]);
    expect(f.state.at(-1)?.phase).toBe("listening");
    f.conversation.stop();
  });

  it("respects mute while reasoning without cancelling or losing the current answer", async () => {
    const f = fixture(), pending = deferred<string>();
    let signal!: AbortSignal;
    f.dependencies.reply.mockImplementationOnce(async (_text, value) => { signal = value; return pending.promise; });
    await f.conversation.start("");
    f.events.end(new Blob(["question"])); await flush();
    await f.conversation.setMuted(true);
    expect(f.enabled).toBe(false); expect(f.state.at(-1)?.inputReady).toBe(false);
    f.events.confirmed(); expect(signal.aborted).toBe(false);
    pending.resolve("The answer is retained."); await flush();
    expect(f.dependencies.speak.mock.calls[0][0]).toBe("The answer is retained.");
    expect(f.state.at(-1)?.muted).toBe(true); expect(f.enabled).toBe(false);
    await f.conversation.setMuted(false);
    expect(f.enabled).toBe(true); expect(f.state.at(-1)?.inputReady).toBe(true);
    f.conversation.stop();
  });

  it("ends an unanswered microphone request, releases a late device, and permits a fresh call", async () => {
    vi.useFakeTimers();
    const f = fixture(), pending = deferred<typeof f.detector>();
    let signal!: AbortSignal;
    f.dependencies.openDetector.mockImplementationOnce(async (value) => { signal = value; return pending.promise; });
    const starting = f.conversation.start();
    await vi.advanceTimersByTimeAsync(31000);
    expect(f.state.at(-1)?.phase).toBe("error");
    expect(f.state.at(-1)?.status).toMatch(/microphone.*permission|permission.*microphone/i);
    expect(signal.aborted).toBe(true);
    expect(f.conversation.active).toBe(false);
    await starting;
    pending.resolve(f.detector); await flush();
    expect(f.detector.destroy).toHaveBeenCalledTimes(1);
    expect(f.detector.start).not.toHaveBeenCalled();
    await f.conversation.start("");
    expect(f.state.at(-1)?.phase).toBe("listening");
    f.conversation.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds audio startup and destroys the detector when it never becomes ready", async () => {
    vi.useFakeTimers();
    const f = fixture(), pending = deferred<void>();
    f.detector.start.mockImplementationOnce(() => pending.promise);
    const starting = f.conversation.start(); await flush();
    await vi.advanceTimersByTimeAsync(11000);
    expect(f.state.at(-1)?.phase).toBe("error");
    expect(f.state.at(-1)?.status).toMatch(/audio/i);
    expect(f.detector.destroy).toHaveBeenCalledTimes(1);
    await starting;
    pending.resolve(); await flush();
    expect(f.dependencies.speak).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a stalled speech-engine stage and ignores old startup callbacks after retry", async () => {
    vi.useFakeTimers();
    const f = fixture(), pending = deferred<typeof f.detector>();
    let callbacks!: SpeechEvents;
    f.dependencies.openDetector.mockImplementationOnce(async (_signal, events) => {
      callbacks = events;
      events.preparing("speech-engine");
      return pending.promise;
    });
    const starting = f.conversation.start();
    expect(f.state.at(-1)?.status).toMatch(/loading speech detection/i);
    await vi.advanceTimersByTimeAsync(46000);
    await starting;
    expect(f.state.at(-1)?.phase).toBe("error");
    expect(f.state.at(-1)?.status).toMatch(/speech detection.*loading/i);
    await f.conversation.start("");
    callbacks.preparing("microphone");
    expect(f.state.at(-1)?.phase).toBe("listening");
    f.conversation.stop(); pending.resolve(f.detector); await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts a meaningful sentence before generation finishes and speaks the remainder once", async () => {
    const f = fixture();
    await f.conversation.start("");
    const answer = deferred<string>(), playback = deferred<void>();
    f.dependencies.reply.mockImplementationOnce(async (_text, _signal, partial) => {
      partial("The first meaningful answer is ready. More");
      return answer.promise;
    });
    f.dependencies.speak.mockImplementationOnce(async (_text, _signal, ready) => { await ready(); await playback.promise; });
    f.events.end(new Blob(["question"]));
    await flush();
    expect(f.dependencies.speak.mock.calls[0][0]).toBe("The first meaningful answer is ready.");
    expect(f.state.at(-1)?.phase).toBe("speaking");
    answer.resolve("The first meaningful answer is ready. More details are here.");
    await flush(); playback.resolve(); await flush();
    expect(f.dependencies.speak.mock.calls.map((call) => call[0])).toEqual([
      "The first meaningful answer is ready.", "More details are here.",
    ]);
    f.conversation.stop();
  });
  it("barge-in during early speech cancels unfinished model work without ending the call", async () => {
    const f = fixture();
    await f.conversation.start("");
    const answer = deferred<string>(), playback = deferred<void>();
    let turnSignal!: AbortSignal;
    f.dependencies.reply.mockImplementationOnce(async (_text, signal, partial) => {
      turnSignal = signal; partial("The first meaningful answer is ready. More"); return answer.promise;
    });
    f.dependencies.speak.mockImplementationOnce(async (_text, _signal, ready) => { await ready(); await playback.promise; });
    f.events.end(new Blob(["question"])); await flush();
    f.events.confirmed();
    expect(turnSignal.aborted).toBe(true);
    expect(f.signal.aborted).toBe(false);
    answer.resolve("The first meaningful answer is ready. Stale details."); playback.resolve(); await flush();
    expect(f.dependencies.speak).toHaveBeenCalledTimes(1);
    expect(f.state.at(-1)?.phase).toBe("hearing");
    f.conversation.stop();
  });
  it("greets once, starts its timer, and listens without a second action", async () => {
    const f = fixture();
    await f.conversation.start();
    await f.conversation.start();
    expect(f.dependencies.speak).toHaveBeenCalledTimes(1);
    expect(f.dependencies.speak.mock.calls[0][0]).toBe(callGreeting);
    expect(f.dependencies.reply).not.toHaveBeenCalled();
    expect(f.dependencies.openDetector).toHaveBeenCalledTimes(1);
    expect(f.state.at(-1)?.startedAt).toBeTypeOf("number");
    expect(f.state.at(-1)?.phase).toBe("listening");
    expect(f.enabled).toBe(true);
    f.conversation.stop();
  });

  it("user speech interrupts output, submits the next turn, and stale playback cannot overwrite it", async () => {
    const f = fixture();
    await f.conversation.start("");
    const oldAudio = deferred<void>();
    let outputSignal!: AbortSignal;
    f.dependencies.speak.mockImplementationOnce(async (_text, signal, ready) => {
      outputSignal = signal;
      await ready();
      await oldAudio.promise;
    });
    f.events.end(new Blob(["first"]));
    f.events.end(new Blob(["duplicate"]));
    await flush();
    expect(f.dependencies.reply).toHaveBeenCalledTimes(1);
    expect(f.enabled).toBe(true); // Detection is live DURING the assistant's audio.
    expect(f.state.at(-1)?.phase).toBe("speaking");
    f.events.start();
    expect(outputSignal.aborted).toBe(false); // A tiny VAD misfire does not cut him off.
    f.events.confirmed();
    expect(outputSignal.aborted).toBe(true);
    expect(f.signal.aborted).toBe(false); // The call remains connected.
    expect(f.state.at(-1)?.phase).toBe("hearing");
    const nextAnswer = deferred<string>();
    f.dependencies.reply.mockImplementationOnce(() => nextAnswer.promise);
    f.events.end(new Blob(["interruption"]));
    await flush();
    oldAudio.reject(new DOMException("Interrupted", "AbortError"));
    await flush();
    expect(f.state.at(-1)?.phase).toBe("thinking");
    expect(f.dependencies.error).not.toHaveBeenCalled();
    nextAnswer.resolve("Answer to the new question");
    await flush();
    expect(f.dependencies.reply).toHaveBeenCalledTimes(2);
    expect(f.state.at(-1)?.phase).toBe("listening");
    f.conversation.stop();
  });

  it("mute discards partial speech, blocks submissions, and unmute accepts only a fresh turn", async () => {
    const f = fixture();
    await f.conversation.start("");
    f.events.start();
    await f.conversation.setMuted(true);
    f.events.confirmed();
    f.events.end(new Blob(["muted"]));
    expect(f.enabled).toBe(false);
    expect(f.state.at(-1)?.muted).toBe(true);
    expect(f.dependencies.transcribe).not.toHaveBeenCalled();
    await f.conversation.setMuted(false);
    f.events.end(new Blob(["fresh"]));
    await flush();
    expect(f.dependencies.reply).toHaveBeenCalledTimes(1);
    expect(f.state.at(-1)?.muted).toBe(false);
    f.conversation.stop();
  });

  it("microphone mute keeps the current answer playing and remains muted after it ends", async () => {
    const f = fixture();
    const playback = deferred<void>();
    let signal!: AbortSignal;
    f.dependencies.speak.mockImplementationOnce(async (_text, value, ready) => {
      signal = value; await ready(); await playback.promise;
    });
    const start = f.conversation.start();
    await flush();
    await f.conversation.setMuted(true);
    expect(signal.aborted).toBe(false);
    playback.resolve();
    await start;
    expect(f.enabled).toBe(false);
    expect(f.state.at(-1)?.muted).toBe(true);
    f.conversation.stop();
  });

  it("silence, noise misfires, and empty transcripts do not submit questions", async () => {
    const f = fixture();
    await f.conversation.start("");
    f.events.start(); f.events.misfire();
    expect(f.dependencies.transcribe).not.toHaveBeenCalled();
    f.dependencies.transcribe.mockResolvedValueOnce(" ");
    f.events.end(new Blob(["unrecognized"]));
    await flush();
    expect(f.dependencies.reply).not.toHaveBeenCalled();
    expect(f.state.at(-1)?.phase).toBe("listening");
    f.conversation.stop();
  });

  it.each(["transcribe", "reply", "speak"] as const)("hangup during %s cancels the operation and prevents late output", async (stage) => {
    const f = fixture();
    const pending = deferred<string>();
    await f.conversation.start("");
    if (stage === "speak") f.dependencies.speak.mockImplementationOnce(async (_text, _signal, ready) => { await ready(); await pending.promise; });
    else f.dependencies[stage].mockImplementationOnce(() => pending.promise);
    f.events.end(new Blob(["voice"]));
    await flush();
    f.conversation.stop();
    pending.resolve("late result");
    await flush();
    expect(f.state.at(-1)?.phase).toBe("off");
    expect(f.enabled).toBe(false);
    expect(f.signal.aborted).toBe(true);
    expect(f.dependencies.error).not.toHaveBeenCalled();
    if (stage === "transcribe") expect(f.dependencies.reply).not.toHaveBeenCalled();
  });

  it("releases late device acquisition and handles permission denial", async () => {
    const f = fixture();
    const late = deferred<typeof f.detector>();
    f.dependencies.openDetector.mockImplementationOnce(() => late.promise);
    const starting = f.conversation.start();
    f.conversation.stop(); late.resolve(f.detector); await starting;
    expect(f.detector.start).not.toHaveBeenCalled();
    expect(f.detector.destroy).toHaveBeenCalledTimes(1);
    f.detector.start.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
    await f.conversation.start();
    expect(f.state.at(-1)?.status).toMatch(/microphone access was blocked/i);
    expect(f.conversation.active).toBe(false);
  });

  it("old speech and playback callbacks cannot alter a newly started call", async () => {
    const f = fixture();
    const playback = deferred<void>();
    f.dependencies.speak.mockImplementationOnce(async (_text, _signal, ready) => { await ready(); await playback.promise; });
    const first = f.conversation.start();
    await flush();
    const old = f.events;
    f.conversation.stop();
    await f.conversation.start("");
    old.start(); old.confirmed(); old.end(new Blob(["old"])); old.error(new Error("old device"));
    playback.resolve(); await first;
    expect(f.state.at(-1)?.phase).toBe("listening");
    expect(f.dependencies.transcribe).not.toHaveBeenCalled();
    expect(f.dependencies.error).not.toHaveBeenCalled();
    f.conversation.stop();
  });
});
