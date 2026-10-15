import { useEffect, useState } from "react";
import { RefreshCw, Server } from "lucide-react";
import { api, isDemoPortal } from "./api";
import { Badge, Button } from "./ui/controls";
import { Card, CardTitle, DataTable, DemoBanner, ErrorBanner, LoadingRow, PageHeader } from "./ui/layout";
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

  if (loading) return <LoadingRow text="Loading the fleet…" />;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader kicker="Our admin" title="Jarvis fleet"
        subtitle="Every firm we host, its health, and its load. Firms see only their own portal."
        actions={
          <Button variant="secondary" disabled={demo}
            title={demo ? "Live data refreshes only in the live portal." : undefined}
            onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }}>
            <RefreshCw size={16} />Refresh
          </Button>
        } />
      {error && <ErrorBanner text={error} />}
      {demo && <DemoBanner text={DEMO_BANNER} />}
      <div className="flex flex-col gap-5">
        <Card>
          <CardTitle action={<Server size={16} className="text-slate-500" />}>Hosted instances</CardTitle>
          <DataTable headers={["Firm", "Health", "Model", "Approvals", "Open tasks"]}
            empty="No instances reported. Start the deployment and reload."
            rows={rows.map((row) => [
              <span key="f"><span className="font-medium text-white">{row.firm}</span>
                <br /><span className="font-mono text-xs text-slate-500">{row.tenant}</span>
                <br /><span className="text-xs text-slate-500">{row.note}</span></span>,
              row.reachable ? <Badge key="h" tone="green">Reachable</Badge> : <Badge key="h" tone="red">Unreachable</Badge>,
              <span key="m" className="font-mono text-xs text-slate-400">{row.model}</span>,
              <span key="p" className="text-lg font-semibold text-white">{row.pending}</span>,
              <span key="o" className="text-lg font-semibold text-white">{row.open}</span>,
            ])} />
        </Card>
        <Card>
          <CardTitle>Add a firm</CardTitle>
          <p className="text-sm text-slate-400">Phase A: copy this deployment, edit <code className="rounded bg-surface-950 px-1.5 py-0.5 font-mono text-xs text-emerald-300">operator/config/firm.json</code> (tenant, name, industry, languages, packs), and start it with its own database and domain. The one-command template script is the M10 milestone.</p>
        </Card>
      </div>
    </div>
  );
}
