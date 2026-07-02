import { useState } from "react";

const EXAMPLES = [
  "What's winning in Berlin for fitness products?",
  "Compare kitchen gadgets vs pet products in Paris.",
  "I have no product ideas — what's hot in Madrid?",
];

export function RunComposer(props: {
  isLoading: boolean;
  onSubmit: (q: string) => void;
  onStop: () => void;
  prefill: string;
  setPrefill: (v: string) => void;
}) {
  const [value, setValue] = useState("");
  const text = props.prefill || value;
  return (
    <div className="border-b border-line">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !props.isLoading) {
            props.onSubmit(text.trim());
            props.setPrefill("");
            setValue("");
          }
        }}
        className="p-5"
      >
        <label className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-accent">
          <span className="text-muted">$</span> query
        </label>
        <textarea
          value={text}
          onChange={(e) => { props.setPrefill(""); setValue(e.target.value); }}
          rows={3}
          placeholder="Ask the archive…"
          className="w-full resize-none rounded-md border border-line bg-surface p-3 font-mono text-[13px] outline-none placeholder:text-muted transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20"
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted/70">zone-scoped · mock archive · 40 ads</p>
          {props.isLoading ? (
            <button type="button" onClick={props.onStop}
              className="rounded-md border border-bad px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-bad transition-colors hover:bg-bad/10">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!text.trim()}
              className="rounded-md bg-accent px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-bg transition-opacity disabled:opacity-40 hover:enabled:opacity-90">
              Run →
            </button>
          )}
        </div>
      </form>
      <div className="px-5 py-3 border-t border-line/50">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted">Sample queries</p>
        {EXAMPLES.map((q) => (
          <button key={q} onClick={() => props.setPrefill(q)}
            className="mb-1 block w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-[11.5px] text-muted/80 transition-all hover:bg-surface/50 hover:text-ink">
            <span className="text-accent/70">›</span> {q}
          </button>
        ))}
      </div>
    </div>
  );
}
