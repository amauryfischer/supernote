"use client";

import { useCallback, useState } from "react";
import { listVariables } from "@supernote/templates";
import { renderTemplate } from "@supernote/templates";
import type { Template, TemplateResolvers } from "@supernote/templates";
import { Play, Tag } from "@phosphor-icons/react";

interface TemplateEditorProps {
  template: Template;
  onSave: (updated: Template) => void;
}

/** Minimal mock resolvers for the "Test" preview feature. */
function buildMockResolvers(): TemplateResolvers {
  return {
    promptUser: async (q, def) => def ?? `[${q}]`,
    selectOption: async (opts) => opts[0] ?? "",
    pickEntity: async () => ({ id: "mock", label: "Entité mock" }),
    incrementCounter: async () => 1,
    runJS: () => "mock",
    getTemplate: () => null,
    getVaultInfo: () => ({ name: "Vault", path: "/vault" }),
    getUserInfo: () => ({ name: "Utilisateur", email: "user@example.com" }),
  };
}

export function TemplateEditor({ template, onSave }: TemplateEditorProps) {
  const [name, setName] = useState(template.name);
  const [entityType, setEntityType] = useState(template.entityType ?? "");
  const [body, setBody] = useState(template.body);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  const variables = listVariables({ ...template, body });

  const handleSave = () => {
    onSave({ ...template, name, entityType: entityType || undefined, body });
  };

  const handleTest = useCallback(async () => {
    setIsRendering(true);
    setPreviewError(null);
    try {
      const result = await renderTemplate(
        { ...template, body },
        { resolvers: buildMockResolvers(), now: new Date() },
      );
      setPreview(result.body);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setIsRendering(false);
    }
  }, [template, body]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-transparent text-lg font-semibold outline-none"
          style={{ color: "var(--text-primary)" }}
          placeholder="Nom du template"
          aria-label="Nom du template"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={isRendering}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ backgroundColor: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            <Play size={12} />
            {isRendering ? "Rendu…" : "Tester"}
          </button>
          <button
            onClick={handleSave}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors"
            style={{ backgroundColor: "var(--accent)" }}
          >
            Enregistrer
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: form */}
        <div className="flex flex-col gap-4 overflow-y-auto p-6" style={{ width: 320, borderRight: "1px solid var(--border-subtle)" }}>
          {/* Entity type */}
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              Type d'entité cible
            </label>
            <input
              type="text"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full rounded-md border px-3 py-1.5 text-sm outline-none"
              style={{
                borderColor: "var(--border-subtle)",
                backgroundColor: "var(--surface-1)",
                color: "var(--text-primary)",
              }}
              placeholder="ex: note, contact, projet…"
            />
          </div>

          {/* Variables detected */}
          <div>
            <label className="mb-2 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              Variables détectées ({variables.length})
            </label>
            {variables.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Aucune variable
              </p>
            ) : (
              <ul className="space-y-1.5">
                {variables.map((v, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Tag size={12} style={{ color: "var(--accent)", marginTop: 2 }} />
                    <div>
                      <span
                        className="rounded px-1 py-0.5 font-mono text-[10px]"
                        style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
                      >
                        {v.raw}
                      </span>
                      <span className="ml-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {v.kind}{v.arg ? ` — ${v.arg}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: body textarea + preview */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="flex-1 resize-none p-6 font-mono text-sm outline-none"
            style={{
              backgroundColor: "var(--surface-0)",
              color: "var(--text-primary)",
              borderBottom: preview !== null || previewError !== null ? "1px solid var(--border-subtle)" : undefined,
            }}
            aria-label="Corps du template"
            spellCheck={false}
          />
          {previewError && (
            <div className="p-4 text-xs" style={{ color: "#ef4444", backgroundColor: "var(--surface-1)" }}>
              Erreur : {previewError}
            </div>
          )}
          {preview !== null && !previewError && (
            <div className="overflow-y-auto p-6" style={{ maxHeight: "40%", backgroundColor: "var(--surface-1)" }}>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Apercu rendu
              </p>
              <pre className="whitespace-pre-wrap font-mono text-xs" style={{ color: "var(--text-primary)" }}>
                {preview}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
