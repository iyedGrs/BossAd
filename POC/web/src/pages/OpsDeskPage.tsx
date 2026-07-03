import { useEffect, useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { ThreadSidebar } from "../components/ThreadSidebar";
import { TopBar } from "../components/TopBar";
import { OpsTranscript } from "../components/ops/OpsTranscript";
import { OpsComposer } from "../components/ops/OpsComposer";
import { OpsBoard } from "../components/ops/OpsBoard";
import type { OpsInterruptValue } from "../components/ops/HitlCard";
import { deriveOpsTranscript, type OpsBoardEvent, type OpsService } from "../lib/opsMessages";
import { tagThread } from "../lib/tagThread";
import type { Theme } from "../lib/theme";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:2024";
const ASSISTANT_ID = "ops_agent";

export default function OpsDeskPage({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [threadId, setThreadId] = useState<string | null>(
    () => sessionStorage.getItem("ops-thread"),
  );
  const [threadListTick, setThreadListTick] = useState(0);
  const [services, setServices] = useState<OpsService[]>([]);
  const [isResponding, setIsResponding] = useState(false);

  const stream = useStream({
    apiUrl: API_URL,
    assistantId: ASSISTANT_ID,
    messagesKey: "messages",
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      if (id) {
        sessionStorage.setItem("ops-thread", id);
        tagThread(API_URL, id, ASSISTANT_ID);
      }
    },
    onCustomEvent: (event) => {
      const e = event as OpsBoardEvent;
      if (e.type === "board") setServices(e.services);
    },
    reconnectOnMount: true,
  });

  useEffect(() => {
    if (!stream.isLoading) setThreadListTick((n) => n + 1);
  }, [stream.isLoading]);

  useEffect(() => {
    setIsResponding(false);
  }, [stream.interrupt]);

  const entries = deriveOpsTranscript(stream.messages);
  const interruptValue = stream.interrupt?.value as OpsInterruptValue | undefined;
  const status = stream.error ? "error" : stream.isLoading ? "running" : "idle";

  function resetThread() {
    sessionStorage.removeItem("ops-thread");
    setThreadId(null);
    setServices([]);
  }

  return (
    <>
      <TopBar
        title="OPS DESK"
        subtitle="fleet-response console"
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
            sessionStorage.setItem("ops-thread", id);
            setServices([]);
          }}
          onNew={resetThread}
        />
        <section className="flex min-w-0 flex-1 flex-col">
          <OpsTranscript
            entries={entries}
            interruptValue={interruptValue}
            isResponding={isResponding}
            onRespond={(response) => {
              setIsResponding(true);
              stream.submit(undefined, { command: { resume: response } });
            }}
            getBranchInfo={(message, index) => {
              const meta = stream.getMessagesMetadata(message, index);
              return { branch: meta?.branch, branchOptions: meta?.branchOptions };
            }}
            onEditMessage={(message, index, text) => {
              const meta = stream.getMessagesMetadata(message, index);
              stream.submit(
                { messages: [{ type: "human", content: text }] },
                { checkpoint: meta?.firstSeenState?.parent_checkpoint ?? undefined },
              );
            }}
            onSelectBranch={(branch) => stream.setBranch(branch)}
          />
          <OpsComposer
            isLoading={stream.isLoading}
            disabled={Boolean(stream.interrupt)}
            onStop={() => stream.stop()}
            onSubmit={(text) => stream.submit({ messages: [{ type: "human", content: text }] })}
          />
        </section>
        <OpsBoard services={services} />
      </div>
    </>
  );
}
