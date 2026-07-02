import type { Message } from "@langchain/langgraph-sdk";

export type TimelineEntry = {
  id: string;
  kind: "plan" | "tool" | "phase";
  label: string;
  args?: string;
  result?: string;
  status: "running" | "done";
  subagent?: "market_scout" | "scoring_analyst" | "report_writer";
};

export type PhaseEvent = { phase: string; status: "start" | "done"; label: string };

const SUBAGENT_BY_TOOL: Record<string, NonNullable<TimelineEntry["subagent"]>> = {
  search_ads: "market_scout",
  compare_products: "scoring_analyst",
};

const PHASE_ORDER: NonNullable<TimelineEntry["subagent"]>[] = [
  "market_scout",
  "scoring_analyst",
  "report_writer",
];

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

/** Groups timeline entries by which subagent's tool they belong to (tool name
 * uniquely identifies the subagent — search_ads only runs in market_scout,
 * compare_products only in scoring_analyst) and interleaves each group with
 * its phase-start marker, in the graph's fixed pipeline order. This relies on
 * the pipeline order being deterministic (see agent/router.py decide_next),
 * not on message/event arrival timing, since the two arrive on separate
 * streams with no shared sequence key. */
export function mergeTimeline(entries: TimelineEntry[], phases: PhaseEvent[]): TimelineEntry[] {
  const startLabels = new Map(
    phases.filter((p) => p.status === "start").map((p) => [p.phase, p.label] as const),
  );
  const tagged = entries.map((e) => ({
    ...e,
    subagent: e.kind === "tool" ? SUBAGENT_BY_TOOL[e.label] : undefined,
  }));

  const merged: TimelineEntry[] = tagged.filter((e) => !e.subagent && e.kind !== "tool");
  for (const subagent of PHASE_ORDER) {
    const label = startLabels.get(subagent);
    if (label) {
      merged.push({ id: `phase-${subagent}`, kind: "phase", label, status: "done", subagent });
    }
    merged.push(...tagged.filter((e) => e.subagent === subagent));
  }
  return merged;
}
