"use client";

/**
 * MailShortcutsHelp — feuille d'aide des raccourcis mail (touche `?`).
 *
 * Le contenu est GÉNÉRÉ depuis `MAIL_SHORTCUTS` : aucun raccourci ne peut
 * exister sans apparaître ici. Deux colonnes sur desktop, une sur mobile.
 */

import { Modal, Kbd } from "@supernote/ui";
import {
  MAIL_SHORTCUT_GROUPS,
  shortcutsByGroup,
  type MailBinding,
} from "@/lib/mail-shortcuts";

/** Découpe « g puis i » / « j / ↓ » en jetons rendus en <Kbd>, séparateurs à part. */
function renderKeys(binding: MailBinding) {
  const parts = binding.display.split(/(\s\/\s|\spuis\s)/);
  return parts.map((p, i) => {
    if (p === " / ") {
      return (
        <span key={i} className="px-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
          ou
        </span>
      );
    }
    if (p === " puis ") {
      return (
        <span key={i} className="px-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
          puis
        </span>
      );
    }
    return <Kbd key={i}>{p}</Kbd>;
  });
}

export function MailShortcutsHelp({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Raccourcis clavier"
      size="xl"
    >
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {MAIL_SHORTCUT_GROUPS.map((group) => {
          const items = shortcutsByGroup(group);
          if (items.length === 0) return null;
          return (
            <section key={group} className="min-w-0">
              <h3
                className="mb-2 text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                {group}
              </h3>
              <ul className="flex flex-col gap-1">
                {items.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-0.5">
                    <span className="min-w-0 truncate text-sm" style={{ color: "var(--text-secondary)" }}>
                      {b.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">{renderKeys(b)}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="mt-5 text-xs" style={{ color: "var(--text-muted)" }}>
        Les raccourcis sont inactifs quand le curseur est dans un champ de saisie.
        Dans le composeur, <Kbd>⌘</Kbd>/<Kbd>Ctrl</Kbd>+<Kbd>↵</Kbd> envoie.
      </p>
    </Modal>
  );
}
