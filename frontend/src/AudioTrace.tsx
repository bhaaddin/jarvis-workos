import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export type CallAudio = {
  input: Float32Array | null;
  output: { data: Float32Array; sampleRate: number } | null;
  audio: HTMLAudioElement | null;
};

/** Draw actual captured/played samples, without changing the speaker audio graph. */
export function AudioTrace({ source, speaker, open, muted = false }: {
  source: RefObject<CallAudio>; speaker: "user" | "jarvis"; open: boolean; muted?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!open || !canvas.current) return;
    const element = canvas.current;
    const context = element.getContext("2d");
    if (!context) return;
    let frame = 0, previous = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - previous < 40) return;
      previous = now;
      const { input, output, audio } = source.current;
      const samples = speaker === "user" ? (!muted ? input : null)
        : output && audio && !audio.paused && !audio.ended ? output.data : null;
      const offset = speaker === "jarvis" && output && audio ? Math.floor(audio.currentTime * output.sampleRate) : 0;
      context.clearRect(0, 0, element.width, element.height);
      context.strokeStyle = getComputedStyle(element).color;
      context.lineWidth = 2;
      context.beginPath();
      for (let point = 0; point <= 140; point++) {
        const sample = samples?.[offset + point * 3] || 0;
        const x = point / 140 * element.width;
        const y = element.height / 2 - Math.max(-1, Math.min(1, sample * 3)) * element.height * .42;
        if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [source, speaker, open, muted]);
  return <canvas ref={canvas} className="speaker-trace" width={420} height={88}
    aria-label={speaker === "user" ? "Your microphone waveform" : "JARVIS playback waveform"} />;
}
