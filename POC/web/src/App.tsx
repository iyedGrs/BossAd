import { useStream } from "@langchain/langgraph-sdk/react";
import { deriveReport, deriveTimeline } from "./lib/messages";

export default function App() {
  const stream = useStream({
    apiUrl: "http://localhost:2024",
    assistantId: "agent",
    messagesKey: "messages",
  });
  const timeline = deriveTimeline(stream.messages);
  const report = deriveReport(stream.messages);

  return (
    <main style={{ padding: 24, fontFamily: "monospace" }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = new FormData(e.currentTarget).get("q") as string;
          if (q.trim()) stream.submit({ messages: [{ type: "human", content: q }] });
        }}
      >
        <input name="q" defaultValue="What's winning in Berlin for fitness products?" size={60} />
        <button type="submit" disabled={stream.isLoading}>Run</button>
      </form>
      <pre>{JSON.stringify(timeline, null, 2)}</pre>
      <pre>{report}</pre>
    </main>
  );
}
