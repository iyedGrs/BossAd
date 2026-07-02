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
        <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-2">
          Analysis
        </label>
        <textarea
          value={text}
          onChange={(e) => { props.setPrefill(""); setValue(e.target.value); }}
          rows={3}
          placeholder="Ask the archive…"
          className="w-full resize-none rounded border border-line bg-surface p-3 text-sm outline-none placeholder:text-muted transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20"
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-muted">zone-scoped · mock archive · 40 ads</p>
          {props.isLoading ? (
            <button type="button" onClick={props.onStop}
              className="rounded border border-bad px-4 py-1.5 text-xs font-medium text-bad transition-colors hover:bg-bad/10">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!text.trim()}
              className="rounded bg-accent px-4 py-1.5 text-xs font-semibold text-bg transition-opacity disabled:opacity-40 hover:enabled:opacity-90">
              Run
            </button>
          )}
        </div>
      </form>
      <div className="px-5 py-3 border-t border-line/50">
        <p className="text-[11px] uppercase tracking-wide text-muted font-medium mb-2">Examples</p>
        {EXAMPLES.map((q) => (
          <button key={q} onClick={() => props.setPrefill(q)}
            className="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-muted/80 transition-all hover:text-ink hover:bg-surface/40 mb-1">
            ↳ {q}
          </button>
        ))}
      </div>
    </div>
  );
}
