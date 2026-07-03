import { useState } from "react";

export function OpsComposer(props: {
  isLoading: boolean;
  disabled: boolean;
  onStop: () => void;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && !props.isLoading && !props.disabled) {
          props.onSubmit(value.trim());
          setValue("");
        }
      }}
      className="border-t border-line px-6 py-4"
    >
      <div className="mx-auto flex max-w-2xl items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={props.disabled}
          placeholder={props.disabled ? "Resolve the pending approval to continue…" : "Ask about the fleet…"}
          className="flex-1 rounded-md border border-line bg-surface px-3 py-2 font-mono text-[13px] outline-none placeholder:text-muted transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 disabled:opacity-50"
        />
        {props.isLoading ? (
          <button
            type="button"
            onClick={props.onStop}
            className="rounded-md border border-bad px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-bad transition-colors hover:bg-bad/10"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim() || props.disabled}
            className="rounded-md bg-accent px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-bg transition-opacity disabled:opacity-40 hover:enabled:opacity-90"
          >
            Send
          </button>
        )}
      </div>
    </form>
  );
}
