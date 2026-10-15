import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, Server } from "lucide-react";
import { api, isDemoPortal } from "./api";
import { DEMO_BANNER, demoFleet } from "./portalDemo";
import type { FirmProfile } from "./types";

const base = "/api/operator";
const req = <T,>(route: string, signal?: AbortSignal) => api<T>(base + route, undefined, { signal });
const errorText = (error: unknown) => error instanceof Error ? error.message : "The request failed.";

type InstanceRow = {
  firm: string; tenant: string; model: string; pending: number; open: number; reachable: boolean; note: string;
};

export function FleetAdmin() {
  const demo = isDemoPortal();
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<InstanceRow[]>(demo ? demoFleet : []);

  const load = async (signal?: AbortController) => {
    setError("");
    try {
      const firm = await req<{ firm: FirmProfile | null }>("/api/firm/profile", signal?.signal);
      if (signal?.signal.aborted) return;
      const settled = await Promise.allSettled([
        req<{ actions: Array<{ state: string }> }>("/api/actions", signal?.signal),
        req<{ tasks: Array<{ data: { state: string } }> }>("/api/tasks", signal?.signal),
        req<{ skills: unknown[]; model?: { name: string } }>("/api/skills", signal?.signal),
      ]);
      if (signal?.signal.aborted) return;
      const actions = settled[0].status === "fulfilled" ? settled[0].value.actions : [];
      const tasks = settled[1].status === "fulfilled" ? settled[1].value.tasks : [];
      const model = settled[2].status === "fulfilled" ? settled[2].value.model?.name ?? "unknown" : "unreachable";
      const reachable = settled[0].status === "fulfilled";
      setRows([{
        firm: firm.firm?.displayName ?? "Unconfigured firm",
        tenant: firm.firm?.tenant ?? "unknown",
        model,
        pending: actions.filter((item) => item.state === "awaiting_approval").length,
        open: tasks.filter((item) => !["done", "completed", "cancelled"].includes(item.data.state)).length,
        reachable,
        note: "Phase A: one deployment per firm. Each firm gets its own database, secrets, domain, and portal.",
      }]);
    } catch (cause) {
      if (!signal?.signal.aborted) setError(errorText(cause));
    } finally {
      if (!signal?.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    void load(controller);
    return () => controller.abort();
  }, []);

  if (loading) return <section className="operator-panel"><p role="status"><LoaderCircle className="spin" size={18} />Loading the fleet…</p></section>;

  return (
    <section className="operator-panel">
      <div className="page-heading">
        <div>
          <p className="section-label">Our admin</p>
          <h1>Jarvis fleet</h1>
          <p>Every firm we host, its health, and its load. Firms see only their own portal.</p>
        </div>
        <button className="button" disabled={demo} title={demo ? "Live data refreshes only in the live portal." : undefined}
          onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }}>
          <RefreshCw size={16} />Refresh
        </button>
      </div>
      {error && <p className="operator-error" role="alert">{error}</p>}
      {demo && <p className="operator-card" role="note"><strong>{DEMO_BANNER}</strong></p>}
      <section className="operator-card"><h2><Server size={16} /> Hosted instances</h2>
        {rows.length === 0 && <p>No instances reported. Start the deployment and reload.</p>}
        {rows.map((row) => (
          <p key={row.tenant}>
            <strong>{row.firm}</strong> ({row.tenant}) · {row.reachable ? "Reachable" : "Unreachable"} · {row.model} · {row.pending} approvals waiting · {row.open} open tasks
            <br /><span className="muted">{row.note}</span>
          </p>
        ))}
      </section>
      <section className="operator-card"><h2>Add a firm</h2>
        <p className="muted">Phase A: copy this deployment, edit <code>operator/config/firm.json</code> (tenant, name, industry, languages, packs), and start it with its own database and domain. The one-command template script is the M10 milestone.</p>
      </section>
    </section>
  );
}
