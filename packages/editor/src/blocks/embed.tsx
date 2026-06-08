// Bloc Embed / Transclusion — syntaxe Obsidian ![[Note]].
// Le rendu "portail vivant" est délégué à l'app hôte via un provider context
// (pattern identique à databaseView). Sans renderer, fallback statique.

import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";

// ── Renderer slot (fourni par l'app hôte) ──────────────────────────────────

export interface EmbedRenderProps {
  /** Nom de la note cible (wikilink). */
  target: string;
  /** Alias d'affichage optionnel. */
  alias?: string;
}

export type EmbedRenderer = (props: EmbedRenderProps) => React.ReactNode;

const EmbedRendererContext = React.createContext<EmbedRenderer | null>(null);

export function EmbedProvider({
  renderer,
  children,
}: {
  /** null → les blocs embed affichent le fallback statique. */
  renderer: EmbedRenderer | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <EmbedRendererContext.Provider value={renderer}>
      {children}
    </EmbedRendererContext.Provider>
  );
}

export function useEmbedRenderer(): EmbedRenderer | null {
  return React.useContext(EmbedRendererContext);
}

// ── Block spec ──────────────────────────────────────────────────────────────

// props target/alias : NE PAS renommer — la sérialisation markdown
// ![[target|alias]] (serialization/serialize.ts, parse.ts) en dépend.
export const embedBlockSpec = createReactBlockSpec(
  {
    type: "embed" as const,
    propSchema: {
      target: {
        default: "",
      },
      alias: {
        default: "",
      },
    },
    content: "none" as const,
  },
  {
    render: ({ block }) => {
      const target = (block.props.target ?? "") as string;
      const alias = (block.props.alias ?? "") as string;
      const renderer = useEmbedRenderer();

      return (
        <div
          className="sn-embed"
          data-target={target}
          // Bloc non éditable — le contenu transclus gère son propre focus.
          contentEditable={false}
        >
          {renderer ? (
            renderer({ target, alias: alias || undefined })
          ) : (
            <EmbedStaticFallback target={target} alias={alias} />
          )}
        </div>
      );
    },
    toExternalHTML: ({ block }) => {
      // Export markdown : ![[target]] ou ![[target|alias]] dans un <p>.
      const target = (block.props.target ?? "") as string;
      const alias = (block.props.alias ?? "") as string;
      return (
        <p>{alias ? `![[${target}|${alias}]]` : `![[${target}]]`}</p>
      );
    },
  },
);

// ── Fallback statique (pas de renderer fourni) ─────────────────────────────

function EmbedStaticFallback({
  target,
  alias,
}: {
  target: string;
  alias: string;
}): React.JSX.Element {
  return (
    <>
      <div className="sn-embed__header">
        <span className="sn-embed__icon" aria-hidden="true">
          ↗
        </span>
        <span className="sn-embed__label">{alias || target || "Embed"}</span>
      </div>
      <div className="sn-embed__content sn-embed__content--loading">
        {`Loading ![[${target}]]…`}
      </div>
    </>
  );
}
