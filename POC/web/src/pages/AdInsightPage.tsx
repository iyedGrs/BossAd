import { useEffect, useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { RunComposer } from "../components/RunComposer";
import { AgentTimeline } from "../components/AgentTimeline";
import { LiveReport } from "../components/LiveReport";
import { ThreadSidebar } from "../components/ThreadSidebar";
import { TopBar } from "../components/TopBar";
import { deriveReport, deriveTimeline, mergeTimeline, type PhaseEvent } from "../lib/messages";
import { tagThread } from "../lib/tagThread";
import type { Theme } from "../lib/theme";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:2024";
const ASSISTANT_ID = "agent";

export default function AdInsightPage({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [threadId, setThreadId] = useState<string | null>(
    () => sessionStorage.getItem("poc-thread"),
  );
  const [prefill, setPrefill] = useState("");
  const [threadListTick, setThreadListTick] = useState(0);
  const [phases, setPhases] = useState<PhaseEvent[]>([]);

  const stream = useStream({
    apiUrl: API_URL,
    assistantId: ASSISTANT_ID,
    messagesKey: "messages",
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      if (id) {
        sessionStorage.setItem("poc-thread", id);
        tagThread(API_URL, id, ASSISTANT_ID);
      }
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

  function resetThread() {
    sessionStorage.removeItem("poc-thread");
    setThreadId(null);
    setPhases([]);
  }

  return (
    <>
      <TopBar
        title="SIGNAL DESK"
        subtitle="ad-intel console"
        status={status}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onNewThread={resetThread}
      />
      {stream.error != null && (
        <div className="border-b border-bad/30 bg-bad/5 px-6 py-3 font-mono text-xs text-bad">
          <span className="font-semibold">ERROR //</span> {String((stream.error as Error).message ?? stream.error)} — is Aegra running on :2024?
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <ThreadSidebar
          apiUrl={API_URL}
          assistantId={ASSISTANT_ID}
          activeThreadId={threadId}
          refreshKey={threadListTick}
          onSelect={(id) => {
            setThreadId(id);
            sessionStorage.setItem("poc-thread", id);
            setPhases([]);
          }}
          onNew={resetThread}
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
    </>
  );
}
