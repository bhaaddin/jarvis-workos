import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("authenticated public HTTPS notebook call reaches real local speech and assistant", async ({ browser, request }, info) => {
  // Credentials stay in this process and are never attached to a report or trace.
  const config = JSON.parse(await readFile(new URL("../../runtime/notebook-call.json", import.meta.url), "utf8"));
  const denied = await request.get(config.url + "/api/session");
  expect(denied.status()).toBe(401);
  const context = await browser.newContext({ httpCredentials: { username: config.username, password: config.password }, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [], chatBodies = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().endsWith("/api/chat/jobs")) chatBodies.push(request.postDataJSON()); });
  try {
    await page.goto(config.url + "/#assistant");
    await expect(page.getByRole("button", { name: "Call JARVIS", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
    expect(await page.evaluate(() => document.querySelector('meta[name="jarvis-remote-call"]')?.content)).toBe("true");
    const isolation = await page.evaluate(async () => {
      const session = await fetch("/api/session");
      const forbidden = await fetch("/api/catalog/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      return { session: await session.json(), managementStatus: forbidden.status };
    });
    expect(isolation.session.remote).toBe(true);
    expect(isolation.managementStatus).toBe(403);
    await page.getByRole("button", { name: "New conversation", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Let’s get to work." })).toBeVisible();
    await page.evaluate(async () => {
      const audio = new AudioContext(); await audio.resume();
      const response = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Please reply briefly. The notebook connection works.", voice: "af_heart" }) });
      if (!response.ok) throw new Error("Notebook speech fixture failed: " + response.status);
      const buffer = await audio.decodeAudioData(await response.arrayBuffer());
      window.notebookFixture = { audio, buffer, streams: [], destination: null };
      navigator.mediaDevices.getUserMedia = async () => {
        const destination = audio.createMediaStreamDestination();
        window.notebookFixture.destination = destination;
        window.notebookFixture.streams.push(destination.stream);
        return destination.stream;
      };
    });
    await page.getByRole("button", { name: "Call JARVIS", exact: true }).click();
    await page.locator('.jarvis-call[open] .call-layout[data-phase="listening"]').waitFor({ timeout: 45000 });
    await page.evaluate(() => {
      const f = window.notebookFixture;
      const source = f.audio.createBufferSource(); source.buffer = f.buffer;
      source.connect(f.destination); source.start();
    });
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio[aria-label="Spoken answer"]');
      return audio && !audio.paused && audio.currentTime > .1 && audio.duration > 1;
    }, null, { timeout: 100000 });
    expect(chatBodies).toHaveLength(1);
    expect(chatBodies[0].stream).toBe(false);
    await page.screenshot({ path: info.outputPath("notebook-https-call.png") });
    await page.getByRole("button", { name: "Hang up", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "JARVIS", exact: true })).not.toBeVisible();
    expect(await page.evaluate(() => window.notebookFixture.streams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("Prague weather speaks promptly through the real notebook path and survives refresh", async ({ browser }, info) => {
  const config = JSON.parse(await readFile(new URL("../../runtime/notebook-call.json", import.meta.url), "utf8"));
  const context = await browser.newContext({ httpCredentials: { username: config.username, password: config.password } });
  const page = await context.newPage();
  const errors = [], completions = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", async (response) => {
    if (/\/api\/chat\/jobs\/[0-9a-f]{32}\?/.test(response.url())) {
      const result = await response.json().catch(() => null);
      if (result?.status === "completed") completions.push(result);
    }
  });
  try {
    await page.goto(config.url + "/#assistant");
    await expect(page.getByRole("button", { name: "Call JARVIS", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "New conversation", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Let’s get to work." })).toBeVisible();
    await page.evaluate(async () => {
      const context = new AudioContext(); await context.resume();
      const response = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "What's the weather in Prague?", voice: "af_heart" }) });
      if (!response.ok) throw new Error("Synthetic weather phrase could not be prepared.");
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      window.weatherCall = { context, buffer, streams: [], destination: null, utteranceEnd: 0 };
      navigator.mediaDevices.getUserMedia = async () => {
        const destination = context.createMediaStreamDestination();
        window.weatherCall.destination = destination;
        window.weatherCall.streams.push(destination.stream);
        return destination.stream;
      };
    });
    await page.getByRole("button", { name: "Call JARVIS", exact: true }).click();
    await page.locator('.jarvis-call[open] .call-layout[data-phase="listening"]').waitFor({ timeout: 30000 });
    await page.evaluate(() => {
      const f = window.weatherCall;
      const source = f.context.createBufferSource(); source.buffer = f.buffer; source.connect(f.destination);
      source.onended = () => { f.utteranceEnd = performance.now(); };
      source.start();
    });
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio[aria-label="Spoken answer"]');
      return window.weatherCall.utteranceEnd && audio && !audio.paused && audio.currentTime > .1;
    }, null, { timeout: 20000 });
    const audibleSeconds = await page.evaluate(() => (performance.now() - window.weatherCall.utteranceEnd) / 1000);
    expect(audibleSeconds).toBeLessThan(10);
    expect(completions.at(-1)?.route).toBe("direct-weather");
    await page.getByRole("button", { name: "Show captions", exact: true }).click();
    await expect(page.getByLabel("Call captions")).toContainText("Open-Meteo");
    await expect(page.getByLabel("Call captions")).toContainText("Prague");
    await page.getByRole("button", { name: "Hang up", exact: true }).click();
    await page.reload();
    await expect(page.locator(".message.user .markdown")).toContainText(/weather in Prague/i);
    await expect(page.locator(".message.assistant .markdown")).toContainText("Open-Meteo");
    await info.attach("weather-latency", { body: JSON.stringify({ utterance_end_to_first_audible_seconds: Number(audibleSeconds.toFixed(3)), route: completions.at(-1)?.route, errors }), contentType: "application/json" });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
