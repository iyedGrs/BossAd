import { useEffect, useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { RunComposer } from "./components/RunComposer";
import { AgentTimeline } from "./components/AgentTimeline";
import { LiveReport } from "./components/LiveReport";
import { ThreadSidebar } from "./components/ThreadSidebar";
import { deriveReport, deriveTimeline, mergeTimeline, type PhaseEvent } from "./lib/messages";
import { applyTheme, getStoredTheme, type Theme } from "./lib/theme";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:2024";

export default function App() {
  const [threadId, setThreadId] = useState<string | null>(
    () => sessionStorage.getItem("poc-thread"),
  );
  const [prefill, setPrefill] = useState("");
  const [threadListTick, setThreadListTick] = useState(0);
  const [phases, setPhases] = useState<PhaseEvent[]>([]);
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
  useEffect(() => { applyTheme(theme); }, [theme]);
  const stream = useStream({
    apiUrl: API_URL,
    assistantId: "agent",
    messagesKey: "messages",
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      if (id) sessionStorage.setItem("poc-thread", id);
    },
    onCustomEvent: (event) => {
      setPhases((prev) => [...prev, event as PhaseEvent]);
    },
    reconnectOnMount: true,
  });

  useEffect(() => {
    if (!stream.isLoading) setThreadListTick((n) => n + 1);
  }, [stream.isLoading]);

  const timeline = mergeTimeline(deriveTimeline(stream.messages), phases);
  const report = deriveReport(stream.messages);
  const status = stream.error ? "error" : stream.isLoading ? "running" : "idle";

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-line px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-xl font-semibold tracking-tight">
            BossAd <span className="font-sans text-sm font-normal text-muted">Insight POC</span>
          </h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className={`inline-block size-2 rounded-full transition-colors ${
                status === "running" ? "pulse bg-accent" : status === "error" ? "bg-bad" : "bg-ok"
              }`} />
              <span className="font-medium">{status}</span>
            </div>
            <div className="h-px w-px bg-line" />
            <button
              onClick={() => { sessionStorage.removeItem("poc-thread"); setThreadId(null); setPhases([]); }}
              className="rounded px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink hover:bg-surface/50"
            >
              New thread
            </button>
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="rounded px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink hover:bg-surface/50"
            >
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
          </div>
        </div>
      </header>

      {stream.error != null && (
        <div className="border-b border-bad/30 bg-bad/5 px-6 py-3 text-sm text-bad">
          <span className="font-medium">Error:</span> {String((stream.error as Error).message ?? stream.error)} — is Aegra running on :2024?
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ThreadSidebar
          apiUrl={API_URL}
          activeThreadId={threadId}
          refreshKey={threadListTick}
          onSelect={(id) => {
            setThreadId(id);
            sessionStorage.setItem("poc-thread", id);
            setPhases([]);
          }}
          onNew={() => {
            sessionStorage.removeItem("poc-thread");
            setThreadId(null);
            setPhases([]);
          }}
        />
        <aside className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-r border-line">
          <RunComposer
            isLoading={stream.isLoading}
            onStop={() => stream.stop()}
            onSubmit={(q) => stream.submit({ messages: [{ type: "human", content: q }] })}
            prefill={prefill}
            setPrefill={setPrefill}
          />
          <AgentTimeline entries={timeline} />
        </aside>
        <section className="min-w-0 flex-1">
          <LiveReport markdown={report} isLoading={stream.isLoading} />
        </section>
      </div>
    </div>
  );
}
