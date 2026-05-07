"use client";

import { AppShell } from "@/components/shell";
import { TemplateEditor, TemplateList } from "@/components/templates";
import { SEED_TEMPLATES } from "@supernote/templates";
import type { Template } from "@supernote/templates";
import { useState } from "react";

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
  const [templates, setTemplates] = useState<Template[]>([...SEED_TEMPLATES]);
  const [selectedId, setSelectedId] = useState<string | null>(SEED_TEMPLATES[0]?.id ?? null);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const handleSave = (updated: Template) => {
    setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleNew = () => {
    const t = newCustomTemplate();
    setTemplates((prev) => [...prev, t]);
    setSelectedId(t.id);
  };

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
