import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FirmPortal, summarizeFirm } from "./FirmPortal";
import type { FirmProfile } from "./types";

afterEach(() => { vi.unstubAllEnvs(); });

const profile: FirmProfile = {
  tenant: "synthetic-firm", displayName: "Synthetic firm", industry: "trades",
  languages: ["cs", "en"], tone: "Short bullets.", workingHours: {}, approvalDefaults: { external: "ask", money: "never" },
  fieldPacks: ["office", "finance"], branding: { symbol: "J" }, billingNote: "Pilot invoicing is manual.",
};

describe("firm portal summary", () => {
  it("states pending approvals and open tasks with the firm identity", () => {
    expect(summarizeFirm(profile, 2, 5)).toBe(
      "Synthetic firm · trades · CS+EN · 2 waiting for approval · 5 open tasks · packs: office, finance");
  });

  it("does not claim connected data before the profile loads", () => {
    const html = renderToStaticMarkup(<FirmPortal onTalk={() => {}} />);
    expect(html).toContain("Connecting the firm portal");
    expect(html).not.toContain("Synthetic firm");
    expect(html).not.toContain("Waiting for approval");
  });

  it("renders labeled synthetic content in demo mode without a backend", () => {
    vi.stubEnv("VITE_PORTAL_DEMO", "true");
    const html = renderToStaticMarkup(<FirmPortal onTalk={() => {}} />);
    expect(html).toContain("DEMO — synthetic data");
    expect(html).toContain("Demo Řemeslnictví Novák");
    expect(html).not.toContain("Connecting the firm portal");
  });
});
