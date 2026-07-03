import type { Message } from "@langchain/langgraph-sdk";

export type OpsSkill = "diagnostics" | "scaling" | "recovery";

export type OpsEntry =
  | { id: string; kind: "human"; text: string; message: Message; index: number }
  | { id: string; kind: "think"; text: string; status: "running" | "done" }
  | {
      id: string;
      kind: "tool";
      name: string;
      args: string;
      result?: string;
      status: "running" | "done";
      skill?: OpsSkill;
      denied?: boolean;
    }
  | { id: string; kind: "answer"; text: string };

export type OpsService = {
  name: string;
  status: string;
  replicas: number;
  version: string;
  uptime_pct: number;
  error_rate_pct: number;
};

export type OpsBoardEvent = { type: "board"; services: OpsService[] };

/** Branch info for a message with edit/resubmit siblings — a thin projection
 * of useStream's MessageMetadata so leaf components don't need the full,
 * generically-typed shape. */
export type BranchInfo = { branch?: string; branchOptions?: string[] };

const SKILL_BY_TOOL: Record<string, OpsSkill> = {
  get_service_status: "diagnostics",
  get_metrics: "diagnostics",
  search_logs: "diagnostics",
  list_incidents: "diagnostics",
  scale_service: "scaling",
  restart_service: "recovery",
  rollback_deploy: "recovery",
};

const asText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c: any) => (typeof c === "string" ? c : (c?.text ?? ""))).join("")
      : "";

/** Chat transcript, in order: human turns, `think` asides, other tool calls
 * (revealed one at a time as they stream in), and the final answer. */
export function deriveOpsTranscript(messages: Message[]): OpsEntry[] {
  const resultsByCallId = new Map<string, { content: string; denied: boolean }>();
  for (const m of messages) {
    if (m.type === "tool" && (m as any).tool_call_id) {
      const content = asText(m.content);
      let denied = false;
      try {
        denied = Boolean(JSON.parse(content)?.denied);
      } catch {
        // not JSON — not a denial record
      }
      resultsByCallId.set((m as any).tool_call_id, { content, denied });
    }
  }

  const entries: OpsEntry[] = [];
  messages.forEach((m, index) => {
    if (m.type === "human") {
      entries.push({ id: m.id ?? `h-${index}`, kind: "human", text: asText(m.content), message: m, index });
      return;
    }
    if (m.type !== "ai") return;

    const toolCalls = (m as any).tool_calls ?? [];
    const text = asText(m.content).trim();

    if (toolCalls.length === 0) {
      if (text) entries.push({ id: m.id ?? `a-${index}`, kind: "answer", text });
      return;
    }

    for (const tc of toolCalls) {
      const res = tc.id ? resultsByCallId.get(tc.id) : undefined;
      if (tc.name === "think") {
        entries.push({
          id: tc.id ?? `${m.id}-${tc.name}`,
          kind: "think",
          text: tc.args?.thought ?? "",
          status: res !== undefined ? "done" : "running",
        });
        continue;
      }
      entries.push({
        id: tc.id ?? `${m.id}-${tc.name}`,
        kind: "tool",
        name: tc.name,
        args: JSON.stringify(tc.args),
        result: res?.content,
        status: res !== undefined ? "done" : "running",
        skill: SKILL_BY_TOOL[tc.name],
        denied: res?.denied,
      });
    }
  });
  return entries;
}
