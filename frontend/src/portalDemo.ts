import type { FirmProfile } from "./types";

// Synthetic, clearly-labeled sales-demo content. Used only when the
// VITE_PORTAL_DEMO build flag is "true" (Vercel demo deployment with no
// backend). Every demo surface carries a DEMO banner; nothing here is live.
export const DEMO_BANNER = "DEMO — synthetic data for showing firms. No live connection, no real invoices, no real money.";

export const demoProfile: FirmProfile = {
  tenant: "demo-firm",
  displayName: "Řemeslnictví Novák s.r.o.",
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
    reason: "DEMO: faktura FV-2026-041 na 48 500 Kč pro Bytové družstvo Vršovická 12 — připravena k odeslání.", inputHash: "demo", fingerprint: "demo" },
  { id: "demo-action-2", tool: "jarvis_web", state: "awaiting_approval",
    reason: "DEMO: firma STAVBY Horák s.r.o. nemá web — ukázkový web a nabídka připraveny ke schválení.", inputHash: "demo", fingerprint: "demo" },
];

export const demoTasks = [
  { id: "demo-task-1", data: { title: "DEMO: zkontrolovat fakturu FV-2026-041 a odeslat družstvu", state: "open", dueAt: null } },
  { id: "demo-task-2", data: { title: "DEMO: schůzka s Horákem ve čtvrtek 10:00 — připravit podklady", state: "open", dueAt: null } },
  { id: "demo-task-3", data: { title: "DEMO: poptat dodavatele ELMONT po splatnosti", state: "open", dueAt: null } },
];

export const demoArtifacts = [
  { id: "demo-artifact-1", name: "Nabídka — Rekonstrukce koupelny Vršovická.pdf", format: "pdf", bytes: 184320, url: "" },
  { id: "demo-artifact-2", name: "Faktura FV-2026-040.xlsx", format: "xlsx", bytes: 92160, url: "" },
  { id: "demo-artifact-3", name: "Zápis z jednání — Horák.docx", format: "docx", bytes: 46080, url: "" },
];

export const demoEvents = [
  { kind: "DEMO invoice.drafted FV-2026-041", created: 1790805600 },
  { kind: "DEMO website.mockup.ready STAVBY-Horák", created: 1790802000 },
  { kind: "DEMO meeting.brief.prepared čtvrtek-10:00", created: 1790798400 },
];

export const demoNotices = [
  { id: "demo-notice-1", title: "DEMO: od dodavatele ELMONT chybí faktura za září — připomenout?" },
  { id: "demo-notice-2", title: "DEMO: STAVBY Horák s.r.o. nemá webové stránky — ukázka hotová." },
];

export const demoConnections = {
  clinic: { connected: true, displayName: "DEMO ambulance" },
  mail: { connected: true, displayName: "DEMO schránka (12 nepřečtených)" },
  social: { connected: false },
  finance: { connected: true, displayName: "DEMO pokladna 24 800 Kč" },
};

export const demoFleet = [
  { firm: "Řemeslnictví Novák s.r.o.", tenant: "demo-firm-1", model: "local reasoner (demo)", pending: 2, open: 3, reachable: true,
    note: "DEMO: Phase A is one deployment per firm, each with its own database, secrets, domain, and portal." },
  { firm: "Penzion U Lesa", tenant: "demo-firm-2", model: "local reasoner (demo)", pending: 0, open: 5, reachable: true,
    note: "DEMO: same template, different firm profile and field packs." },
];
