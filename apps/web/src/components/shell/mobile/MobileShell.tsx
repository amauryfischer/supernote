"use client";

import { memo, useState } from "react";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileFab } from "./MobileFab";
import { MobileTopBar } from "./MobileTopBar";
import { MoreDrawer } from "./MoreDrawer";
import { useShellChrome } from "../shell-chrome-context";
import { ColumnEditorSidebar } from "@/components/bases/ColumnEditorSidebar";
import { EntityPeekPanel } from "@/components/bases/EntityPeekPanel";
import { ConnectVaultModal } from "@/components/notes/ConnectVaultModal";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import dynamic from "next/dynamic";

// Lazy-load the notification center so it's not in the critical mobile bundle.
const NotificationCenter = dynamic(
  () =>
    import("@supernote/notifications/renderer").then((m) => ({
      default: m.NotificationCenter,
    })),
  { ssr: false },
);

/**
 * Mobile shell — phone-sized chrome (≤ 767 px viewport).
 *
 * Layout:
 *   ┌──────────────────────┐  ← MobileTopBar (48 px + safe-area-top)
 *   ├──────────────────────┤
 *   │                      │
 *   │   {children}         │  ← scrollable main, padded for FAB + bottom nav
 *   │                      │
 *   │              [FAB]   │  ← floating, contextual
 *   ├──────────────────────┤
 *   │ 🏠 📝 ✓ 📅 ⋯       │  ← MobileBottomNav (56 px + safe-area-bottom)
 *   └──────────────────────┘
 *
 * The shell does NOT touch page content. Pages publish their title / FAB /
 * actions through the `useMobileTitle`, `useMobileFab`, `useMobileHeaderActions`
 * hooks (defined in `shell-chrome-context.tsx`).
 */
export const MobileShell = memo(function MobileShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [connectVaultOpen, setConnectVaultOpen] = useState(false);
  const { columnEditor, closeColumnEditor, entityPeek, closeEntityPeek } = useShellChrome();

  // Focus mode: while the keyboard is up and the note editor is focused, drop
  // ALL chrome (header, FAB, bottom nav) so only the note content shows. The
  // hook stays false for plain inputs (e.g. search), so opening the keyboard
  // there keeps the chrome — including the search field itself.
  const keyboardFocus = useKeyboardOpen();

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden"
      style={{ backgroundColor: "var(--surface-0)" }}
    >
      {/* Keyboard focus mode retracts the chrome. Rather than snapping the
          bars out (unmount), glide them: the top bar slides up + fades, the
          bottom nav slides down + fades, the FAB just fades. transform/opacity
          only → compositor-friendly, idle = 0 frames. We keep the nodes
          mounted (so the transition can run) but pull them out of the flex
          flow once hidden so `main` reclaims the full height, and kill their
          pointer events so the retracted chrome stays inert. */}
      <div
        className="sn-motion-glide shrink-0"
        aria-hidden={keyboardFocus}
        style={{
          transform: keyboardFocus ? "translateY(-100%)" : "translateY(0)",
          opacity: keyboardFocus ? 0 : 1,
          pointerEvents: keyboardFocus ? "none" : undefined,
          // Collapse out of flow when retracted so the editor gets full height.
          marginTop: keyboardFocus ? "calc(-48px - env(safe-area-inset-top, 0px))" : 0,
        }}
      >
        <MobileTopBar />
      </div>

      <main
        className="relative flex-1 overflow-y-auto"
        style={{
          backgroundColor: "var(--surface-0)",
          // Le FAB dépasse de 20px AU-DESSUS de la barre de navigation (il est
          // ancré à `20px + safe-area` du bas, pour 56px de haut, et la nav en
          // fait 56). Ces 20px se superposaient donc au bas de `main` : sur une
          // rangée pleine largeur — le « Nouveau dossier » en pied d'arbre — le
          // centre de la ligne appartenait au FAB, et deux actions « créer »
          // différentes se disputaient le même pixel. On réserve exactement sa
          // saillie : rien dans `main` ne passe plus sous le FAB.
          paddingBottom: 20,
        }}
      >
        {children}
      </main>

      {/* FAB fade — opacity ONLY. The FAB is `position: absolute` anchored to
          this shell's `.relative` root; a non-`none` `transform` on this
          wrapper would become its containing block and break the `bottom:`
          anchoring, so we never set `transform` here (we only ever toggle
          `opacity`). `.sn-motion-glide` is reduced-motion-safe; its declared
          transform-transition is inert because transform stays unset. */}
      <div
        className="sn-motion-glide"
        aria-hidden={keyboardFocus}
        style={{
          opacity: keyboardFocus ? 0 : 1,
          pointerEvents: keyboardFocus ? "none" : undefined,
        }}
      >
        <MobileFab />
      </div>

      <div
        className="sn-motion-glide shrink-0"
        aria-hidden={keyboardFocus}
        style={{
          transform: keyboardFocus ? "translateY(100%)" : "translateY(0)",
          opacity: keyboardFocus ? 0 : 1,
          pointerEvents: keyboardFocus ? "none" : undefined,
          // Collapse out of flow when retracted so the editor gets full height.
          marginBottom: keyboardFocus
            ? "calc(-56px - env(safe-area-inset-bottom, 0px))"
            : 0,
        }}
      >
        <MobileBottomNav onOpenMore={() => setMoreOpen(true)} />
      </div>

      <MoreDrawer
        isOpen={moreOpen}
        onClose={() => setMoreOpen(false)}
        onOpenNotifications={() => setNotifOpen(true)}
        onOpenConnectVault={() => setConnectVaultOpen(true)}
      />

      {notifOpen && (
        <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
      )}

      {/* Connecter un vault — hissé au niveau du shell (et non imbriqué dans la
          Drawer « Plus ») : deux overlays react-aria empilés se disputent le
          scroll-lock + focus-scope `contain` sur mobile, ce qui superposait la
          modale au menu et cassait la soumission. Comme le centre de notifs, on
          ferme la Drawer puis on ouvre cette modale comme seul overlay. */}
      <ConnectVaultModal isOpen={connectVaultOpen} onOpenChange={setConnectVaultOpen} />

      {/* Column editor — on desktop this is a third shell column; on mobile we
          surface it as a right-anchored sliding overlay so editing a Base's
          columns is reachable instead of silently no-op'ing. */}
      {columnEditor && (
        <div className="fixed inset-0 z-[var(--z-modal,400)] flex">
          <button
            type="button"
            aria-label="Fermer l'éditeur de colonnes"
            onClick={closeColumnEditor}
            className="flex-1"
            style={{ backgroundColor: "color-mix(in srgb, var(--surface-0) 60%, transparent)" }}
          />
          <div
            className="h-full w-full max-w-[380px] sn-col-editor-enter"
            style={{
              paddingTop: "env(safe-area-inset-top, 0px)",
              backgroundColor: "var(--surface-1)",
            }}
          >
            <ColumnEditorSidebar
              base={columnEditor.base}
              view={columnEditor.view}
              focusFieldId={columnEditor.focusFieldId}
              prefillFormula={columnEditor.prefillFormula}
            />
          </div>
        </div>
      )}

      {/* Fiche d'entité en side-peek — sur mobile, overlay plein écran ancré à
          droite (même traitement que le column editor ci-dessus). */}
      {entityPeek && (
        <div className="fixed inset-0 z-[var(--z-modal,400)] flex">
          <button
            type="button"
            aria-label="Fermer la fiche"
            onClick={closeEntityPeek}
            className="flex-1"
            style={{ backgroundColor: "color-mix(in srgb, var(--surface-0) 60%, transparent)" }}
          />
          <div
            className="h-full w-full max-w-[380px] sn-col-editor-enter"
            style={{
              paddingTop: "env(safe-area-inset-top, 0px)",
              backgroundColor: "var(--surface-1)",
            }}
          >
            <EntityPeekPanel baseId={entityPeek.baseId} entityId={entityPeek.entityId} />
          </div>
        </div>
      )}
    </div>
  );
});
