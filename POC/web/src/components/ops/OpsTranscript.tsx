import { useEffect, useRef, useState } from "react";
import type { Message } from "@langchain/langgraph-sdk";
import type { BranchInfo, OpsEntry } from "../../lib/opsMessages";
import { HitlCard, type OpsInterruptValue } from "./HitlCard";
import { SkillBadge } from "./SkillBadge";

function BranchSwitcher(props: { branch: string | undefined; options: string[]; onSelect: (branch: string) => void }) {
  const i = Math.max(0, props.options.indexOf(props.branch ?? props.options[0]));
  return (
    <div className="flex items-center gap-1 font-mono text-[10px] text-muted">
      <button disabled={i <= 0} onClick={() => props.onSelect(props.options[i - 1])} className="disabled:opacity-30 hover:text-accent">
        ‹
      </button>
      <span>{i + 1}/{props.options.length}</span>
      <button
        disabled={i >= props.options.length - 1}
        onClick={() => props.onSelect(props.options[i + 1])}
        className="disabled:opacity-30 hover:text-accent"
      >
        ›
      </button>
    </div>
  );
}

function EditableHumanBubble(props: { initialText: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(props.initialText);
  return (
    <div className="w-full max-w-[85%] rounded-lg border border-accent/50 bg-surface p-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        className="w-full resize-none bg-transparent text-[13.5px] text-ink outline-none"
        autoFocus
      />
      <div className="mt-1 flex justify-end gap-2">
        <button onClick={props.onCancel} className="font-mono text-[10px] uppercase text-muted hover:text-ink">
          Cancel
        </button>
        <button
          onClick={() => value.trim() && props.onSave(value.trim())}
          className="font-mono text-[10px] uppercase text-accent hover:opacity-80"
        >
          Save &amp; resubmit
        </button>
      </div>
    </div>
  );
}

export function OpsTranscript(props: {
  entries: OpsEntry[];
  interruptValue: OpsInterruptValue | undefined;
  onRespond: (response: { decision: "approve" | "deny"; reason?: string }) => void;
  isResponding: boolean;
  getBranchInfo: (message: Message, index: number) => BranchInfo;
  onEditMessage: (message: Message, index: number, text: string) => void;
  onSelectBranch: (branch: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.entries.length, props.interruptValue]);

  if (props.entries.length === 0 && !props.interruptValue) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-10">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted/50">standing by</span>
        <p className="max-w-sm text-center font-display text-2xl leading-relaxed text-muted/70">
          Ask ops about the fleet.
        </p>
      </div>
    );
  }

  return (
    <div ref={scroller} className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl space-y-2">
        {props.entries.map((e) => {
          if (e.kind === "human") {
            const info = props.getBranchInfo(e.message, e.index);
            return (
              <div key={e.id} className="entry-rise group flex flex-col items-end gap-1">
                {editingId === e.id ? (
                  <EditableHumanBubble
                    initialText={e.text}
                    onCancel={() => setEditingId(null)}
                    onSave={(text) => {
                      setEditingId(null);
                      props.onEditMessage(e.message, e.index, text);
                    }}
                  />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setEditingId(e.id)}
                      className="font-mono text-[10px] text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                      title="Edit and resubmit"
                    >
                      edit
                    </button>
                    <p className="max-w-[85%] rounded-lg bg-surface px-3.5 py-2 text-[13.5px] text-ink">{e.text}</p>
                  </div>
                )}
                {info.branchOptions && info.branchOptions.length > 1 && (
                  <BranchSwitcher branch={info.branch} options={info.branchOptions} onSelect={props.onSelectBranch} />
                )}
              </div>
            );
          }
          if (e.kind === "think") {
            return (
              <p key={e.id} className="scan-in border-l-2 border-line pl-3 font-display text-[13px] italic text-muted">
                {e.text}
                {e.status === "running" && (
                  <span className="cursor-blink ml-1 inline-block h-3 w-px bg-muted align-middle" />
                )}
              </p>
            );
          }
          if (e.kind === "answer") {
            return (
              <div key={e.id} className="entry-rise">
                <p className="max-w-[85%] rounded-lg border border-line bg-panel px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink">
                  {e.text}
                </p>
              </div>
            );
          }
          return (
            <div key={e.id} className="scan-in flex items-center gap-2.5 rounded-md border border-line bg-panel px-3 py-2">
              <span className={`inline-block size-1.5 rounded-full ${
                e.status === "running" ? "pulse led-live bg-accent text-accent" : e.denied ? "bg-bad" : "bg-ok"
              }`} />
              <SkillBadge skill={e.skill} />
              <code className="font-mono text-[12px] text-ink">{e.name}</code>
              <span className="truncate font-mono text-[10.5px] text-muted/70">{e.args}</span>
              {e.denied && <span className="ml-auto font-mono text-[10px] uppercase text-bad">denied</span>}
            </div>
          );
        })}
        {props.interruptValue && (
          <HitlCard value={props.interruptValue} onRespond={props.onRespond} pending={props.isResponding} />
        )}
      </div>
    </div>
  );
}
