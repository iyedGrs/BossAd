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
    <div className="border-b border-line p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !props.isLoading) {
            props.onSubmit(text.trim());
            props.setPrefill("");
            setValue("");
          }
        }}
      >
        <textarea
          value={text}
          onChange={(e) => { props.setPrefill(""); setValue(e.target.value); }}
          rows={3}
          placeholder="Ask the archive…"
          className="w-full resize-none rounded-md border border-line bg-surface p-3 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-muted">zone-scoped · mock archive · 40 ads</p>
          {props.isLoading ? (
            <button type="button" onClick={props.onStop}
              className="rounded-md border border-bad px-4 py-1.5 text-sm text-bad hover:bg-bad/10">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!text.trim()}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-bg disabled:opacity-40">
              Run analysis
            </button>
          )}
        </div>
      </form>
      {EXAMPLES.map((q) => (
        <button key={q} onClick={() => props.setPrefill(q)}
          className="mt-1.5 block w-full truncate rounded px-2 py-1 text-left text-xs text-muted hover:bg-surface hover:text-ink">
          ↳ {q}
        </button>
      ))}
    </div>
  );
}
