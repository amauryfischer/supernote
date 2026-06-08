// Bloc Doodle — croquis Excalidraw inline dans la note.
// Le rendu (canvas Excalidraw) est délégué à l'app hôte via un provider
// context (pattern identique à embed). Sans renderer, fallback statique.

import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";

// ── Renderer slot (fourni par l'app hôte) ──────────────────────────────────

export interface DoodleRenderProps {
  /** JSON scène Excalidraw (elements + appState), "" si vierge. */
  sceneData: string;
  /** Persiste la nouvelle scène dans les props du bloc. */
  onChange: (sceneData: string) => void;
}

export type DoodleRenderer = (props: DoodleRenderProps) => React.ReactNode;

const DoodleRendererContext = React.createContext<DoodleRenderer | null>(null);

export function DoodleProvider({
  renderer,
  children,
}: {
  /** null → les blocs doodle affichent le fallback statique. */
  renderer: DoodleRenderer | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <DoodleRendererContext.Provider value={renderer}>
      {children}
    </DoodleRendererContext.Provider>
  );
}

export function useDoodleRenderer(): DoodleRenderer | null {
  return React.useContext(DoodleRendererContext);
}

// ── Block spec ──────────────────────────────────────────────────────────────

// prop sceneData : NE PAS renommer — la sérialisation markdown
// `[doodle scene="..."]` (serialization/serialize.ts, parse.ts) en dépend.
export const doodleBlockSpec = createReactBlockSpec(
  {
    type: "doodle" as const,
    propSchema: {
      sceneData: {
        default: "",
      },
    },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const sceneData = (block.props.sceneData ?? "") as string;
      const renderer = useDoodleRenderer();

      const onChange = (next: string) => {
        editor.updateBlock(block.id, { props: { sceneData: next } } as never);
      };

      return (
        <div
          className="sn-doodle"
          // Bloc non éditable — le canvas Excalidraw gère son propre focus.
          contentEditable={false}
        >
          {renderer ? (
            renderer({ sceneData, onChange })
          ) : (
            <DoodleStaticFallback />
          )}
        </div>
      );
    },
    toExternalHTML: () => {
      // Export HTML : marqueur statique, la scène n'est pas exportable.
      return <div className="sn-doodle-export">[doodle]</div>;
    },
  },
);

// ── Fallback statique (pas de renderer fourni) ─────────────────────────────

function DoodleStaticFallback(): React.JSX.Element {
  return (
    <div className="sn-doodle__fallback">
      <span aria-hidden="true">✏️</span> Croquis — disponible dans l'app
    </div>
  );
}
