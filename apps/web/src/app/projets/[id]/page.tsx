"use client";

/**
 * Minimal projet detail page — reads the entity via tRPC and exposes an
 * editable title + description. Persists changes through entities.update on
 * blur. Created to fix navigation from /projets after creating a new entity
 * — without this page Next.js would 404 immediately after `router.push`.
 */

import { AppShell } from "@/components/shell";
import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/client";

export default function ProjetDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const query = trpc.entities.get.useQuery({ id }, { enabled: !!id });
  const utils = trpc.useUtils();
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate({ typeId: "projet" });
    },
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!query.data) return;
    setName(String(query.data.fields["name"] ?? ""));
    setDescription(String(query.data.fields["description"] ?? ""));
  }, [query.data]);

  function persist(nextName: string, nextDescription: string) {
    if (!query.data) return;
    updateMutation.mutate({
      id: query.data.id,
      fields: { name: nextName, description: nextDescription },
    });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Link
          href="/projets"
          className="mb-6 flex items-center gap-1.5 text-sm transition-colors hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={14} /> Projets
        </Link>

        {query.isLoading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement...</p>
        ) : query.isError || !query.data ? (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            Projet introuvable.
          </p>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => persist(name, description)}
              placeholder="Nom du projet"
              className="mb-4 w-full bg-transparent text-2xl font-semibold outline-none"
              style={{ color: "var(--text-primary)" }}
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => persist(name, description)}
              rows={12}
              placeholder="Description (Markdown)…"
              className="w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              style={{
                borderColor: "var(--border-subtle)",
                backgroundColor: "var(--surface-1)",
                color: "var(--text-primary)",
              }}
            />
            {updateMutation.isPending && (
              <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                Enregistrement…
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
