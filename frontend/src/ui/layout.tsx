// Own layout primitives in the shadcn/ui pattern (MIT): premium dark
// ops-console cards, stats, tables, banners. No vendor dependency.
import type { ComponentType, ReactNode } from "react";
import { TriangleAlert, FlaskConical } from "lucide-react";
import { Badge, cn } from "./controls";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface-900/90 p-6 shadow-xl shadow-black/30 ring-1 ring-white/5", className)}>
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold tracking-tight text-white">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ kicker, title, subtitle, actions }: {
  kicker: string; title: string; subtitle: string; actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-400">
          <span className="inline-block h-px w-6 bg-emerald-400/70" />{kicker}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ icon: Icon, label, value, sub, accent }: {
  icon: ComponentType<{ size?: number | string; className?: string }>;
  label: string; value: ReactNode; sub?: string; accent?: string;
}) {
  return (
    <div className="group rounded-2xl border border-line bg-surface-900/90 p-5 shadow-lg shadow-black/20 ring-1 ring-white/5 transition-colors hover:border-slate-600">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", accent ?? "bg-emerald-500/10 text-emerald-300")}>
          <Icon size={17} />
        </span>
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-white">{value}</p>
      {sub && <p className="mt-1 text-xs leading-relaxed text-slate-500">{sub}</p>}
    </div>
  );
}

export function Hero({ title, body, actions, points }: {
  title: string; body: string; actions?: ReactNode; points?: string[];
}) {
  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-surface-800 via-surface-900 to-surface-950 p-6 shadow-xl shadow-black/30 sm:p-8">
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 right-32 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-xl font-bold text-slate-950 shadow-lg shadow-emerald-500/30">J</span>
          <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">{title}</h2>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">{body}</p>
        {points && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-3">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-2 rounded-xl border border-line bg-surface-950/60 px-3 py-2.5 text-xs leading-relaxed text-slate-300">
                <Badge tone="green">✓</Badge>{point}
              </li>
            ))}
          </ul>
        )}
        {actions && <div className="mt-5 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function DemoBanner({ text }: { text: string }) {
  return (
    <div role="note" className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 shadow-lg shadow-black/20">
      <FlaskConical size={20} className="mt-0.5 shrink-0 text-amber-300" />
      <p className="text-sm leading-relaxed text-amber-200"><strong className="font-semibold">Demo. </strong>{text}</p>
    </div>
  );
}

export function ErrorBanner({ text }: { text: string }) {
  return (
    <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 shadow-lg shadow-black/20">
      <TriangleAlert size={20} className="mt-0.5 shrink-0 text-red-300" />
      <p className="text-sm leading-relaxed text-red-200">{text}</p>
    </div>
  );
}

export function DataTable({ headers, rows, empty }: {
  headers: string[]; rows: ReactNode[][]; empty: string;
}) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-950/80 text-xs uppercase tracking-wider text-slate-500">
            {headers.map((head) => <th key={head} scope="col" className="px-4 py-3 font-semibold">{head}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {rows.map((cells, index) => (
            <tr key={index} className="transition-colors hover:bg-surface-800/50">
              {cells.map((cell, cellIndex) => <td key={cellIndex} className="px-4 py-3.5 align-top text-slate-200">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LoadingRow({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400" />
      <p className="text-sm text-slate-400">{text}</p>
    </div>
  );
}
