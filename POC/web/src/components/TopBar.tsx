import { NavLink } from "react-router-dom";
import type { Theme } from "../lib/theme";

const NAV_LINKS = [
  { to: "/", label: "Ad Insight" },
  { to: "/ops", label: "Ops Desk" },
];

export function TopBar(props: {
  title: string;
  subtitle: string;
  status: "idle" | "running" | "error";
  theme: Theme;
  onToggleTheme: () => void;
  onNewThread: () => void;
}) {
  return (
    <header className="border-b border-line px-6 py-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg font-semibold tracking-tight">
            BOSSAD<span className="text-accent">//</span>
            <span className="text-muted">{props.title}</span>
          </h1>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-muted/60 sm:inline">
            {props.subtitle}
          </span>
          <nav className="ml-2 flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end
                className={({ isActive }) =>
                  `rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                    isActive ? "bg-surface text-accent" : "text-muted hover:text-ink"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-full border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-muted">
            <span className={`inline-block size-1.5 rounded-full transition-colors ${
              props.status === "running" ? "pulse led-live bg-accent text-accent" : props.status === "error" ? "bg-bad" : "bg-ok"
            }`} />
            <span className="font-semibold">{props.status}</span>
          </div>
          <button
            onClick={props.onNewThread}
            className="rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            New thread
          </button>
          <button
            onClick={props.onToggleTheme}
            className="rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted transition-colors hover:border-accent/50 hover:text-accent"
          >
            {props.theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </div>
    </header>
  );
}
