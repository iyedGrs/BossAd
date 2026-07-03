export type OpsInterruptValue = {
  action: string;
  service?: string;
  args: Record<string, unknown>;
  preview: string;
};

const ACTION_LABEL: Record<string, string> = {
  restart_service: "Restart service",
  scale_service: "Scale service",
  rollback_deploy: "Rollback deploy",
};

export function HitlCard(props: {
  value: OpsInterruptValue;
  onRespond: (response: { decision: "approve" | "deny"; reason?: string }) => void;
  pending: boolean;
}) {
  return (
    <div className="my-2 rounded-md border border-accent/50 bg-accent/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="pulse led-live inline-block size-1.5 rounded-full bg-accent text-accent" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-accent">
          Approval required
        </span>
      </div>
      <p className="mb-1 font-display text-sm text-ink">
        {ACTION_LABEL[props.value.action] ?? props.value.action}
        {props.value.service && <span className="text-muted"> · {props.value.service}</span>}
      </p>
      <p className="mb-3 font-mono text-[12.5px] text-muted">{props.value.preview}</p>
      <div className="flex gap-2">
        <button
          disabled={props.pending}
          onClick={() => props.onRespond({ decision: "approve" })}
          className="rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-bg transition-opacity disabled:opacity-40 hover:enabled:opacity-90"
        >
          Approve
        </button>
        <button
          disabled={props.pending}
          onClick={() => props.onRespond({ decision: "deny", reason: "denied by operator" })}
          className="rounded-md border border-bad px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-bad transition-colors disabled:opacity-40 hover:enabled:bg-bad/10"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
