"use client";

import { TemplateEditor, TemplateList } from "@/components/templates";
import { useApplyTemplate } from "@/components/templates/useApplyTemplate";
import { SEED_TEMPLATES } from "@supernote/templates";
import { trpc } from "@/lib/trpc/client";
import type { Template } from "@supernote/templates";
import type { TemplateIpc } from "@supernote/ipc";
import { useState, useCallback } from "react";

// ── IPC adapter ───────────────────────────────────────────────────────────

function templateFromIpc(t: TemplateIpc): Template {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    entityType: t.entityType,
    body: t.body,
    frontmatter: t.frontmatter,
  };
}

// ── Loading skeleton ──────────────────────────────────────────────────────

function TemplateSidebarSkeleton() {
  return (
    <aside
      className="flex flex-col border-r animate-pulse"
      style={{ width: 260, minWidth: 260, backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="h-4 w-24 rounded" style={{ backgroundColor: "var(--surface-3)" }} />
      </div>
      <div className="flex-1 p-2 space-y-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 rounded-md" style={{ backgroundColor: "var(--surface-3)" }} />
        ))}
      </div>
    </aside>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────

let customIdCounter = 0;

function newCustomTemplate(): Template {
  customIdCounter += 1;
  return {
    id: `custom-${Date.now()}-${customIdCounter}`,
    name: "Nouveau template",
    description: "",
    icon: undefined,
    body: "# {{prompt:Titre?}}\n\n{{cursor}}\n",
  };
}

export function TemplatesTab() {
  const listQuery = trpc.templates.list.useQuery({ source: "all" });
  const saveMutation = trpc.templates.save.useMutation({
    onSuccess: () => { void listQuery.refetch(); },
  });
  const deleteMutation = trpc.templates.delete.useMutation({
    onSuccess: () => { void listQuery.refetch(); },
  });
  const testMutation = trpc.templates.test.useMutation();
  const { apply, isApplying, modal: applyModal } = useApplyTemplate();

  // Fallback: use local state when IPC unavailable
  const useFallback = listQuery.isError;
  const [localTemplates, setLocalTemplates] = useState<Template[]>([...SEED_TEMPLATES]);
  const [selectedId, setSelectedId] = useState<string | null>(SEED_TEMPLATES[0]?.id ?? null);

  const ipcTemplates: Template[] = (listQuery.data ?? []).map(templateFromIpc);
  const templates: Template[] = useFallback ? localTemplates : ipcTemplates;

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const handleSave = useCallback((updated: Template) => {
    if (useFallback) {
      setLocalTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      return;
    }
    saveMutation.mutate({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      icon: updated.icon,
      entityType: updated.entityType,
      body: updated.body,
      frontmatter: updated.frontmatter,
    });
  }, [useFallback, saveMutation]);

  const handleNew = useCallback(() => {
    const t = newCustomTemplate();
    if (useFallback) {
      setLocalTemplates((prev) => [...prev, t]);
      setSelectedId(t.id);
      return;
    }
    // Optimistically add to local then save
    saveMutation.mutate(
      { name: t.name, description: t.description, body: t.body },
      {
        onSuccess: (saved) => {
          void listQuery.refetch();
          setSelectedId(saved.id);
        },
      },
    );
  }, [useFallback, saveMutation, listQuery]);

  const handleDelete = useCallback((id: string) => {
    if (!confirm("Supprimer ce template ?")) return;
    if (useFallback) {
      setLocalTemplates((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (selectedId === id) setSelectedId(next[0]?.id ?? null);
        return next;
      });
      return;
    }
    // Seed templates can't be deleted via IPC
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          void listQuery.refetch();
          if (selectedId === id) setSelectedId(ipcTemplates[0]?.id ?? null);
        },
      },
    );
  }, [useFallback, deleteMutation, listQuery, selectedId, ipcTemplates]);

  return (
    <div
      className="flex overflow-hidden rounded-lg border"
      style={{
        height: "calc(100vh - var(--header-height) - 9rem)",
        minHeight: 480,
        borderColor: "var(--border-subtle)",
      }}
    >
      {listQuery.isLoading ? (
        <TemplateSidebarSkeleton />
      ) : (
        <TemplateList
          templates={templates}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNew={handleNew}
          onDelete={handleDelete}
        />
      )}

      <main className="flex-1 overflow-hidden" style={{ backgroundColor: "var(--surface-0)" }}>
        {selected ? (
          <TemplateEditor
            key={selected.id}
            template={selected}
            onSave={handleSave}
            onApply={apply}
            isApplying={isApplying}
            onTest={
              useFallback
                ? undefined
                : (body) =>
                    testMutation.mutateAsync({ id: selected.id, body }).then((r) => ({
                      rendered: r.rendered,
                      error: r.error,
                    }))
            }
          />
        ) : listQuery.isLoading ? null : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Sélectionnez ou créez un template
            </p>
          </div>
        )}
      </main>

      {/* Prompt flow for {{prompt:…}} placeholders when applying a template. */}
      {applyModal}
    </div>
  );
}
