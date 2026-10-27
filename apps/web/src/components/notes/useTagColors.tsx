"use client";

import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";
import { useToast } from "@supernote/ui";
import { ColorPickerPopover } from "@/components/shell";
import { trpc } from "@/lib/trpc/client";
import { withMutationFeedback } from "@/lib/trpc/with-mutation-feedback";

export const TAG_COLORS_EVENT = "supernote:tag-colors";
const STYLE_ID = "sn-tag-colors";

/**
 * Couleur choisie d'un tag (colonne `tag.color`) appliquée aux pastilles de l'éditeur,
 * et clic droit sur une pastille pour la changer. La minimap lit la couleur calculée des pastilles.
 */
export function useTagColors(containerRef: RefObject<HTMLElement | null>): {
  openPicker: (path: string, rect: DOMRect) => void;
  picker: ReactNode;
} {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const tags = (trpc.tags.list.useQuery({}).data as Array<{ path: string; color: string | null }> | undefined) ?? [];
  const update = trpc.tags.update.useMutation(
    withMutationFeedback(toast, { error: "Impossible de changer la couleur du tag" }, { onSuccess: () => void utils.tags.list.invalidate() }),
  );
  const [target, setTarget] = useState<{ path: string; rect: DOMRect } | null>(null);

  const css = tags
    .filter((t) => t.color && CSS.supports("color", t.color))
    .map((t) => {
      const sel = `.sn-tag.sn-tag[data-tag-path="${CSS.escape(t.path)}"]`;
      return `${sel}{--sn-tag-color:${t.color};color:${t.color};background:color-mix(in srgb, ${t.color} 14%, transparent)}`;
    })
    .join("\n");

  // ⚠️ Une `<style>` dans le head, jamais d'attribut posé sur la pastille : le MutationObserver de ProseMirror le verrait.
  useEffect(() => {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    if (el.textContent === css) return;
    el.textContent = css;
    window.dispatchEvent(new Event(TAG_COLORS_EVENT));
  }, [css]);

  const openPicker = useCallback((path: string, rect: DOMRect) => setTarget({ path, rect }), []);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onContextMenu = (e: MouseEvent) => {
      const pill = (e.target as Element | null)?.closest?.(".sn-tag");
      const path = pill?.getAttribute("data-tag-path");
      if (!pill || !path) return;
      e.preventDefault();
      openPicker(path, pill.getBoundingClientRect());
    };
    c.addEventListener("contextmenu", onContextMenu);
    return () => c.removeEventListener("contextmenu", onContextMenu);
  }, [containerRef, openPicker]);

  const picker = (
    <ColorPickerPopover
      open={target !== null}
      anchorRect={target?.rect ?? null}
      value={tags.find((t) => t.path === target?.path)?.color ?? null}
      onSelect={(color) => target && update.mutate({ path: target.path, color })}
      onReset={() => target && update.mutate({ path: target.path, color: null })}
      onClose={() => setTarget(null)}
    />
  );
  return { openPicker, picker };
}
