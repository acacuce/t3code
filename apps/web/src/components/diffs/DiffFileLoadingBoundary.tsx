import { useEffect, useRef } from "react";
import { useDelayedStatus } from "~/hooks/useDelayedStatus";
import { DiffFileHeaderSkeleton } from "../DiffPanelShell";

export function DiffFileLoadingBoundary({ load, count }: { load: () => void; count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const showLoading = useDelayedStatus("diff-file-loading", true);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load();
      },
      {
        root: ref.current.closest(".diff-render-surface"),
        rootMargin: "600px 0px",
      },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [load]);
  return (
    <div
      ref={ref}
      role="status"
      aria-label="Loading diff…"
      style={{ visibility: showLoading ? "visible" : "hidden" }}
    >
      {Array.from({ length: Math.min(count, 4) }, (_, index) => (
        <div key={index} aria-hidden className="border-b border-border/40">
          <DiffFileHeaderSkeleton titleWidth="medium" />
        </div>
      ))}
    </div>
  );
}
