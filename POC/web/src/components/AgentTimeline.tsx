import { useState } from "react";
import type { TimelineEntry } from "../lib/messages";

const SUBAGENT_META: Record<string, { callsign: string; color: string; dot: string }> = {
  market_scout: { callsign: "SCOUT-01", color: "text-scout", dot: "bg-scout" },
  scoring_analyst: { callsign: "ANALYST-02", color: "text-analyst", dot: "bg-analyst" },
  report_writer: { callsign: "WRITER-03", color: "text-writer", dot: "bg-writer" },
};

function StatusDot({ status }: { status: TimelineEntry["status"] }) {
  return status === "running" ? (
    <span className="pulse led-live inline-block size-1.5 rounded-full bg-accent text-accent" title="running" />
  ) : (
    <span className="inline-block size-1.5 rounded-full bg-ok" title="done" />
  );
}

function SubagentBadge({ subagent }: { subagent?: TimelineEntry["subagent"] }) {
  if (!subagent) return null;
  const meta = SUBAGENT_META[subagent];
  if (!meta) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider ${meta.color}`}>
      <span className={`size-1 rounded-full ${meta.dot}`} />
      {meta.callsign}
    </span>
  );
}

export function AgentTimeline({ entries }: { entries: TimelineEntry[] }) {
  const [open, setOpen] = useState<string | null>(null);

  if (entries.length === 0)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-5 text-center">
        <span className="size-1.5 rounded-full bg-muted/40" />
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted/70">
          Awaiting transmission
        </p>
      </div>
    );

  return (
    <ol className="rail space-y-1 p-5 pl-2">
      {entries.map((e, i) => (
        <li key={e.id} className="scan-in pl-8" style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
          {e.kind === "phase" ? (
            <div className="relative -ml-8 flex items-center gap-2 py-3">
              <span
                className={`absolute left-[9px] size-3 rounded-full border-2 border-bg ${
                  e.subagent ? SUBAGENT_META[e.subagent]?.dot ?? "bg-muted" : "bg-muted"
                }`}
              />
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
                {e.label}
              </p>
              <span className="h-px flex-1 bg-line/60" />
            </div>
          ) : e.kind === "plan" ? (
            <div className="mb-2 border-l-2 border-accent/70 py-1 pl-3">
              <p className="font-display text-[13px] leading-snug text-ink/90">{e.label}</p>
            </div>
          ) : (
            <div className="relative mb-1.5">
              <span
                className={`absolute -left-8 top-2.5 size-3 rounded-full border-2 border-bg ${
                  e.subagent ? SUBAGENT_META[e.subagent]?.dot ?? "bg-line" : "bg-line"
                } ${e.status === "running" ? "pulse" : ""}`}
              />
              <button
                onClick={() => setOpen(open === e.id ? null : e.id)}
                className={`group w-full overflow-hidden rounded-md border border-line bg-panel text-left transition-colors hover:border-accent/50 ${
                  e.status === "running" ? "border-accent/40" : ""
                }`}
              >
                {e.status === "running" && <div className="sweep h-[2px] w-full" />}
                <div className="flex items-center gap-2.5 px-3 py-2">
                  <StatusDot status={e.status} />
                  <span className="font-mono text-[11px] text-muted select-none">&gt;</span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-1.5">
                      <SubagentBadge subagent={e.subagent} />
                    </div>
                    <code className="font-mono text-[12.5px] font-medium text-ink">{e.label}</code>
                    <span className="ml-2 font-mono text-[10.5px] text-muted/70 truncate">
                      {e.args && e.args.length > 46 ? e.args.slice(0, 46) + "…" : e.args}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted transition-colors group-hover:text-accent">
                    {open === e.id ? "−" : "+"}
                  </span>
                </div>
              </button>
              {open === e.id && (
                <div className="mt-1 space-y-2 rounded-md border border-line bg-bg/60 px-3 py-2.5 font-mono text-[11px] leading-relaxed">
                  <div>
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-accent">args</div>
                    <div className="break-all text-ink/90">{e.args}</div>
                  </div>
                  {e.result && (
                    <div className="border-t border-line/60 pt-2">
                      <div className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-accent">result</div>
                      <div className="max-h-64 overflow-auto break-all text-ink/90">
                        {e.result.slice(0, 1500)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
