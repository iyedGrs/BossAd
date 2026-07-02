import type { Message } from "@langchain/langgraph-sdk";

export type TimelineEntry = {
  id: string;
  kind: "plan" | "tool";
  label: string;
  args?: string;
  result?: string;
  status: "running" | "done";
};

const asText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c: any) => (typeof c === "string" ? c : (c?.text ?? ""))).join("")
      : "";

/** Tool calls (with matched results) + the agent's one-line plan, in order. */
export function deriveTimeline(messages: Message[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const resultsByCallId = new Map<string, string>();
  for (const m of messages) {
    if (m.type === "tool" && (m as any).tool_call_id) {
      resultsByCallId.set((m as any).tool_call_id, asText(m.content));
    }
  }
  let planEmitted = false;
  for (const m of messages) {
    if (m.type !== "ai") continue;
    const toolCalls = (m as any).tool_calls ?? [];
    const text = asText(m.content).trim();
    if (!planEmitted && text && toolCalls.length > 0) {
      entries.push({ id: `${m.id}-plan`, kind: "plan", label: text, status: "done" });
      planEmitted = true;
    }
    for (const tc of toolCalls) {
      const result = tc.id ? resultsByCallId.get(tc.id) : undefined;
      entries.push({
        id: tc.id ?? `${m.id}-${tc.name}`,
        kind: "tool",
        label: tc.name,
        args: JSON.stringify(tc.args),
        result,
        status: result !== undefined ? "done" : "running",
      });
    }
  }
  return entries;
}

/** The report = text of the last AI message that has content and no tool calls. */
export function deriveReport(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type !== "ai") continue;
    const toolCalls = (m as any).tool_calls ?? [];
    const text = asText(m.content);
    if (text.trim() && toolCalls.length === 0) return text;
  }
  return "";
}
