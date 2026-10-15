// Own components in the shadcn/ui pattern (MIT): copy-and-own source,
// Tailwind utilities, no component-vendor lock-in. Radix/shadcn CLI not used.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" };

export function Button({ variant = "secondary", className, ...rest }: ButtonProps) {
  const styles = {
    primary: "bg-gradient-to-b from-emerald-400 to-emerald-600 text-slate-950 font-semibold shadow-lg shadow-emerald-500/25 hover:from-emerald-300 hover:to-emerald-500",
    secondary: "bg-surface-800 text-slate-100 border border-line hover:border-slate-600 hover:bg-surface-700",
    ghost: "text-slate-300 hover:bg-surface-800 hover:text-white",
    danger: "bg-red-950/70 text-red-200 border border-red-800/70 hover:bg-red-900/70",
  } as const;
  return (
    <button
      className={cn("inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm transition-all",
        "disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950",
        styles[variant], className)}
      {...rest}
    />
  );
}

const badgeTones: Record<string, string> = {
  neutral: "bg-surface-800 text-slate-300 border-line",
  green: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  amber: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  blue: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  red: "bg-red-500/10 text-red-300 border-red-500/30",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
      badgeTones[tone] ?? badgeTones.neutral)}>
      {children}
    </span>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: Array<readonly [T, string]>; active: T; onChange: (tab: T) => void;
}) {
  return (
    <div role="tablist" aria-label="Sections" className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface-900/80 p-1.5 shadow-sm">
      {tabs.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={active === id}
          onClick={() => onChange(id)}
          className={cn("rounded-lg px-4 py-2 text-sm transition-all",
            active === id
              ? "bg-surface-700 font-medium text-white shadow-md ring-1 ring-white/10"
              : "text-slate-400 hover:bg-surface-800/70 hover:text-slate-100")}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-slate-300">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn("rounded-xl border border-line bg-surface-950 px-3.5 py-2.5 text-sm text-slate-100 shadow-inner",
        "placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500", props.className)}
    />
  );
}
