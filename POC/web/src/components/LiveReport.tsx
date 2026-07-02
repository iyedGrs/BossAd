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
      <div className="flex h-full items-center justify-center">
        <p className="font-serif text-2xl italic text-muted">Ask the archive.</p>
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
      className="h-full overflow-y-auto px-10 py-8"
    >
      <article className="report">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        {isLoading && <span className="pulse ml-1 inline-block h-4 w-2 bg-accent align-text-bottom" />}
      </article>
    </div>
  );
}
