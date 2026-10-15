import * as ort from "onnxruntime-web/wasm";
import { FrameProcessor } from "@ricky0123/vad-web/dist/frame-processor";
import { Message } from "@ricky0123/vad-web/dist/messages";
import { Silero } from "@ricky0123/vad-web/dist/models";
import { encodeWAV } from "@ricky0123/vad-web/dist/utils";
import modelURL from "@ricky0123/vad-web/dist/silero_vad_v5.onnx?url";
import workletURL from "@ricky0123/vad-web/dist/vad.worklet.bundle.min.js?url";
import wasmURL from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import wasmModuleURL from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import type { SpeechDetector, SpeechEvents } from "./voiceConversation";

// Both binaries come from the exact same pinned npm runtime; no CDN is used.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: wasmURL, mjs: wasmModuleURL };
ort.env.logLevel = "error";

/** Own device/model lifetime explicitly; serialize Silero's recurrent frames. */
export async function createSpeechDetector(
  context: AudioContext,
  signal: AbortSignal,
  events: SpeechEvents,
  stream: MediaStream,
): Promise<SpeechDetector> {
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let model: Awaited<ReturnType<typeof Silero.new>> | undefined;
  let processor: FrameProcessor | undefined;
  let closed = false, listening = false, epoch = 0, queued = 0, speechSamples = 0;
  let pending = Promise.resolve();
  let transitions = Promise.resolve();
  let destruction: Promise<void> | undefined;

  const stopTracks = (value?: MediaStream) => value?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
  function pauseCapture() {
    listening = false;
    epoch++;
    events.meter(null);
    stream?.getTracks().forEach((track) => { track.enabled = false; });
    source?.disconnect();
    source = undefined;
  }
  function aborted() {
    closed = true;
    pauseCapture();
    stopTracks(stream);
    if (context.state !== "closed") void context.close().catch(() => {});
  }
  signal.addEventListener("abort", aborted, { once: true });

  async function destroy() {
    if (destruction) return destruction;
    closed = true;
    pauseCapture();
    stopTracks(stream);
    signal.removeEventListener("abort", aborted);
    if (node) {
      node.onprocessorerror = null;
      node.port.onmessage = null;
      node.port.postMessage(Message.SpeechStop);
      node.disconnect();
      node.port.close();
    }
    destruction = (async () => {
      await pending;
      processor?.pause(() => {});
      try { await model?.release(); }
      finally { if (context.state !== "closed") await context.close(); }
    })();
    return destruction;
  }

  try {
    signal.throwIfAborted();
    stream.getAudioTracks().forEach(track => {
      track.onended = () => { if (!closed) events.error(new Error("Microphone disconnected.")); };
    });
    await context.audioWorklet.addModule(workletURL);
    signal.throwIfAborted();
    model = await Silero.new(ort, async () => {
      const response = await fetch(modelURL, { signal });
      if (!response.ok) throw new Error("Local speech-detection model could not be loaded.");
      return response.arrayBuffer();
    });
    signal.throwIfAborted();
    processor = new FrameProcessor(model.process, model.reset_state, {
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionMs: 1200,
      preSpeechPadMs: 600,
      minSpeechMs: 320,
      submitUserSpeechOnPause: false,
    }, 32);
    node = new AudioWorkletNode(context, "vad-helper-worklet", { processorOptions: { frameSamples: 512 } });
    node.onprocessorerror = () => { if (!closed) events.error(new Error("Speech detection stopped. Restart the conversation.")); };
    node.port.onmessage = (event: MessageEvent) => {
      if (closed || !listening || event.data?.message !== Message.AudioFrame || !(event.data.data instanceof ArrayBuffer)) return;
      if (queued >= 32) {
        events.error(new Error("Speech detection cannot keep up with this device."));
        return;
      }
      const generation = epoch;
      const frame = new Float32Array(event.data.data);
      events.meter(frame);
      queued++;
      pending = pending.then(async () => {
        if (closed || !listening || epoch !== generation) return;
        const handle: Parameters<FrameProcessor["process"]>[1] = (value) => {
          if (closed || !listening || epoch !== generation) return;
          if (value.msg === Message.SpeechStart) events.start();
          if (value.msg === Message.SpeechRealStart) events.confirmed();
          if (value.msg === Message.VADMisfire) { speechSamples = 0; events.misfire(); }
          if (value.msg === Message.SpeechEnd) {
            speechSamples = 0;
            // Mono PCM16 at 16 kHz is below 2 MiB even for the longest turn.
            events.end(new Blob([encodeWAV(value.audio, 1, 16000, 1, 16)], { type: "audio/wav" }));
          }
        };
        await processor!.process(frame, handle);
        if (closed || !listening || epoch !== generation) return;
        speechSamples = processor!.speaking ? speechSamples + frame.length : 0;
        if (speechSamples >= 55 * 16000) processor!.endSegment(handle);
      }).catch((error: unknown) => {
        if (!closed && epoch === generation) events.error(error);
      }).finally(() => { queued--; });
    };
    return {
      start() {
        if (listening && !closed) return Promise.resolve();
        const generation = ++epoch;
        const enable = transitions.then(async () => {
          signal.throwIfAborted();
          if (closed || epoch !== generation) return;
          await pending;
          if (closed || epoch !== generation) return;
          await context.resume();
          if (closed || signal.aborted || epoch !== generation) return;
          processor!.reset();
          speechSamples = 0;
          processor!.resume();
          source = context.createMediaStreamSource(stream);
          listening = true;
          stream.getTracks().forEach((track) => { track.enabled = true; });
          source.connect(node!);
        });
        transitions = enable.catch(() => {});
        return enable;
      },
      pause() {
        pauseCapture();
        const disable = transitions.then(async () => {
          await pending;
          if (closed) return;
          processor!.pause(() => {});
          speechSamples = 0;
        });
        transitions = disable.catch(() => {});
        return disable;
      },
      destroy,
    };
  } catch (error) {
    await destroy();
    throw error;
  }
}
