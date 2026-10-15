import { useEffect, useState } from "react";
import { Box, Button, Card, CardContent, Chip, Container, Typography } from "@mui/material";
import { RefreshCw, Server } from "lucide-react";
import { api, isDemoPortal } from "./api";
import { DataTable, LoadingRow, NoticeBanner, PageHeader } from "./components";
import { DEMO_BANNER, demoFleet } from "./portalDemo";
import type { FirmProfile } from "./types";

const base = "/api/operator";
const req = <T,>(route: string, signal?: AbortSignal) => api<T>(base + route, undefined, { signal });
const errorText = (error: unknown) => error instanceof Error ? error.message : "The request failed.";

type InstanceRow = {
  firm: string; tenant: string; model: string; pending: number; open: number; reachable: boolean; note: string;
};

function HealthChip({ reachable }: { reachable: boolean }) {
  return reachable
    ? <Chip size="small" color="success" label="Reachable" />
    : <Chip size="small" color="error" label="Unreachable" />;
}

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
    <Container maxWidth="lg" sx={{ px: { xs: 2, sm: 3 }, py: 3 }}>
      <PageHeader kicker="Our admin" title="Jarvis fleet"
        subtitle="Every firm we host, its health, and its load. Firms see only their own portal."
        actions={
          <Button variant="outlined" disabled={demo}
            title={demo ? "Live data refreshes only in the live portal." : undefined}
            startIcon={<RefreshCw size={16} />}
            onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }}>
            Refresh
          </Button>
        } />
      {error && <NoticeBanner kind="error" text={error} />}
      {demo && <NoticeBanner kind="demo" text={DEMO_BANNER} />}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ mb: 2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
              <Typography variant="h6">Hosted instances</Typography>
              <Server size={16} color="#64748b" />
            </Box>
            <DataTable headers={["Firm", "Health", "Model", "Approvals", "Open tasks"]}
              empty="No instances reported. Start the deployment and reload."
              rows={rows.map((row) => [
                <Box key="f">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.firm}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{row.tenant}</Typography>
                  <Typography variant="caption" color="text.secondary">{row.note}</Typography>
                </Box>,
                <HealthChip key="h" reachable={row.reachable} />,
                <Typography key="m" variant="body2" color="text.secondary" sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{row.model}</Typography>,
                <Typography key="p" variant="h6">{row.pending}</Typography>,
                <Typography key="o" variant="h6">{row.open}</Typography>,
              ])} />
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Add a firm</Typography>
            <Typography variant="body2" color="text.secondary">
              Phase A: copy this deployment, edit <Typography component="code" variant="body2" sx={{ fontFamily: "monospace" }}>operator/config/firm.json</Typography> (tenant, name, industry, languages, packs), and start it with its own database and domain. The one-command template script is the M10 milestone.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}
