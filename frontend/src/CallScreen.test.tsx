import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CallScreen } from "./CallScreen";
import { idleCall } from "./voiceConversation";

describe("call readiness labels", () => {
  it("does not claim microphone/listening readiness during connection", () => {
    const html = renderToStaticMarkup(<CallScreen open project="Synthetic call"
      state={{ ...idleCall, phase: "starting", status: "Connecting to JARVIS…" }}
      playbackPhase="idle" playbackStatus="Local voice"
      audioVisual={{ current: { input: null, output: null, audio: null } }}
      onHangUp={() => {}} onMute={() => {}} onResumeAudio={() => {}} onRetry={() => {}} />);
    expect(html).not.toContain("Ready to speak");
    expect(html).not.toContain("Listening to you");
    expect(html).not.toContain("Connected to your workspace");
  });

  it("shows an actionable retry without claiming a failed call is connected", () => {
    const html = renderToStaticMarkup(<CallScreen open project="Synthetic call"
      state={{ ...idleCall, phase: "error", status: "Microphone permission is still waiting." }}
      playbackPhase="error" playbackStatus="Microphone permission is still waiting."
      audioVisual={{ current: { input: null, output: null, audio: null } }}
      onHangUp={() => {}} onMute={() => {}} onResumeAudio={() => {}} onRetry={() => {}} />);
    expect(html).toContain("Try call again");
    expect(html).toContain("Microphone permission is still waiting.");
    expect(html).not.toContain("Ready to speak");
    expect(html).not.toContain("Listening to you");
  });

  it("shows live input and interruption guidance while the assistant is thinking", () => {
    const html = renderToStaticMarkup(<CallScreen open project="Synthetic call"
      state={{ ...idleCall, phase: "thinking", status: "Thinking about your question…", inputReady: true, startedAt: 1 }}
      playbackPhase="idle" playbackStatus="Local voice"
      audioVisual={{ current: { input: null, output: null, audio: null } }}
      onHangUp={() => {}} onMute={() => {}} onResumeAudio={() => {}} onRetry={() => {}} />);
    expect(html).toContain("Ready to speak");
    expect(html).toContain("You can interrupt me");
    expect(html).not.toContain("Microphone paused");
  });

  it("does not claim to listen to a muted microphone", () => {
    const html = renderToStaticMarkup(<CallScreen open project="Synthetic call"
      state={{ ...idleCall, phase: "listening", status: "I'm listening", muted: true, startedAt: 1 }}
      playbackPhase="idle" playbackStatus="Local voice"
      audioVisual={{ current: { input: null, output: null, audio: null } }}
      onHangUp={() => {}} onMute={() => {}} onResumeAudio={() => {}} onRetry={() => {}} />);
    expect(html).toContain("Waiting for you to unmute");
    expect(html).not.toContain("Listening to you");
  });
});
