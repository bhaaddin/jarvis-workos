import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { authorizedFetch } from "./api";
import { idleCall, VoiceConversation, voiceErrorText } from "./voiceConversation";
import type { ConversationState } from "./voiceConversation";
import type { CallAudio } from "./AudioTrace";

type Phase =
  | "idle"
  | "permission"
  | "recording"
  | "transcribing"
  | "preparing"
  | "ready"
  | "playing"
  | "error";
type Recording = {
  controller: AbortController;
  phase: "permission" | "recording" | "transcribing";
  stream?: MediaStream;
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setTimeout>;
  chunks: Blob[];
  bytes: number;
  started: number;
  stoppedInTime: boolean;
};
type Playback = {
  controller: AbortController;
  audio: HTMLAudioElement;
  url?: string;
  settle(error?: unknown): void;
  detach(): void;
};
type Actions = {
  record(): Promise<void>;
  cancel(): void;
  speak(text: string): Promise<void>;
  stopPlayback(): void;
  startConversation(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  resumePlayback(): Promise<void>;
};
const formats = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/ogg",
  "audio/wav",
];
async function voiceFetch(path: string, init: RequestInit) {
  const response = await authorizedFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error || `Voice request failed (${response.status}).`,
    );
  }
  return response;
}

export function useVoice(
  scope: string,
  voiceId: string,
  onTranscript: (text: string) => void,
  onError: (message: string) => void,
  onVoiceTurn: (text: string, signal: AbortSignal, partial: (answer: string) => void) => Promise<string>,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioVisual = useRef<CallAudio>({ input: null, output: null, audio: null });
  const latest = useRef({ voiceId, onTranscript, onError, onVoiceTurn });
  const actions = useRef<Actions | null>(null);
  const [supported, setSupported] = useState(false);
  const [conversationSupported, setConversationSupported] = useState(false);
  const [conversation, setConversation] = useState<ConversationState>(idleCall);
  const [view, setView] = useState<{ phase: Phase; status: string }>({
    phase: "idle",
    status: "Local voice",
  });
  useLayoutEffect(() => {
    latest.current = { voiceId, onTranscript, onError, onVoiceTurn };
  }, [voiceId, onTranscript, onError, onVoiceTurn]);
  useLayoutEffect(() => {
    let alive = true;
    let recording: Recording | null = null;
    let playback: Playback | null = null;
    let mime = "";
    try {
      if (
        window.isSecureContext &&
        typeof navigator.mediaDevices?.getUserMedia === "function" &&
        typeof MediaRecorder !== "undefined"
      )
        mime =
          formats.find((type) => MediaRecorder.isTypeSupported(type)) || "";
    } catch {
      /* Unsupported recording API. */
    }
    setSupported(Boolean(mime));
    const liveSupported = window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined";
    setConversationSupported(liveSupported);
    setConversation(idleCall);
    const update = (phase: Phase, status: string) => {
      if (alive) setView({ phase, status });
    };
    const report = (error: unknown) => {
      if (alive) {
        const text = voiceErrorText(error);
        update("error", text);
        latest.current.onError(text);
      }
    };
    const matches = (job: Recording) => alive && recording === job;
    const playingMatches = (job: Playback) => alive && playback === job;
    const stopTracks = (job: Recording) =>
      job.stream?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
    function releaseRecording(job: Recording) {
      if (recording === job) recording = null;
      clearTimeout(job.timer);
      job.controller.abort();
      if (job.recorder) {
        job.recorder.ondataavailable = null;
        job.recorder.onerror = null;
        job.recorder.onstop = null;
        try {
          if (job.recorder.state !== "inactive") job.recorder.stop();
        } catch {
          /* Release tracks even when stop fails. */
        }
      }
      stopTracks(job);
      job.chunks = [];
    }
    function releasePlayback(error?: unknown) {
      const job = playback;
      playback = null;
      if (!job) return;
      audioVisual.current.output = null;
      job.detach();
      job.controller.abort();
      job.audio.onended =
        job.audio.onerror =
        job.audio.onplaying =
        job.audio.onpause =
          null;
      try {
        job.audio.pause();
        job.audio.removeAttribute("src");
        job.audio.load();
      } finally {
        if (job.url) URL.revokeObjectURL(job.url);
        job.settle(error);
      }
    }
    function stopPlayback() {
      const active = Boolean(playback);
      releasePlayback();
      if (active) update("idle", "Playback stopped.");
    }
    function cancel() {
      live.stop();
      if (recording) releaseRecording(recording);
      releasePlayback(new DOMException("Voice cancelled.", "AbortError"));
      update("idle", "Local voice");
    }
    function failRecording(job: Recording, error: unknown) {
      if (!matches(job)) return;
      releaseRecording(job);
      report(error);
    }
    async function transcribe(job: Recording) {
      if (!matches(job)) return;
      stopTracks(job);
      clearTimeout(job.timer);
      job.phase = "transcribing";
      update("transcribing", "Transcribing locally…");
      let transcript: string;
      try {
        if (!job.stoppedInTime && performance.now() - job.started > 60000)
          throw new Error("Recording exceeded 60 seconds; discarded.");
        const blob = new Blob(job.chunks, {
          type: job.recorder?.mimeType || mime,
        });
        job.chunks = [];
        if (!blob.size || blob.size > 10 * 1024 * 1024)
          throw new Error(
            "Recording must contain audio and be at most 10 MiB.",
          );
        const type = blob.type.split(";")[0].toLowerCase();
        if (!["audio/webm", "audio/ogg", "audio/wav"].includes(type))
          throw new Error("Unsupported recording format.");
        const response = await voiceFetch("/api/voice/transcribe", {
          method: "POST",
          headers: { "Content-Type": type },
          body: blob,
          signal: job.controller.signal,
        });
        const result: unknown = await response.json();
        if (!matches(job)) return;
        if (
          !result ||
          typeof result !== "object" ||
          !("text" in result) ||
          typeof result.text !== "string" ||
          !result.text.trim()
        )
          throw new Error("No speech recognized. Try recording again.");
        transcript = result.text.trim();
        if (transcript.length > 12000)
          throw new Error("The transcript is too long for one message.");
      } catch (error) {
        failRecording(job, error);
        return;
      }
      if (!matches(job)) return;
      releaseRecording(job);
      update("idle", "Transcript ready.");
      latest.current.onTranscript(transcript);
    }
    function finishRecording(job: Recording) {
      if (!matches(job) || job.phase !== "recording") return;
      job.stoppedInTime = performance.now() - job.started <= 60000;
      job.phase = "transcribing";
      clearTimeout(job.timer);
      update("transcribing", "Transcribing locally…");
      try {
        job.recorder?.stop();
      } catch (error) {
        failRecording(job, error);
      } finally {
        stopTracks(job);
      }
    }
    async function record() {
      if (!alive) return;
      if (live.active) return;
      if (recording) {
        if (recording.phase === "recording") finishRecording(recording);
        else cancel();
        return;
      }
      if (!mime) {
        report(new Error("This browser does not support recording."));
        return;
      }
      releasePlayback();
      const job: Recording = {
        controller: new AbortController(),
        phase: "permission",
        chunks: [],
        bytes: 0,
        started: 0,
        stoppedInTime: false,
      };
      recording = job;
      update("permission", "Opening microphone…");
      try {
        job.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!matches(job)) {
          stopTracks(job);
          return;
        }
        const recorder = new MediaRecorder(job.stream, { mimeType: mime });
        job.recorder = recorder;
        recorder.ondataavailable = (event) => {
          if (!matches(job)) return;
          job.bytes += event.data.size;
          if (job.bytes > 10 * 1024 * 1024)
            failRecording(job, new Error("Recording exceeded 10 MiB."));
          else job.chunks.push(event.data);
        };
        recorder.onerror = () =>
          failRecording(job, new Error("Microphone recording failed."));
        recorder.onstop = () => {
          void transcribe(job);
        };
        job.stream.getAudioTracks().forEach((track) => {
          track.onended = () =>
            failRecording(job, new Error("Microphone disconnected."));
        });
        recorder.start(250);
        job.started = performance.now();
        job.phase = "recording";
        job.timer = setTimeout(() => finishRecording(job), 59500);
        update("recording", "Listening… select Stop to finish.");
      } catch (error) {
        failRecording(job, error);
      }
    }
    async function playText(text: string, signal?: AbortSignal, ready?: () => Promise<void>) {
      signal?.throwIfAborted();
      if (!alive || recording || !text.trim()) throw new Error("Speech playback is unavailable.");
      if (text.length > 6000) {
        throw new Error(
             "Read-aloud supports 6,000 characters. Ask for a spoken summary.",
        );
      }
      releasePlayback();
      const audio = audioRef.current;
      if (!audio) {
        throw new Error("Audio controls are unavailable.");
      }
      let settle!: (error?: unknown) => void;
      const ended = new Promise<void>((resolve, reject) => {
        settle = (error) => error === undefined ? resolve() : reject(error);
      });
      // Cancellation can occur while synthesis is pending, before we await ended.
      void ended.catch(() => {});
      const aborted = () => {
        if (playingMatches(job)) releasePlayback(new DOMException("Voice cancelled.", "AbortError"));
      };
      const job: Playback = {
        controller: new AbortController(), audio, settle,
        detach: () => signal?.removeEventListener("abort", aborted),
      };
      playback = job;
      signal?.addEventListener("abort", aborted, { once: true });
      update("preparing", "Preparing local speech…");
      try {
        const response = await voiceFetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice: latest.current.voiceId }),
          signal: job.controller.signal,
        });
        if (
          response.headers.get("Content-Type")?.split(";")[0].trim() !==
          "audio/wav"
        )
          throw new Error("Speech did not return WAV audio.");
        const blob = await response.blob();
        if (!playingMatches(job)) return await ended;
        job.url = URL.createObjectURL(blob);
        audioVisual.current.audio = audio;
        void blob.arrayBuffer()
          .then((buffer) => new OfflineAudioContext(1, 1, 24000).decodeAudioData(buffer))
          .then((decoded) => {
            if (playingMatches(job)) audioVisual.current.output = { data: decoded.getChannelData(0), sampleRate: decoded.sampleRate };
          }).catch(() => {}); // A visualization error must never interrupt playback.
        audio.src = job.url;
        audio.onplaying = () => {
          if (playingMatches(job)) update("playing", signal ? "JARVIS is talking" : "Reading aloud…");
        };
        audio.onpause = () => {
          if (playingMatches(job) && !audio.ended) update("ready", "Audio paused.");
        };
        audio.onended = () => {
          if (playingMatches(job)) {
            releasePlayback();
            update("idle", "Playback finished.");
          }
        };
        audio.onerror = () => {
          if (playingMatches(job)) {
            releasePlayback(new Error("Audio playback failed."));
          }
        };
        update("ready", "Audio ready.");
        await ready?.();
        if (!playingMatches(job)) return await ended;
        signal?.throwIfAborted();
        try {
          await audio.play();
        } catch {
          if (playingMatches(job)) update("ready", "Audio ready. Select Play.");
        }
        await ended;
      } catch (error) {
        if (playingMatches(job)) releasePlayback(error);
        // Stop/skip may abort a pending synthesis fetch after settling playback.
        await ended;
      }
    }
    async function speak(text: string) {
      if (live.active) return;
      try { await playText(text); } catch (error) {
        if (alive && !(error instanceof DOMException && error.name === "AbortError")) report(error);
      }
    }
    const live = new VoiceConversation({
      meter: (frame) => { if (alive) audioVisual.current.input = frame; },
      openDetector: async (signal, events) => {
        // Request permission in the Call click, before downloading/initializing
        // WASM. An ignored browser prompt must not look like a server connection.
        const context = new AudioContext();
        let stream: MediaStream | undefined, closed = false;
        const stopTracks = (value?: MediaStream) => value?.getTracks().forEach(track => { track.onended = null; track.stop(); });
        const close = () => {
          closed = true;
          stopTracks(stream);
          if (context.state !== "closed") void context.close().catch(() => {});
        };
        signal.addEventListener("abort", close, { once: true });
        try {
          signal.throwIfAborted();
          events.preparing("microphone");
          const acquisition = navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          }).then(acquired => {
            if (closed || signal.aborted) {
              stopTracks(acquired);
              throw new DOMException("Microphone request cancelled.", "AbortError");
            }
            stream = acquired;
            // Do not capture speech while the engine is still loading.
            stream.getTracks().forEach(track => { track.enabled = false; });
            return acquired;
          });
          const resumed = context.resume(); // Preserve the original click's audio activation.
          void resumed.catch(() => {});
          await acquisition;
          signal.throwIfAborted();
          events.preparing("audio");
          await resumed;
          signal.throwIfAborted();
          events.preparing("speech-engine");
          const { createSpeechDetector } = await import("./speechDetector");
          signal.throwIfAborted();
          return await createSpeechDetector(context, signal, events, stream!);
        } catch (error) {
          close();
          throw error;
        } finally { signal.removeEventListener("abort", close); }
      },
      transcribe: async (audio, signal) => {
        const response = await voiceFetch("/api/voice/transcribe", {
          method: "POST", headers: { "Content-Type": "audio/wav" }, body: audio, signal,
        });
        const result = await response.json();
        if (typeof result.text !== "string" || result.text.length > 12000)
          throw new Error("The speech service returned an invalid transcript.");
        return result.text.trim();
      },
      reply: (text, signal, partial) => latest.current.onVoiceTurn(text, signal, partial),
      speak: playText,
      update: (state) => { if (alive) setConversation(state); },
      error: report,
    });
    async function startConversation() {
      if (!alive || live.active) return;
      if (!liveSupported) { report(new Error("Calling JARVIS needs a browser with AudioWorklet and microphone support.")); return; }
      if (recording) releaseRecording(recording);
      releasePlayback();
      // Bless this persistent audio element in the Call click's user gesture.
      const audio = audioRef.current;
      if (audio) {
        const data = new ArrayBuffer(364);
        const bytes = new DataView(data);
        const label = (offset: number, text: string) => [...text].forEach((character, index) => bytes.setUint8(offset + index, character.charCodeAt(0)));
        label(0, "RIFF"); bytes.setUint32(4, 356, true); label(8, "WAVEfmt ");
        bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
        bytes.setUint32(24, 16000, true); bytes.setUint32(28, 32000, true);
        bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true);
        label(36, "data"); bytes.setUint32(40, 320, true);
        const url = URL.createObjectURL(new Blob([data], { type: "audio/wav" }));
        audio.src = url;
        void audio.play().catch(() => {}).finally(() => {
          if (audio.src === url) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
          URL.revokeObjectURL(url);
        });
      }
      await live.start();
    }
    async function resumePlayback() {
      const job = playback;
      if (!job?.url) return;
      try { await job.audio.play(); }
      catch { if (playingMatches(job)) update("ready", "Audio blocked. Check this browser's sound permission."); }
    }
    const current = {
      record, cancel, speak, stopPlayback, startConversation, resumePlayback,
      setMuted: (muted: boolean) => live.setMuted(muted),
    };
    actions.current = current;
    update("idle", "Local voice");
    const hidden = () => {
      // A call behaves like a meeting: it can continue while another tab is open.
      if (document.hidden && recording) cancel();
    };
    window.addEventListener("pagehide", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      alive = false;
      audioVisual.current.input = null;
      audioVisual.current.output = null;
      if (actions.current === current) actions.current = null;
      window.removeEventListener("pagehide", cancel);
      document.removeEventListener("visibilitychange", hidden);
      cancel();
    };
  }, [scope]);
  return {
    ...view,
    conversation,
    conversationActive: !["off", "error"].includes(conversation.phase),
    conversationSupported,
    supported,
    audioRef,
    audioVisual,
    recording: ["permission", "recording", "transcribing"].includes(view.phase),
    playing: ["preparing", "ready", "playing"].includes(view.phase),
    record: useCallback(
      () => actions.current?.record() ?? Promise.resolve(),
      [],
    ),
    cancel: useCallback(() => actions.current?.cancel(), []),
    speak: useCallback(
      (text: string) => actions.current?.speak(text) ?? Promise.resolve(),
      [],
    ),
    stopPlayback: useCallback(() => actions.current?.stopPlayback(), []),
    startConversation: useCallback(() => actions.current?.startConversation() ?? Promise.resolve(), []),
    setMuted: useCallback((muted: boolean) => actions.current?.setMuted(muted) ?? Promise.resolve(), []),
    resumePlayback: useCallback(() => actions.current?.resumePlayback() ?? Promise.resolve(), []),
  };
}
