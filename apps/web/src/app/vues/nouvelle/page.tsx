"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "@phosphor-icons/react";
import { AppShell } from "@/components/shell";
import { ViewKindPicker, ENTITY_TYPES } from "@/components/views";
import type { ViewKind } from "@supernote/views";

export default function NouvelleVuePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ViewKind>("table");
  const [entityTypeId, setEntityTypeId] = useState<string>(Object.keys(ENTITY_TYPES)[0] ?? "contact");
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    if (!name.trim()) {
      setError("Le nom de la vue est requis.");
      return;
    }
    // In production, this would call tRPC to persist the view.
    // For now, redirect to a mock edit page.
    const newId = `view-new-${Date.now()}`;
    router.push(`/vues/${newId}`);
  };

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div
          className="flex items-center gap-3 border-b px-4 py-2"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <button
            onClick={() => router.push("/vues")}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
            aria-label="Retour"
          >
            <ArrowLeft size={16} />
          </button>
          <h1 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Nouvelle vue
          </h1>
        </div>

        {/* Form */}
        <div className="mx-auto w-full max-w-lg px-6 py-10">
          <div className="flex flex-col gap-6">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="view-name"
                className="text-sm font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Nom de la vue
              </label>
              <input
                id="view-name"
                autoFocus
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: error ? "#ef4444" : "var(--border-subtle)",
                  backgroundColor: "var(--surface-1)",
                  color: "var(--text-primary)",
                  outline: "none",
                }}
                placeholder="ex. Contacts VIP, Projets Q2..."
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
              {error && (
                <p className="text-xs" style={{ color: "#ef4444" }}>{error}</p>
              )}
            </div>

            {/* EntityType */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="entity-type"
                className="text-sm font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Type d&apos;entite cible
              </label>
              <select
                id="entity-type"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: "var(--border-subtle)",
                  backgroundColor: "var(--surface-1)",
                  color: "var(--text-primary)",
                }}
                value={entityTypeId}
                onChange={(e) => setEntityTypeId(e.target.value)}
              >
                {Object.entries(ENTITY_TYPES).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>

            {/* Kind picker */}
            <div className="flex flex-col gap-1.5">
              <span
                className="text-sm font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Type de vue
              </span>
              <ViewKindPicker value={kind} onChange={setKind} />
            </div>

            {/* Submit */}
            <button
              onClick={handleCreate}
              className="flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              <Plus size={15} weight="bold" />
              Creer la vue
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
