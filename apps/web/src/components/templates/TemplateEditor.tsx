"use client";

import { useCallback, useState } from "react";
import { Button, Input, TextArea } from "@heroui/react";
import { listVariables, renderTemplate } from "@supernote/templates";
import type { Template, TemplateResolvers } from "@supernote/templates";
import { Play, Tag } from "@phosphor-icons/react";

interface TemplateEditorProps {
  template: Template;
  onSave: (updated: Template) => void;
  /**
   * Optional override for the "Tester" action.
   * Receives the current body and returns { rendered, error? }.
   * When not provided, a local mock renderer is used.
   */
  onTest?: (body: string) => Promise<{ rendered: string; error?: string }>;
}

/** Minimal mock resolvers for the local "Test" preview feature. */
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

export function TemplateEditor({ template, onSave, onTest }: TemplateEditorProps) {
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
      if (onTest) {
        // Use tRPC backend renderer
        const result = await onTest(body);
        if (result.error) {
          setPreviewError(result.error);
          setPreview(null);
        } else {
          setPreview(result.rendered);
        }
      } else {
        // Local mock renderer fallback
        const result = await renderTemplate(
          { ...template, body },
          { resolvers: buildMockResolvers(), now: new Date() },
        );
        setPreview(result.body);
      }
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setIsRendering(false);
    }
  }, [onTest, template, body]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-transparent text-lg font-semibold"
          placeholder="Nom du template"
          aria-label="Nom du template"
        />
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onPress={handleTest}
            isDisabled={isRendering}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ backgroundColor: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            <Play size={12} />
            {isRendering ? "Rendu…" : "Tester"}
          </Button>
          <Button
            variant="primary"
            onPress={handleSave}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors"
          >
            Enregistrer
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: form */}
        <div
          className="flex flex-col gap-4 overflow-y-auto p-6"
          style={{ width: 320, borderRight: "1px solid var(--border-subtle)" }}
        >
          {/* Entity type */}
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              Type d&apos;entité cible
            </label>
            <Input
              type="text"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full text-sm"
              placeholder="ex: note, contact, projet…"
              aria-label="Type d'entité cible"
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
          <TextArea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={`flex-1 resize-none p-6 font-mono text-sm bg-[var(--surface-0)] text-[var(--text-primary)]${preview !== null || previewError !== null ? " border-b border-[var(--border-subtle)]" : ""}`}
            aria-label="Corps du template"
            spellCheck={false}
            rows={10}
          />
          {previewError && (
            <div className="p-4 text-xs" style={{ color: "#ef4444", backgroundColor: "var(--surface-1)" }}>
              Erreur : {previewError}
            </div>
          )}
          {preview !== null && !previewError && (
            <div
              className="overflow-y-auto p-6"
              style={{ maxHeight: "40%", backgroundColor: "var(--surface-1)" }}
            >
              <p
                className="mb-2 text-[10px] font-medium uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Aperçu rendu
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
