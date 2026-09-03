"use client";

import { Button } from "@heroui/react";
import { MagnifyingGlass, Lightbulb } from "@phosphor-icons/react";

interface EmptyStateProps {
  query: string;
  onExampleClick: (example: string) => void;
}

const EXAMPLES = [
  { query: "type:personne tag:client", label: "Contacts clients" },
  { query: "type:note tag:idee", label: "Notes idées" },
  { query: "type:note tag:urgent", label: "Notes urgentes" },
  { query: "type:journal", label: "Entrées de journal" },
  { query: "architecture AND NOT archive", label: "Architecture (sans archives)" },
  { query: "\"deep work\" tag:lecture", label: "Lectures Deep Work" },
];

const TIPS = [
  'Utilisez `type:personne` pour filtrer par type d\'entité',
  'Utilisez `tag:client` pour filtrer par tag',
  'Utilisez `in:Inbox` pour chercher dans un dossier',
  'Utilisez des guillemets pour une expression exacte : `"gestion de projet"`',
  'Combinez avec `AND`, `OR`, `NOT` : `reunion AND NOT archive`',
  'Excluez des termes avec `-` : `notes -archive`',
];

export function EmptyState({ query, onExampleClick }: EmptyStateProps) {
  const isSearch = query.trim().length > 0;

  return (
    <div className="flex flex-col items-center px-4 pt-16 text-center">
      <div
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ backgroundColor: "var(--accent-subtle)" }}
      >
        <MagnifyingGlass size={28} style={{ color: "var(--accent)" }} />
      </div>

      {isSearch ? (
        <>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Aucun résultat pour &ldquo;{query}&rdquo;
          </h2>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Essayez avec d&apos;autres termes ou des filtres différents.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Recherche dans tout le vault
          </h2>
          <p className="mt-2 max-w-md text-sm" style={{ color: "var(--text-secondary)" }}>
            Full-text, sémantique ou hybride. Filtres par type, tag, dossier, date, relation.
          </p>
        </>
      )}

      <div className="mt-8 w-full max-w-xl">
        <h3 className="sn-eyebrow mb-3 flex items-center justify-center gap-1.5">
          <Lightbulb size={12} />
          Exemples
        </h3>
        <div className="flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((ex) => (
            <Button
              key={ex.query}
              variant="outline"
              onPress={() => onExampleClick(ex.query)}
              className="h-auto rounded-lg border px-3 py-2 text-left flex-col items-start"
              style={{
                backgroundColor: "var(--surface-1)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                {ex.label}
              </p>
              <p className="mt-0.5 font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                {ex.query}
              </p>
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-8 w-full max-w-xl rounded-xl border p-4" style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}>
        <h3 className="sn-eyebrow mb-3">
          Conseils
        </h3>
        <ul className="flex flex-col gap-2">
          {TIPS.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-left">
              <span style={{ color: "var(--accent)" }} className="mt-0.5 shrink-0 text-xs">•</span>
              <span className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {tip.split(/`([^`]+)`/).map((part, i) =>
                  i % 2 === 1 ? (
                    <code
                      key={i}
                      className="rounded px-1 py-0.5 font-mono text-[10px]"
                      style={{ backgroundColor: "var(--surface-2)", color: "var(--accent)" }}
                    >
                      {part}
                    </code>
                  ) : (
                    part
                  )
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
