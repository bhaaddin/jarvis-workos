import { useEffect, useLayoutEffect, useRef, useState, useId } from "react";
import { Captions, Mic, MicOff, Phone, PhoneOff, UserRound, Volume2 } from "lucide-react";
import type { RefObject } from "react";
import { AudioTrace } from "./AudioTrace";
import type { CallAudio } from "./AudioTrace";
import type { ConversationState } from "./voiceConversation";
import { connectionStages } from "./voiceConversation";

type Props = {
  open: boolean;
  project: string;
  state: ConversationState;
  playbackPhase: string;
  playbackStatus: string;
  audioVisual: RefObject<CallAudio>;
  onHangUp(): void;
  onMute(muted: boolean): void;
  onResumeAudio(): void;
  onRetry(): void;
};

export function CallScreen({ open, project, state, playbackPhase, playbackStatus, audioVisual, onHangUp, onMute, onResumeAudio, onRetry }: Props) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [captions, setCaptions] = useState(false);
  const [now, setNow] = useState(Date.now());
  useLayoutEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (!open) { setCaptions(false); return; }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  const seconds = state.startedAt ? Math.max(0, Math.floor((now - state.startedAt) / 1000)) : 0;
  const duration = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  const blocked = state.phase === "speaking" && playbackPhase === "ready" && playbackStatus !== "Audio ready.";
  const status = state.phase === "error" ? "Call interrupted"
    : state.muted ? "Your microphone is muted"
    : blocked ? "Enable audio to hear JARVIS"
    : state.phase === "speaking" && playbackPhase === "preparing" ? "JARVIS is getting ready to speak…"
    : state.status;
  const userSpeaking = !state.muted && state.phase === "hearing";
  const jarvisSpeaking = state.phase === "speaking" && playbackPhase === "playing";
  const working = ["thinking", "transcribing"].includes(state.phase) || (state.phase === "speaking" && playbackPhase === "preparing");
  const connecting = state.phase === "starting";
  const disconnected = state.phase === "off" || state.phase === "error";
  const userStatus = disconnected ? "Microphone disconnected" : connecting ? "Microphone not ready"
    : state.muted ? "Microphone muted" : userSpeaking ? "You are speaking" : state.inputReady ? "Ready to speak" : "Microphone paused";
  const assistantStatus = disconnected ? "Not connected" : connecting ? "Preparing your call"
    : jarvisSpeaking ? "JARVIS is speaking" : working ? "Working on your answer…"
      : state.muted ? "Waiting for you to unmute" : state.inputReady ? "Listening to you" : "Preparing audio";

  return (
    <dialog
      ref={dialog}
      className="jarvis-call"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onHangUp(); }}
    >
      <div className="call-layout" data-phase={state.phase} data-muted={state.muted} data-input-ready={state.inputReady}>
        <header className="call-header">
          <div><span className="call-brand">J</span><span>Voice call</span></div>
          <span className="call-context">{project}</span>
          <span className="call-duration" aria-label="Call duration">{state.startedAt ? duration : connecting ? "Connecting" : "Not connected"}</span>
        </header>
        <main className="call-stage">
          <h1 id={titleId}>JARVIS</h1>
          <div className="call-speakers">
            <section className={`call-speaker user-speaker ${userSpeaking ? "speaking" : ""}`}
              data-speaker="user" data-speaking={userSpeaking} aria-label="Your speaking activity">
              <div className="speaker-avatar"><UserRound size={40} /></div>
              <h2>You</h2>
              <p>{userStatus}</p>
              <AudioTrace source={audioVisual} speaker="user" open={open} muted={state.muted} />
            </section>
            <section className={`call-speaker jarvis-speaker ${jarvisSpeaking ? "speaking" : ""} ${working ? "working" : ""}`}
              data-speaker="jarvis" data-speaking={jarvisSpeaking} aria-label="JARVIS speaking activity">
              <div className="speaker-avatar">J</div>
              <h2>JARVIS</h2>
              <p>{assistantStatus}</p>
              <AudioTrace source={audioVisual} speaker="jarvis" open={open} />
            </section>
          </div>
          <p className="call-status" role="status" aria-live="polite">{status}</p>
          {state.phase === "error" ? (
            <p className="call-hint error-text">{state.status}</p>
          ) : (
            <p className="call-hint">{state.muted ? "Unmute when you're ready to talk."
              : ["thinking", "transcribing"].includes(state.phase) || (state.phase === "speaking" && playbackPhase === "preparing")
                 ? state.inputReady ? "I'm working. You can interrupt me." : "One moment—I'm working on that."
                : connecting ? state.connectionStage ? connectionStages[state.connectionStage].hint : "Preparing your call…"
                  : "Just talk. You can interrupt me."}</p>
          )}
          {blocked && (
            <button className="button call-audio-unlock" onClick={onResumeAudio}>
              <Volume2 size={18} /> Enable audio
            </button>
          )}
          {state.phase === "error" && (
            <button className="button call-audio-unlock" onClick={onRetry}>
              <Phone size={18} /> Try call again
            </button>
          )}
          {captions && (
            <div className="call-captions" aria-live="polite" aria-label="Call captions">
              {state.caption ? <><strong>{state.caption.role === "user" ? "You" : "JARVIS"}</strong><p>{state.caption.text}</p></>
                : <p>Your conversation will appear here.</p>}
            </div>
          )}
        </main>
        <footer className="call-footer">
          <div className="call-controls">
            <button className={`call-control ${state.muted ? "selected" : ""}`} aria-pressed={state.muted}
              aria-label={state.muted ? "Unmute microphone" : "Mute microphone"} onClick={() => onMute(!state.muted)} disabled={connecting || disconnected}>
              <span>{state.muted ? <MicOff size={24} /> : <Mic size={24} />}</span>
              {state.muted ? "Unmute" : "Mute"}
            </button>
            <button className="call-control hang-up" onClick={onHangUp} aria-label="Hang up">
              <span><PhoneOff size={27} /></span>Hang up
            </button>
            <button className={`call-control ${captions ? "selected" : ""}`} aria-pressed={captions}
              aria-label={captions ? "Hide captions" : "Show captions"} onClick={() => setCaptions(!captions)}>
              <span><Captions size={24} /></span>Captions
            </button>
          </div>
          <p>{connecting ? "The call is not connected yet." : disconnected ? "Call not connected. Your chat is still available."
            : "Microphone connected. The conversation stays in your chat."}</p>
        </footer>
      </div>
    </dialog>
  );
}
