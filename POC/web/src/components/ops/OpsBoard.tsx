import type { OpsService } from "../../lib/opsMessages";

const STATUS_COLOR: Record<string, string> = {
  healthy: "bg-ok",
  degraded: "bg-accent",
  down: "bg-bad",
};

export function OpsBoard({ services }: { services: OpsService[] }) {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-line">
      <div className="border-b border-line px-4 py-4">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted">
          Fleet status
        </span>
      </div>
      {services.length === 0 ? (
        <p className="p-4 font-mono text-[11px] text-muted/70">No signal yet.</p>
      ) : (
        <ul className="divide-y divide-line/50">
          {services.map((s) => (
            <li key={s.name} className="scan-in px-4 py-3">
              <div className="mb-1 flex items-center gap-2">
                <span className={`size-1.5 rounded-full ${STATUS_COLOR[s.status] ?? "bg-muted"}`} />
                <span className="font-mono text-[12px] font-medium text-ink">{s.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-2 font-mono text-[10.5px] text-muted">
                <span>replicas {s.replicas}</span>
                <span>v{s.version}</span>
                <span>uptime {s.uptime_pct}%</span>
                <span>err {s.error_rate_pct}%</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
