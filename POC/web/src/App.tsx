import { useEffect, useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { RunComposer } from "./components/RunComposer";
import { AgentTimeline } from "./components/AgentTimeline";
import { LiveReport } from "./components/LiveReport";
import { ThreadSidebar } from "./components/ThreadSidebar";
import { deriveReport, deriveTimeline } from "./lib/messages";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:2024";

type PhaseEvent = { phase: string; status: "start" | "done"; label: string };

export default function App() {
  const [threadId, setThreadId] = useState<string | null>(
    () => sessionStorage.getItem("poc-thread"),
  );
  const [prefill, setPrefill] = useState("");
  const [threadListTick, setThreadListTick] = useState(0);
  const [phases, setPhases] = useState<PhaseEvent[]>([]);
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

  const timeline = deriveTimeline(stream.messages);
  const report = deriveReport(stream.messages);
  const status = stream.error ? "error" : stream.isLoading ? "running" : "idle";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <h1 className="font-serif text-lg font-semibold">
          BossAd <span className="text-muted">/ Insight POC</span>
        </h1>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className={`size-2 rounded-full ${
            status === "running" ? "pulse bg-accent" : status === "error" ? "bg-bad" : "bg-ok"
          }`} />
          {status}
          <button
            onClick={() => { sessionStorage.removeItem("poc-thread"); setThreadId(null); setPhases([]); }}
            className="ml-3 rounded border border-line px-2 py-0.5 hover:text-ink"
          >
            New thread
          </button>
        </div>
      </header>

      {stream.error != null && (
        <div className="border-b border-bad bg-bad/10 px-5 py-2 text-sm text-bad">
          {String((stream.error as Error).message ?? stream.error)} — is Aegra running on :2024?
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
          <AgentTimeline entries={timeline} phases={phases} />
        </aside>
        <section className="min-w-0 flex-1">
          <LiveReport markdown={report} isLoading={stream.isLoading} />
        </section>
      </div>
    </div>
  );
}
