"use client";

/**
 * DoodleRenderer — renderer du bloc `doodle` : croquis Excalidraw inline.
 *
 * Au repos : canvas readonly sous un overlay transparent (le scroll de la
 * note n'est pas volé par le pan/zoom Excalidraw) — double-clic pour éditer.
 * En édition : canvas interactif, sauvegarde debouncée dans les props du
 * bloc via onChange (le bloc fait editor.updateBlock → markdown).
 *
 * Tout @supernote/canvas est lazy-loadé (Excalidraw ≈ chunk lourd) : une note
 * sans doodle ne paye rien, un doodle au repos ne charge qu'au premier rendu
 * du bloc.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button, Spinner } from "@heroui/react";
import { Check, PencilSimple } from "@phosphor-icons/react";
import type { CanvasDocument } from "@supernote/canvas";

const canvasModule = () => import("@supernote/canvas");
const SupernoteCanvas = dynamic(
  () => canvasModule().then((m) => ({ default: m.SupernoteCanvas })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Spinner aria-label="Chargement du croquis" />
      </div>
    ),
  },
);

const SAVE_DEBOUNCE_MS = 800;
const EMPTY_DOC: CanvasDocument = { nodes: [], edges: [], excalidrawElements: [] };

export function renderDoodle(props: {
  sceneData: string;
  onChange: (sceneData: string) => void;
}): React.ReactNode {
  return <DoodleBlock sceneData={props.sceneData} onChange={props.onChange} />;
}

function DoodleBlock({
  sceneData,
  onChange,
}: { sceneData: string; onChange: (sceneData: string) => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  // Document initial parsé une seule fois — les saves suivants ne doivent pas
  // remonter le canvas (la scène vit dans Excalidraw pendant l'édition).
  const [initialDoc, setInitialDoc] = useState<CanvasDocument | null>(null);
  const serializeRef = useRef<((doc: CanvasDocument) => string) | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    void canvasModule().then((m) => {
      if (cancelled) return;
      serializeRef.current = m.serializeCanvas;
      if (!sceneData.trim()) {
        setInitialDoc(EMPTY_DOC);
        return;
      }
      try {
        setInitialDoc(m.parseCanvas(sceneData));
      } catch {
        setInitialDoc(EMPTY_DOC);
      }
    });
    return () => { cancelled = true; };
    // sceneData volontairement absent des deps : snapshot initial uniquement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleChange = useCallback((doc: CanvasDocument) => {
    const serialize = serializeRef.current;
    if (!serialize) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      try {
        onChangeRef.current(serialize(doc));
      } catch {
        /* scène non sérialisable — on garde la précédente */
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  return (
    <div
      style={{
        position: "relative",
        height: editing ? 420 : 280,
        borderRadius: 10,
        border: editing
          ? "1px solid var(--accent, #6366F1)"
          : "1px solid var(--border-subtle)",
        overflow: "hidden",
        transition: "height 180ms ease, border-color 180ms ease",
        background: "var(--surface-0)",
      }}
    >
      {initialDoc !== null && (
        <SupernoteCanvas
          initialData={initialDoc}
          onChange={handleChange}
          readOnly={!editing}
        />
      )}

      {/* Overlay repos : bloque pan/zoom, double-clic = édition. */}
      {!editing && (
        <div
          onDoubleClick={() => setEditing(true)}
          title="Double-clic pour dessiner"
          style={{ position: "absolute", inset: 0, cursor: "pointer" }}
        />
      )}

      {/* Bouton coin haut-droit : Modifier / Terminé. */}
      <div style={{ position: "absolute", top: 8, right: 8, zIndex: 10 }}>
        <Button
          variant={editing ? "primary" : "ghost"}
          size="sm"
          aria-label={editing ? "Terminer le croquis" : "Modifier le croquis"}
          onPress={() => setEditing((e) => !e)}
        >
          {editing ? <Check size={14} /> : <PencilSimple size={14} />}
          <span style={{ marginLeft: 4, fontSize: 12 }}>
            {editing ? "Terminé" : "Dessiner"}
          </span>
        </Button>
      </div>
    </div>
  );
}
