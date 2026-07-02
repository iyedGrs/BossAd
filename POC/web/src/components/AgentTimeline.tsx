import { useState } from "react";
import type { TimelineEntry } from "../lib/messages";

const SUBAGENT_META: Record<string, { label: string; color: string }> = {
  market_scout: { label: "Scout", color: "text-accent" },
  scoring_analyst: { label: "Analyst", color: "text-ok" },
  report_writer: { label: "Writer", color: "text-ink" },
};

function Chip({ status }: { status: TimelineEntry["status"] }) {
  return status === "running" ? (
    <span className="pulse inline-block size-2 rounded-full bg-accent" title="running" />
  ) : (
    <span className="inline-block size-2 rounded-full bg-ok" title="done" />
  );
}

function SubagentTag({ subagent }: { subagent?: TimelineEntry["subagent"] }) {
  if (!subagent) return null;
  const meta = SUBAGENT_META[subagent];
  if (!meta) return null;
  return <span className={`text-[10px] font-medium uppercase tracking-wide ${meta.color}`}>{meta.label}</span>;
}

export function AgentTimeline({ entries }: { entries: TimelineEntry[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (entries.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-5">
        <p className="text-xs text-muted text-center">Agent activity will appear here.</p>
      </div>
    );
  return (
    <ol className="p-5 space-y-0">
      {entries.map((e) => (
        <li key={e.id} className="entry-rise">
          {e.kind === "phase" ? (
            <div className="py-3 border-b border-line/40 last:border-b-0">
              <p className="flex items-center gap-2 text-xs text-muted uppercase tracking-wide font-medium">
                <SubagentTag subagent={e.subagent} />
                <span>{e.label}</span>
              </p>
            </div>
          ) : e.kind === "plan" ? (
            <div className="py-4 border-l-3 border-accent pl-4 mb-1">
              <p className="font-serif text-sm italic text-ink leading-relaxed">
                {e.label}
              </p>
            </div>
          ) : (
            <div className="mb-2">
              <button
                onClick={() => setOpen(open === e.id ? null : e.id)}
                className="w-full group rounded border border-line bg-surface/50 hover:bg-surface transition-colors"
              >
                <div className="flex items-center gap-3 px-3 py-2.5 text-left">
                  <Chip status={e.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <SubagentTag subagent={e.subagent} />
                      <code className="font-mono text-xs text-ink truncate">{e.label}</code>
                    </div>
                  </div>
                  <span className="text-xs text-muted flex-shrink-0 group-hover:text-accent transition-colors">
                    {open === e.id ? "−" : "+"}
                  </span>
                </div>
              </button>
              {open === e.id && (
                <div className="mt-1 rounded border border-line border-t-0 bg-surface/30 px-3 py-2 font-mono text-xs leading-relaxed text-muted max-h-64 overflow-auto">
                  <div className="mb-1 space-y-1 break-all">
                    <div><span className="text-accent font-medium">args</span> <span className="text-ink">{e.args}</span></div>
                  </div>
                  {e.result && (
                    <div className="pt-1 border-t border-line/40 mt-1 space-y-1 break-all">
                      <div><span className="text-accent font-medium">result</span></div>
                      <div className="text-ink">{e.result.slice(0, 1500)}</div>
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
