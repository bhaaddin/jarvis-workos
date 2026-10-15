import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

// Isolated browser, synthetic microphone input, real browser Silero. The first
// case also exercises local Whisper, OpenClaw and Kokoro without API interception.
const call = (page) => page.getByRole("dialog", { name: "JARVIS", exact: true });
const phase = (page, value) => page.locator(`.jarvis-call[open] .call-layout[data-phase="${value}"]`);
const playing = (page) => page.waitForFunction(() => {
  const audio = document.querySelector('audio[aria-label="Spoken answer"]');
  return audio && !audio.paused && audio.currentTime > 0.15 && audio.duration > 1;
}, null, { timeout: 120000 });

async function openChat(page) {
  await page.goto("/#assistant");
  await page.getByRole("combobox", { name: "Active project" }).selectOption("medical");
  const create = page.getByRole("button", { name: /^New (?:mobile )?conversation$/ });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByRole("heading", { name: "Let’s get to work." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Call JARVIS", exact: true })).toBeEnabled();
}

async function microphone(page, phrases = ["Tell me the exact React version in the Medical frontend.", "What can you help me do with this project?"]) {
  await page.evaluate(async (texts) => {
    const context = new AudioContext();
    await context.resume();
    const buffers = [];
    for (const text of texts) {
      const response = await fetch("/api/voice/speak", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: "af_heart" }),
      });
      if (!response.ok) throw new Error(`Synthetic fixture failed: ${response.status}`);
      buffers.push(await context.decodeAudioData(await response.arrayBuffer()));
    }
    window.callFixture = { context, buffers, streams: [], sources: [], destination: null, phases: [] };
    navigator.mediaDevices.getUserMedia = async () => {
      const destination = context.createMediaStreamDestination();
      window.callFixture.destination = destination;
      window.callFixture.streams.push(destination.stream);
      return destination.stream;
    };
    const panel = document.querySelector(".call-layout");
    new MutationObserver(() => window.callFixture.phases.push({ at: Date.now(), phase: panel.dataset.phase, status: panel.querySelector(".call-status").textContent }))
      .observe(panel, { subtree: true, attributes: true, childList: true, characterData: true });
  }, phrases);
}

async function feed(page, index = 0) {
  // Deliberately no listening-only wait: user speech must interrupt actual output.
  await page.evaluate((value) => {
    const f = window.callFixture;
    if (!f.destination || !f.destination.stream.getTracks().some((track) => track.readyState === "live"))
      throw new Error("The call has no live microphone destination");
    const source = f.context.createBufferSource();
    source.buffer = f.buffers[value]; source.connect(f.destination); source.start(); f.sources.push(source);
  }, index);
}

async function tracks(page) {
  return page.evaluate(() => window.callFixture.streams.flatMap((stream) => stream.getTracks().map((track) => ({ state: track.readyState, enabled: track.enabled }))));
}

async function hangUp(page) {
  await page.getByRole("button", { name: "Hang up", exact: true }).click();
  await expect(call(page)).not.toBeVisible();
  const acquired = await tracks(page);
  expect(acquired.length).toBeGreaterThan(0);
  await expect.poll(async () => (await tracks(page)).every((track) => track.state === "ended")).toBe(true);
  expect(await page.locator("audio").evaluate((audio) => audio.paused)).toBe(true);
}

async function mockVoiceJob(page, answer, onStart = () => {}, beforePoll = async () => {}) {
  await page.route("**/api/chat/jobs", async (route) => {
    const value = route.request().postDataJSON(); onStart(value);
    await route.fulfill({ json: { id: value.request_id, status: "running" } });
  });
  await page.route(/\/api\/chat\/jobs\/[0-9a-f]{32}(?:\/cancel|\?.*)$/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ json: { requested: true } }); return;
    }
    await beforePoll();
    await route.fulfill({ json: { status: "completed", text: answer, next_offset: answer.length, has_more: false } }).catch(() => {});
  });
}

test("real phone call: one click, greeting, answer, spoken interruption, second answer", async ({ page }, info) => {
  const errors = [], questions = [], speech = [], transcripts = [], answers = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await openChat(page);
  await page.getByRole("textbox", { name: "Message JARVIS" }).fill("Keep this unsent typed draft.");
  await microphone(page);
  page.on("request", (request) => {
    if (request.url().endsWith("/api/chat/jobs")) questions.push(request.postDataJSON());
    if (request.url().endsWith("/api/voice/speak")) speech.push(request.postDataJSON());
  });
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/voice/transcribe")) transcripts.push(await response.json().catch(() => ({})));
  });
  await page.getByRole("button", { name: "Call JARVIS", exact: true }).click();
  await expect(call(page)).toBeVisible();
  await playing(page);
  expect(speech[0].text).toContain("Hi, I'm Jarvis");
  expect(questions).toHaveLength(0);
  await phase(page, "listening").waitFor({ timeout: 30000 });
  await feed(page, 0);
  await expect(page.locator('[data-speaker="user"]')).toHaveAttribute("data-speaking", "true");
  await page.screenshot({ path: info.outputPath("you-speaking-blue.png") });
  await playing(page);
  // Grounding and interruption are separate checks: do not demand a full answer
  // from a snapshot deliberately taken during its first streamed sentence.
  await expect(page.locator(".message.assistant .markdown").last()).toContainText("19.2.8", { timeout: 60000 });
  await playing(page);
  await expect(page.locator('[data-speaker="jarvis"]')).toHaveAttribute("data-speaking", "true");
  await page.screenshot({ path: info.outputPath("jarvis-speaking-green.png") });
  expect(speech.length).toBeGreaterThanOrEqual(2);
  answers.push(await page.locator(".message.assistant .markdown").last().textContent());
  const firstAudio = await page.locator("audio").evaluate((audio) => ({ src: audio.src, duration: audio.duration, time: audio.currentTime }));
  expect(firstAudio.duration - firstAudio.time).toBeGreaterThan(1);
  expect((await tracks(page)).some((track) => track.state === "live" && track.enabled)).toBe(true);
  await feed(page, 1); // Talk over JARVIS. No control is pressed.
  await phase(page, "hearing").waitFor({ timeout: 7000 });
  expect(await page.locator("audio").evaluate((audio) => audio.paused)).toBe(true);
  await playing(page);
  expect(speech.length).toBeGreaterThanOrEqual(3);
  answers.push(await page.locator(".message.assistant .markdown").last().textContent());
  await phase(page, "listening").waitFor({ timeout: 90000 });
  expect(questions).toHaveLength(2);
  expect(transcripts).toHaveLength(2);
  expect(answers[0]).toContain("19.2.8");
  expect(questions.every((question) => question.voice_mode === true)).toBe(true);
  expect(questions.every((question) => !question.message.includes("unsent typed draft"))).toBe(true);
  expect(await page.evaluate(() => window.callFixture.streams.length)).toBe(1);
  await page.screenshot({ path: info.outputPath("jarvis-phone-call-desktop.png") });
  await page.getByRole("button", { name: "Show captions" }).click();
  await expect(page.getByLabel("Call captions")).toContainText("JARVIS");
  await hangUp(page);
  await expect(page.getByRole("textbox", { name: "Message JARVIS" })).toHaveValue("Keep this unsent typed draft.");
  const report = info.outputPath("phone-call.json");
  await writeFile(report, JSON.stringify({ questions, transcripts, speech, answers, firstAudio, errors, phases: await page.evaluate(() => window.callFixture.phases) }, null, 2));
  await info.attach("phone-call", { path: report, contentType: "application/json" });
  expect(errors).toEqual([]);
});

test("mute silences capture during greeting and discards a partial utterance", async ({ page }) => {
  await openChat(page); await microphone(page);
  let transcriptions = 0;
  await page.route("**/api/voice/transcribe", async (route) => {
    transcriptions++; await route.fulfill({ json: { text: "Synthetic fresh turn" } });
  });
  await mockVoiceJob(page, "I heard your fresh question.");
  await page.getByRole("button", { name: "Call JARVIS", exact: true }).click();
  await playing(page);
  await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unmute microphone" })).toHaveAttribute("aria-pressed", "true");
  expect((await tracks(page)).every((track) => track.state === "live" && !track.enabled)).toBe(true);
  expect(await page.locator("audio").evaluate((audio) => audio.paused)).toBe(false);
  await feed(page);
  await phase(page, "listening").waitFor({ timeout: 30000 });
  expect(transcriptions).toBe(0);
  await page.getByRole("button", { name: "Unmute microphone" }).click();
  await feed(page);
  await phase(page, "hearing").waitFor();
  await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
  await page.waitForTimeout(4000); // Let the interrupted fixture and silence pass.
  expect(transcriptions).toBe(0);
  await page.getByRole("button", { name: "Unmute microphone" }).click();
  await feed(page, 1);
  await playing(page);
  expect(transcriptions).toBe(1);
  await hangUp(page);
});

test("speech begins while the remaining answer is still generating", async ({ page }, info) => {
  await openChat(page); await microphone(page);
  let complete = false;
  const first = "The useful first answer is ready for you. ";
  const rest = "These are the additional details.";
  await page.route("**/api/voice/transcribe", (route) => route.fulfill({ json: { text: "Synthetic early speech question" } }));
  await page.route("**/api/chat/jobs", (route) => route.fulfill({ json: { status: "running" } }));
  await page.route(/\/api\/chat\/jobs\/[0-9a-f]{32}(?:\/cancel|\?.*)$/, async (route) => {
    if (route.request().method() === "POST") { await route.fulfill({ json: { requested: true } }); return; }
    const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
    const text = offset === 0 ? first : complete ? rest : "";
    await route.fulfill({ json: { status: complete ? "completed" : "running", text,
      next_offset: offset + text.length, has_more: false } });
  });
  await page.getByRole("button", { name: "Call JARVIS", exact: true }).click();
  await phase(page, "listening").waitFor({ timeout: 30000 });
  await feed(page);
  await playing(page);
  expect(complete).toBe(false);
  await expect(page.locator('[data-speaker="jarvis"]')).toHaveAttribute("data-speaking", "true");
  await info.attach("early-audio", { body: JSON.stringify({ first_audio_before_complete_answer: true, speech: first }), contentType: "application/json" });
  complete = true;
  await phase(page, "listening").waitFor({ timeout: 30000 });
  await hangUp(page);
});

test("a background tab keeps the call connected; hangup cancels the originating chat", async ({ page }) => {
  await openChat(page); await microphone(page);
  const chats = [], aborts = [], speech = [];
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  page.on("request", (request) => { if (request.url().endsWith("/api/voice/speak")) speech.push(request.postDataJSON()); });
  await page.route("**/api/voice/transcribe", (route) => route.fulfill({ json: { text: "Synthetic turn" } }));
  await page.route("**/api/conversations/abort", async (route) => {
    aborts.push(route.request().postDataJSON()); await route.fulfill({ json: { requested: true } });
  });
  await mockVoiceJob(page, "Stale answer", (value) => chats.push(value), () => delayed);
  await page.getByRole("button", { name: "Call JARVIS", exact: true }).click();
  await phase(page, "listening").waitFor({ timeout: 30000 });
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(call(page)).toBeVisible();
  expect((await tracks(page)).some((track) => track.enabled)).toBe(true);
  await feed(page);
  await expect.poll(() => chats.length).toBe(1);
  await hangUp(page);
  await page.getByRole("combobox", { name: "Active project" }).selectOption("jarvis-workos");
  await expect.poll(() => aborts.length).toBe(1);
  expect(aborts[0]).toEqual({ project: "medical", thread: chats[0].thread });
  release();
  await expect(page.getByRole("button", { name: "Call JARVIS", exact: true })).toBeEnabled();
  expect(speech).toHaveLength(1); // Greeting only; never read the cancelled answer.
});

test("autoplay fallback resumes the same call without another greeting or Call click", async ({ page }) => {
  await openChat(page); await microphone(page, []);
  let speech = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/voice/speak")) speech++; });
  await page.evaluate(() => {
    const play = HTMLMediaElement.prototype.play;
    let attempts = 0;
    HTMLMediaElement.prototype.play = function () {
      if (++attempts === 2) return Promise.reject(new DOMException("Synthetic autoplay rejection", "NotAllowedError"));
      return play.call(this);
    };
  });
  await page.getByRole("button", { name: "Call JARVIS", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable audio" })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Enable audio" }).click();
  await playing(page);
  await phase(page, "listening").waitFor({ timeout: 30000 });
  expect(speech).toBe(1);
  await hangUp(page);
});

test("late or denied microphone permission leaves a usable hangup and no stale greeting", async ({ page }) => {
  await openChat(page);
  let speech = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/voice/speak")) speech++; });
  await page.evaluate(() => {
    window.callFixture = { streams: [] };
    navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => { window.grantMicrophone = resolve; });
  });
  await page.getByRole("button", { name: "Call JARVIS", exact: true }).click();
  await page.waitForFunction(() => typeof window.grantMicrophone === "function");
  await page.getByRole("button", { name: "Hang up", exact: true }).click();
  await page.evaluate(() => {
    const context = new AudioContext();
    const stream = context.createMediaStreamDestination().stream;
    window.callFixture.streams.push(stream); window.grantMicrophone(stream);
  });
  await expect.poll(async () => (await tracks(page)).every((track) => track.state === "ended")).toBe(true);
  expect(speech).toBe(0);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Synthetic microphone permission denied", "NotAllowedError"); };
  });
  await page.getByRole("button", { name: "Call JARVIS", exact: true }).click();
  await phase(page, "error").waitFor();
  await expect(call(page)).toContainText("Synthetic microphone permission denied");
  await page.getByRole("button", { name: "Hang up", exact: true }).click();
  await expect(call(page)).not.toBeVisible();
  expect(speech).toBe(0);
});

for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`phone call fits ${size.width}×${size.height}, including mute and captions`, async ({ page }, info) => {
    await page.setViewportSize(size); await openChat(page); await microphone(page, []);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
    await expect(page.getByRole("button", { name: "Call JARVIS", exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "Call JARVIS", exact: true }).click();
    await playing(page);
    await expect(page.getByRole("button", { name: "Hang up", exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
    await page.getByRole("button", { name: "Show captions", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hang up", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.querySelector(".jarvis-call").scrollWidth)).toBe(size.width);
    await page.screenshot({ path: info.outputPath(`jarvis-call-${size.width}.png`) });
    await hangUp(page);
  });
}

test("slow history reconciliation is single-flight and restores conversation admission", async ({ page }) => {
  await page.route("**/api/preferences", (route) => route.fulfill({ json: { theme: "dark", voice: "bm_george", auto_speak: false, auto_send_voice: false } }));
  await openChat(page);
  let reads = 0;
  await page.route(/\/api\/conversations\/history\?/, async (route) => {
    reads++;
    await new Promise((resolve) => setTimeout(resolve, 5500));
    await route.fulfill({ json: { messages: [{ id: "fixture-user", role: "user", text: "Synthetic history check" }, { id: "fixture-answer", role: "assistant", text: "Synthetic answer" }], active: false, has_more: false } });
  });
  await page.route("**/api/chat", (route) => route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"done","answer":"Synthetic answer"}\n\n' }));
  await page.getByRole("textbox", { name: "Message JARVIS" }).fill("Synthetic history check");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".message.assistant .markdown")).toContainText("Synthetic answer");
  await expect(page.getByRole("button", { name: "Call JARVIS", exact: true })).toBeEnabled({ timeout: 10000 });
  expect(reads).toBe(1);
});
