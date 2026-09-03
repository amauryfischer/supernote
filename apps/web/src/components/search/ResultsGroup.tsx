"use client";

import type { SearchResult } from "@supernote/ipc";
import { ResultCard } from "./ResultCard";
import { ENTITY_TYPE_LABELS } from "./fixtures";

interface ResultsGroupProps {
  typeId: string;
  results: SearchResult[];
  query: string;
  debugMode?: boolean;
}

export function ResultsGroup({ typeId, results, query, debugMode }: ResultsGroupProps) {
  const label = ENTITY_TYPE_LABELS[typeId] ?? typeId;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="sn-eyebrow">
          {label}
        </h2>
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
        >
          {results.length}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {results.map((r) => (
          <ResultCard key={r.entityId} result={r} query={query} debugMode={debugMode} />
        ))}
      </div>
    </section>
  );
}
