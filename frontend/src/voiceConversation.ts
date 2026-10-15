import { earlySentence, remainingSpeech } from "./earlySpeech";
import { spokenExcerpt } from "./spokenText";

export type ConversationPhase =
  | "off"
  | "starting"
  | "listening"
  | "hearing"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export type ConnectionStage = "microphone" | "audio" | "speech-engine";
export const connectionStages = {
  microphone: {
    status: "Waiting for microphone permission…",
    hint: "Choose Allow in your browser's microphone prompt. If no prompt appears, open this site's microphone permission beside the address bar.",
    timeoutMs: 30000,
    error: "Microphone permission is still waiting. Allow microphone access for this site in your browser, then try the call again.",
  },
  audio: {
    status: "Starting browser audio…",
    hint: "Preparing your microphone and speakers.",
    timeoutMs: 10000,
    error: "Browser audio did not start. Allow sound for this site, then try the call again.",
  },
  "speech-engine": {
    status: "Loading speech detection…",
    hint: "Microphone permission was granted. The first call downloads the speech engine; your microphone is paused until it is ready.",
    timeoutMs: 45000,
    error: "Speech detection did not finish loading. Check your connection and try the call again.",
  },
} satisfies Record<ConnectionStage, { status: string; hint: string; timeoutMs: number; error: string }>;

export function voiceErrorText(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotFoundError")
      return "No microphone is available to this browser. Using TeamViewer? Open the notebook HTTPS link in your notebook's own Chrome or Edge.";
    if (error.name === "NotAllowedError" || error.name === "SecurityError")
      return "Microphone access was blocked. Allow this site's microphone in your browser and check your system microphone permission, then try again.";
    if (error.name === "NotReadableError")
      return "The browser could not open your microphone. Check the selected input device and whether another application is using it, then try again.";
    if (error.name === "NotSupportedError")
      return "This browser could not start audio capture. Open the link in a current Chrome or Edge browser with an available microphone.";
  }
  return error instanceof Error ? error.message : "Voice activity failed.";
}

export type ConversationState = {
  phase: ConversationPhase;
  status: string;
  muted: boolean;
  startedAt: number | null;
  caption: { role: "user" | "assistant"; text: string } | null;
  connectionStage: ConnectionStage | null;
  inputReady: boolean;
};
export const idleCall: ConversationState = {
  phase: "off", status: "Call ended", muted: false, startedAt: null, caption: null, connectionStage: null, inputReady: false,
};
export const callGreeting = "Hi, I'm Jarvis.";
export type SpeechEvents = {
  preparing(stage: ConnectionStage): void;
  meter(frame: Float32Array | null): void;
  start(): void;
  confirmed(): void;
  misfire(): void;
  end(audio: Blob): void;
  error(error: unknown): void;
};
export type SpeechDetector = {
  start(): Promise<void>;
  pause(): Promise<void>;
  destroy(): Promise<void>;
};
type Dependencies = {
  meter?(frame: Float32Array | null): void;
  openDetector(signal: AbortSignal, events: SpeechEvents): Promise<SpeechDetector>;
  transcribe(audio: Blob, signal: AbortSignal): Promise<string>;
  reply(text: string, signal: AbortSignal, partial: (answer: string) => void): Promise<string>;
  // ready enables barge-in only after synthesis has released the local speech slot.
  speak(text: string, signal: AbortSignal, ready: () => Promise<void>): Promise<void>;
  update(state: ConversationState): void;
  error(error: unknown): void;
};
type Output = { controller: AbortController; detach(): void };
type Session = {
  controller: AbortController;
  detector?: SpeechDetector;
  output?: Output;
  turn?: Output;
  busy: boolean;
  muted: boolean;
  connected: boolean;
  startupTimer?: ReturnType<typeof setTimeout>;
};

// Browser permission, import and AudioContext promises are not all cancellable.
// End our wait on hang-up/timeout and dispose any detector that arrives later.
function startupWait<T>(operation: Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      reject(new DOMException("Call startup cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(value => {
      signal.removeEventListener("abort", abort);
      if (settled) { late?.(value); return; }
      settled = true;
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      if (!settled) { settled = true; reject(error); }
    });
    if (signal.aborted) abort();
  });
}

/** A scope-bound call. Output can be interrupted without ending the call. */
export class VoiceConversation {
  private session: Session | null = null;
  private state: ConversationState = { ...idleCall };

  constructor(private dependencies: Dependencies) {}

  get active() {
    return this.session !== null;
  }

  private current(session: Session) {
    return this.session === session && !session.controller.signal.aborted;
  }

  private update(phase: ConversationPhase, status: string) {
    this.state = { ...this.state, phase, status, muted: this.session?.muted ?? false,
      connectionStage: phase === "starting" ? this.state.connectionStage : null,
      inputReady: this.session !== null && this.acceptsSpeech(this.session) };
    this.dependencies.update(this.state);
  }

  private preparing(session: Session, stage: ConnectionStage) {
    if (!this.current(session) || session.connected) return;
    clearTimeout(session.startupTimer);
    const step = connectionStages[stage];
    this.state = { ...this.state, connectionStage: stage };
    this.update("starting", step.status);
    session.startupTimer = setTimeout(() => this.fail(session, new Error(step.error)), step.timeoutMs);
  }

  stop() {
    const session = this.session;
    this.session = null; // Invalidate callbacks before aborting their resources.
    clearTimeout(session?.startupTimer);
    this.dependencies.meter?.(null);
    session?.output?.controller.abort();
    session?.turn?.controller.abort();
    session?.controller.abort();
    if (session?.detector)
      void session.detector.destroy().catch(this.dependencies.error);
    this.state = { ...idleCall };
    this.dependencies.update(this.state);
  }

  private fail(session: Session, error: unknown) {
    if (!this.current(session)) return;
    this.stop();
    this.update("error", voiceErrorText(error));
    this.dependencies.error(error);
  }

  async start(greeting = callGreeting) {
    if (this.active) return;
    const session: Session = {
      controller: new AbortController(), busy: true, muted: false, connected: false,
    };
    this.session = session;
    this.state = { ...idleCall };
    this.preparing(session, "microphone");
    try {
      const detector = await startupWait(this.dependencies.openDetector(session.controller.signal, {
        preparing: (stage) => this.preparing(session, stage),
        meter: (frame) => { if (this.current(session)) this.dependencies.meter?.(session.muted ? null : frame); },
        start: () => {
          if (this.acceptsSpeech(session) && this.state.phase === "listening")
            this.update("hearing", "Listening to you");
        },
        confirmed: () => {
          if (!this.acceptsSpeech(session)) return;
          const output = session.output;
          session.output = undefined; // Old output cannot reset a new utterance.
          output?.controller.abort();
          session.turn?.controller.abort();
          session.turn = undefined;
          this.update("hearing", "Listening to you");
        },
        misfire: () => {
          if (this.acceptsSpeech(session) && this.state.phase === "hearing")
            this.update("listening", "I'm listening");
        },
        end: (audio) => { void this.turn(session, audio); },
        error: (error) => this.fail(session, error),
      }), session.controller.signal, late => { void late.destroy().catch(this.dependencies.error); });
      if (!this.current(session)) {
        await detector.destroy();
        return;
      }
      session.detector = detector;
      this.preparing(session, "audio");
      await startupWait(detector.start(), session.controller.signal);
      if (!this.current(session)) return;
      clearTimeout(session.startupTimer);
      session.startupTimer = undefined;
      session.connected = true;
      session.busy = false;
      this.state = { ...this.state, startedAt: Date.now() };
      if (greeting) await this.output(session, greeting);
      else await this.listen(session);
    } catch (error) {
      this.fail(session, error);
    }
  }

  private acceptsSpeech(session: Session) {
    return this.current(session) && session.connected && !session.busy && !session.muted;
  }

  async setMuted(muted: boolean) {
    const session = this.session;
    if (!session || session.muted === muted) return;
    session.muted = muted;
    if (this.state.phase === "hearing") this.update("listening", "I'm listening");
    else this.update(this.state.phase, this.state.status);
    try {
      if (muted) await session.detector?.pause();
      else if (session.connected && !session.busy) await session.detector?.start();
    } catch (error) { this.fail(session, error); }
  }

  private async listen(session: Session) {
    if (!this.current(session)) return;
    session.busy = false;
    if (!session.muted) await session.detector!.start();
    if (this.current(session) && this.state.phase !== "hearing")
      this.update("listening", "I'm listening");
  }

  private async output(session: Session, text: string, prepared = false) {
    if (!this.current(session)) return;
    if (!prepared) text = spokenExcerpt(text);
    const controller = new AbortController();
    const abort = () => controller.abort();
    session.controller.signal.addEventListener("abort", abort, { once: true });
    const output: Output = {
      controller,
      detach: () => session.controller.signal.removeEventListener("abort", abort),
    };
    session.output = output;
    session.busy = true;
    this.state = { ...this.state, caption: { role: "assistant", text } };
    this.update("speaking", "JARVIS is talking");
    try {
      await session.detector!.pause();
      if (!this.current(session) || session.output !== output) return;
      await this.dependencies.speak(text, controller.signal, async () => {
        if (!this.current(session) || session.output !== output) return;
        if (!session.muted) await session.detector!.start();
        if (this.current(session) && session.output === output) {
          session.busy = false;
          this.update(this.state.phase, this.state.status);
        }
      });
      if (!this.current(session) || session.output !== output) return;
      session.output = undefined;
      await this.listen(session);
    } catch (error) {
      if (this.current(session) && session.output === output) this.fail(session, error);
    } finally { output.detach(); }
  }

  private async turn(session: Session, audio: Blob) {
    if (!this.acceptsSpeech(session)) return;
    const previous = session.output;
    session.output = undefined;
    previous?.controller.abort();
    session.turn?.controller.abort();
    const controller = new AbortController();
    const abort = () => controller.abort();
    session.controller.signal.addEventListener("abort", abort, { once: true });
    const turn: Output = { controller, detach: () => session.controller.signal.removeEventListener("abort", abort) };
    session.turn = turn;
    const current = () => this.current(session) && session.turn === turn && !controller.signal.aborted;
    session.busy = true;
    this.update("transcribing", "Hearing your words…");
    const { signal } = controller;
    try {
      await session.detector!.pause();
      if (!current()) return;
      const text = await this.dependencies.transcribe(audio, signal);
      if (!current()) return;
      if (text.trim()) {
        this.state = { ...this.state, caption: { role: "user", text } };
        // The speech slot is free after transcription. Keep detection active
        // while the model reasons, so confirmed speech can cancel this turn.
        if (!session.muted) await session.detector!.start();
        if (!current()) return;
        session.busy = false;
        this.update("thinking", "Thinking about your question…");
        let first = "";
        let initialSpeech: Promise<void> | null = null;
        const answer = await this.dependencies.reply(text, signal, (partial) => {
          if (!current() || first) return;
          const sentence = earlySentence(partial);
          if (!sentence) return;
          first = sentence;
          initialSpeech = this.output(session, sentence, true);
        });
        if (!current()) return;
        if (!answer.trim()) throw new Error("JARVIS returned no spoken answer. Check the chat.");
        if (initialSpeech) {
          await initialSpeech;
          if (!current()) return;
          // Give newly detected user speech precedence over additional detail.
          if (this.state.phase !== "hearing") {
            const rest = remainingSpeech(answer, first);
            if (rest) await this.output(session, rest, true);
          }
        } else await this.output(session, answer);
      } else await this.listen(session);
    } catch (error) {
      if (current()) this.fail(session, error);
    } finally {
      turn.detach();
      if (session.turn === turn) session.turn = undefined;
    }
  }
}
