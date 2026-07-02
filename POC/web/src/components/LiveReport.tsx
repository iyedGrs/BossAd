import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function LiveReport({ markdown, isLoading }: { markdown: string; isLoading: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [markdown]);

  if (!markdown && !isLoading) {
    return (
      <div className="flex h-full items-center justify-center px-10">
        <p className="font-serif text-3xl italic text-muted/60 text-center leading-relaxed max-w-sm">
          Ask the archive for insights.
        </p>
      </div>
    );
  }
  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
      className="h-full overflow-y-auto"
    >
      <article className="report px-12 py-10">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        {isLoading && (
          <span className="cursor-blink ml-1 inline-block h-5 w-px bg-accent align-text-bottom" />
        )}
      </article>
    </div>
  );
}
