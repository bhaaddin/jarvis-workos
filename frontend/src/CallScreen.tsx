import { useEffect, useLayoutEffect, useRef, useState, useId } from "react";
import { Alert, Avatar, Box, Button, Chip, IconButton, Typography } from "@mui/material";
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
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onHangUp(); }}
      style={{ border: "none", borderRadius: 20, padding: 0, maxWidth: 560, width: "calc(100vw - 32px)", background: "#0f1622", color: "#e2e8f0" }}
    >
      <Box sx={{ p: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <Avatar sx={{ bgcolor: "primary.main", color: "primary.contrastText", fontWeight: 800 }}>J</Avatar>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Voice call</Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">{project}</Typography>
          <Chip size="small" label={state.startedAt ? duration : connecting ? "Connecting" : "Not connected"} aria-label="Call duration" />
        </Box>

        <Typography variant="h4" component="h1" id={titleId} sx={{ mt: 2, textAlign: "center" }}>JARVIS</Typography>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, mt: 2 }}>
          <Box sx={{ p: 2, borderRadius: 3, textAlign: "center", border: 1, borderColor: userSpeaking ? "primary.main" : "divider", bgcolor: "rgba(255,255,255,0.02)" }} aria-label="Your speaking activity">
            <Avatar sx={{ width: 56, height: 56, mx: "auto", bgcolor: userSpeaking ? "primary.main" : "grey.800" }}>
              <UserRound size={32} />
            </Avatar>
            <Typography variant="h6" sx={{ mt: 1 }}>You</Typography>
            <Typography variant="body2" color="text.secondary">{userStatus}</Typography>
            <AudioTrace source={audioVisual} speaker="user" open={open} muted={state.muted} />
          </Box>
          <Box sx={{ p: 2, borderRadius: 3, textAlign: "center", border: 1, borderColor: jarvisSpeaking ? "secondary.main" : "divider", bgcolor: "rgba(255,255,255,0.02)" }} aria-label="JARVIS speaking activity">
            <Avatar sx={{ width: 56, height: 56, mx: "auto", bgcolor: jarvisSpeaking || working ? "primary.main" : "grey.800", fontWeight: 800, fontSize: "1.4rem" }}>J</Avatar>
            <Typography variant="h6" sx={{ mt: 1 }}>JARVIS</Typography>
            <Typography variant="body2" color="text.secondary">{assistantStatus}</Typography>
            <AudioTrace source={audioVisual} speaker="jarvis" open={open} />
          </Box>
        </Box>

        <Typography variant="body1" role="status" aria-live="polite" sx={{ mt: 2, textAlign: "center", fontWeight: 600 }}>{status}</Typography>
        {state.phase === "error" ? (
          <Alert severity="error" sx={{ mt: 1 }}>{state.status}</Alert>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, textAlign: "center" }}>
            {state.muted ? "Unmute when you're ready to talk."
              : ["thinking", "transcribing"].includes(state.phase) || (state.phase === "speaking" && playbackPhase === "preparing")
                ? state.inputReady ? "I'm working. You can interrupt me." : "One moment—I'm working on that."
                : connecting ? state.connectionStage ? connectionStages[state.connectionStage].hint : "Preparing your call…"
                : "Just talk. You can interrupt me."}
          </Typography>
        )}
        {blocked && (
          <Button variant="contained" fullWidth startIcon={<Volume2 size={18} />} onClick={onResumeAudio} sx={{ mt: 1.5 }}>
            Enable audio
          </Button>
        )}
        {state.phase === "error" && (
          <Button variant="contained" fullWidth startIcon={<Phone size={18} />} onClick={onRetry} sx={{ mt: 1.5 }}>
            Try call again
          </Button>
        )}
        {captions && (
          <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: "rgba(255,255,255,0.04)" }} aria-live="polite" aria-label="Call captions">
            {state.caption ? <><strong>{state.caption.role === "user" ? "You" : "JARVIS"}</strong><Typography variant="body2">{state.caption.text}</Typography></>
              : <Typography variant="body2">Your conversation will appear here.</Typography>}
          </Box>
        )}

        <Box sx={{ display: "flex", justifyContent: "center", gap: 2, mt: 2.5 }}>
          <Box sx={{ textAlign: "center" }}>
            <IconButton
              color={state.muted ? "primary" : "default"}
              aria-pressed={state.muted}
              aria-label={state.muted ? "Unmute microphone" : "Mute microphone"}
              onClick={() => onMute(!state.muted)}
              disabled={connecting || disconnected}
              sx={{ border: 1, borderColor: "divider", width: 56, height: 56 }}
            >
              {state.muted ? <MicOff size={24} /> : <Mic size={24} />}
            </IconButton>
            <Typography variant="caption" sx={{ mt: 0.5, display: "block" }}>{state.muted ? "Unmute" : "Mute"}</Typography>
          </Box>
          <Box sx={{ textAlign: "center" }}>
            <IconButton onClick={onHangUp} aria-label="Hang up" sx={{ bgcolor: "error.main", color: "#fff", width: 64, height: 64, "&:hover": { bgcolor: "error.dark" } }}>
              <PhoneOff size={27} />
            </IconButton>
            <Typography variant="caption" sx={{ mt: 0.5, display: "block" }}>Hang up</Typography>
          </Box>
          <Box sx={{ textAlign: "center" }}>
            <IconButton
              color={captions ? "primary" : "default"}
              aria-pressed={captions}
              aria-label={captions ? "Hide captions" : "Show captions"}
              onClick={() => setCaptions(!captions)}
              sx={{ border: 1, borderColor: "divider", width: 56, height: 56 }}
            >
              <Captions size={24} />
            </IconButton>
            <Typography variant="caption" sx={{ mt: 0.5, display: "block" }}>Captions</Typography>
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, textAlign: "center", display: "block" }}>
          {connecting ? "The call is not connected yet." : disconnected ? "Call not connected. Your chat is still available."
            : "Microphone connected. The conversation stays in your chat."}
        </Typography>
      </Box>
    </dialog>
  );
}
