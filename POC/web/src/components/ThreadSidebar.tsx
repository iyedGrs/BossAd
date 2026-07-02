import { useCallback, useEffect, useState } from "react";
import { Client, type Thread } from "@langchain/langgraph-sdk";

function asText(content: unknown): string {
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c: any) => (typeof c === "string" ? c : (c?.text ?? ""))).join("")
      : "";
}

function threadTitle(thread: Thread): string {
  const messages = (thread.values as any)?.messages as any[] | undefined;
  const firstHuman = messages?.find((m) => m.type === "human");
  const text = asText(firstHuman?.content).trim();
  return text || "Untitled thread";
}

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function ThreadSidebar(props: {
  apiUrl: string;
  activeThreadId: string | null;
  refreshKey: number;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const client = new Client({ apiUrl: props.apiUrl });
      const result = await client.threads.search({
        limit: 50,
        sortBy: "updated_at",
        sortOrder: "desc",
      });
      setThreads(result);
    } catch {
      // Aegra may be offline — keep the last known list.
    } finally {
      setLoading(false);
    }
  }, [props.apiUrl]);

  useEffect(() => {
    refresh();
  }, [refresh, props.refreshKey]);

  return (
    <nav className="flex w-[220px] shrink-0 flex-col border-r border-line">
      <div className="flex items-center justify-between border-b border-line px-4 py-4">
        <span className="font-serif text-sm font-semibold tracking-tight text-ink">Threads</span>
        <button
          onClick={props.onNew}
          title="New thread"
          className="rounded px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-accent"
        >
          +
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 && !loading && (
          <p className="p-4 text-xs text-muted">No threads yet.</p>
        )}
        <ul>
          {threads.map((t) => {
            const active = t.thread_id === props.activeThreadId;
            return (
              <li key={t.thread_id}>
                <button
                  onClick={() => props.onSelect(t.thread_id)}
                  className={`block w-full border-b border-line/50 border-l-2 px-4 py-3 text-left transition-all ${
                    active
                      ? "border-l-accent bg-surface/60"
                      : "border-l-transparent hover:bg-surface/30"
                  }`}
                >
                  <p className={`truncate text-xs font-medium transition-colors ${active ? "text-ink" : "text-ink/70"}`}>
                    {threadTitle(t)}
                  </p>
                  <p className="mt-1 text-[10px] text-muted">{relativeTime(t.updated_at)}</p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
