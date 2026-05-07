"use client";

import { AppShell } from "@/components/shell";
import { TemplateEditor, TemplateList } from "@/components/templates";
import { SEED_TEMPLATES } from "@supernote/templates";
import type { Template } from "@supernote/templates";
import { useState, useEffect } from "react";
import { EmptyState, SkeletonText } from "@supernote/ui";
import { BookmarkSimple } from "@phosphor-icons/react";

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

function TemplatesPageContent() {
  const [isLoading, setIsLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([...SEED_TEMPLATES]);
  const [selectedId, setSelectedId] = useState<string | null>(SEED_TEMPLATES[0]?.id ?? null);

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 250);
    return () => clearTimeout(t);
  }, []);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const handleSave = (updated: Template) => {
    setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleNew = () => {
    const t = newCustomTemplate();
    setTemplates((prev) => [...prev, t]);
    setSelectedId(t.id);
  };

  if (isLoading) {
    return (
      <div className="flex h-full overflow-hidden">
        <div
          className="flex w-64 shrink-0 flex-col gap-3 border-r p-4"
          style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
        >
          {Array.from({ length: 5 }, (_, i) => <SkeletonText key={i} lines={2} />)}
        </div>
        <div className="flex-1 p-8">
          <SkeletonText lines={6} />
        </div>
      </div>
    );
  }

  const customTemplates = templates.filter((t) => !SEED_TEMPLATES.some((s) => s.id === t.id));

  return (
    <div className="flex h-full overflow-hidden">
      <TemplateList
        templates={templates}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNew={handleNew}
      />

      <main className="flex-1 overflow-hidden" style={{ backgroundColor: "var(--surface-0)" }}>
        {selected ? (
          <TemplateEditor key={selected.id} template={selected} onSave={handleSave} />
        ) : templates.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<BookmarkSimple size={28} />}
              title="Aucun template"
              description="Créez vos propres templates pour standardiser vos notes et documents."
              action={{ label: "+ Nouveau template", onClick: handleNew }}
            />
          </div>
        ) : customTemplates.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<BookmarkSimple size={28} />}
              title="Crée tes propres templates"
              description="Les templates seeds sont prêts. Crée un template personnalisé pour aller plus loin."
              action={{ label: "+ Nouveau template", onClick: handleNew }}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Sélectionnez ou créez un template
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <AppShell>
      <TemplatesPageContent />
    </AppShell>
  );
}
