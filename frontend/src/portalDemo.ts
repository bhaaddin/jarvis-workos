import type { FirmProfile } from "./types";

// Synthetic, clearly-labeled sales-demo content. Used only when the
// VITE_PORTAL_DEMO build flag is "true" (Vercel demo deployment with no
// backend). Every demo surface carries a DEMO banner; nothing here is live.
export const DEMO_BANNER = "DEMO — synthetic data for showing firms. No live connection, no real invoices, no real money.";

export const demoProfile: FirmProfile = {
  tenant: "demo-firm",
  displayName: "Demo Řemeslnictví Novák",
  industry: "construction / trades",
  languages: ["cs", "en"],
  tone: "Short bullets, plain words, Czech with Czech speakers.",
  workingHours: { timezone: "Europe/Prague", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], start: "08:00", end: "17:00" },
  approvalDefaults: { external: "ask", money: "never", trading: "never" },
  fieldPacks: ["office", "finance", "web"],
  branding: { symbol: "J", theme: "dark" },
  billingNote: "DEMO: monthly hosting is invoiced manually after agreement. No payment gateway is connected.",
};

export const demoActions = [
  { id: "demo-action-1", tool: "jarvis_document_create", state: "awaiting_approval",
    reason: "DEMO: invoice draft FV-2026-041 for 48,500 Kč is ready to send.", inputHash: "demo", fingerprint: "demo" },
  { id: "demo-action-2", tool: "jarvis_web", state: "awaiting_approval",
    reason: "DEMO: demo website for a firm without one is ready for your review.", inputHash: "demo", fingerprint: "demo" },
];

export const demoTasks = [
  { id: "demo-task-1", data: { title: "DEMO: confirm invoice FV-2026-041 details", state: "open", dueAt: null } },
  { id: "demo-task-2", data: { title: "DEMO: review demo website draft", state: "open", dueAt: null } },
  { id: "demo-task-3", data: { title: "DEMO: prepare Thursday meeting brief", state: "open", dueAt: null } },
];

export const demoArtifacts = [
  { id: "demo-artifact-1", name: "DEMO-nabidka-rekonstrukce.pdf", format: "pdf", bytes: 184320, url: "" },
  { id: "demo-artifact-2", name: "DEMO-tydenni-report.xlsx", format: "xlsx", bytes: 92160, url: "" },
];

export const demoEvents = [
  { kind: "DEMO invoice.drafted", created: 1790805600 },
  { kind: "DEMO website.mockup.ready", created: 1790802000 },
  { kind: "DEMO meeting.brief.prepared", created: 1790798400 },
];

export const demoNotices = [
  { id: "demo-notice-1", title: "DEMO: missing invoice from supplier ELMONT detected." },
  { id: "demo-notice-2", title: "DEMO: firm STAVBY s.r.o. has no website — demo prepared." },
];

export const demoConnections = {
  clinic: { connected: true, displayName: "DEMO clinic" },
  mail: { connected: true, displayName: "DEMO inbox (12 unread)" },
  social: { connected: false },
  finance: { connected: true, displayName: "DEMO paper wallet 1,000 USDT" },
};

export const demoFleet = [
  { firm: "Demo Řemeslnictví Novák", tenant: "demo-firm-1", model: "local reasoner (demo)", pending: 2, open: 3, reachable: true,
    note: "DEMO row: Phase A is one deployment per firm, each with its own database, secrets, domain, and portal." },
  { firm: "Demo Penzion U Lesa", tenant: "demo-firm-2", model: "local reasoner (demo)", pending: 0, open: 5, reachable: true,
    note: "DEMO row: same template, different firm profile and field packs." },
];
