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
    return <p className="p-5 text-xs text-muted">Agent activity will appear here.</p>;
  return (
    <ol className="space-y-1 p-4">
      {entries.map((e) => (
        <li key={e.id} className="entry-rise">
          {e.kind === "phase" ? (
            <p className="flex items-center gap-2 py-1 text-xs text-muted">
              <SubagentTag subagent={e.subagent} />
              {e.label}
            </p>
          ) : e.kind === "plan" ? (
            <p className="border-l-2 border-accent py-1 pl-3 font-serif text-sm italic text-ink">
              {e.label}
            </p>
          ) : (
            <div className="rounded-md border border-line bg-surface">
              <button
                onClick={() => setOpen(open === e.id ? null : e.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                <Chip status={e.status} />
                <SubagentTag subagent={e.subagent} />
                <code className="font-mono text-xs text-ink">{e.label}</code>
                <span className="ml-auto text-xs text-muted">{open === e.id ? "−" : "+"}</span>
              </button>
              {open === e.id && (
                <div className="border-t border-line px-3 py-2 font-mono text-xs leading-relaxed text-muted">
                  <p className="mb-1 break-all"><span className="text-accent">args</span> {e.args}</p>
                  {e.result && (
                    <p className="max-h-40 overflow-auto break-all">
                      <span className="text-accent">result</span> {e.result.slice(0, 1500)}
                    </p>
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
