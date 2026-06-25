"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowSquareOut, Plus, X, Tag, MagnifyingGlass, Check } from "@phosphor-icons/react";
import { Button, Input } from "@heroui/react";
import { useToast } from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import {
  listLabels,
  resolveUserLabels,
  addThreadLabel,
  removeThreadLabel,
  classifyBubble,
  type EmailThread,
  type EmailMessage,
  type GmailLabel,
  type BubbleKind,
} from "@/lib/gmail";
import { parseEmailBody } from "@/lib/email-quote";

/**
 * Affichage d'un thread Gmail façon messagerie (chat) : mes messages alignés à
 * droite, ceux du correspondant à gauche. Corps en TEXTE BRUT (jamais de HTML —
 * pas de sanitizer, anti-XSS). Citation et signature retirées du corps mais
 * dépliables.
 *
 * En-tête : les labels utilisateur du thread sont affichés en badges supprimables
 * (X → retire le label) ; un bouton « + Label » (ou la touche `l` au clavier)
 * ouvre un sélecteur filtrable (tape, flèches, Entrée). Mutations via le scope
 * `gmail.modify` (consentement incrémental), avec mise à jour optimiste + rollback.
 *
 * `selfEmail` : adresse du compte connecté → détermine quels messages sont « moi »
 * (alignés à droite, violet). Les correspondants du MÊME domaine que le compte
 * connecté (collègues « internes ») reçoivent une teinte cool distincte ; les
 * externes gardent la teinte neutre. Absent → tout traité comme externe à gauche.
 * `enableShortcuts` : active le raccourci clavier global `l` (défaut true). Mis à
 * false dans l'embed note (`GmailMessageView`) pour ne pas capturer `l` dans
 * l'éditeur.
 */
export function EmailThreadView({
  thread,
  selfEmail,
  enableShortcuts = true,
}: {
  thread: EmailThread;
  selfEmail?: string;
  enableShortcuts?: boolean;
}) {
  const { settings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();
  const { toast } = useToast();

  const [allLabels, setAllLabels] = useState<GmailLabel[]>([]);
  // État optimiste des labels du thread (resynchronisé à chaque thread chargé).
  const [labelIds, setLabelIds] = useState<string[]>(thread.labelIds);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setLabelIds(thread.labelIds);
  }, [thread]);

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    listLabels(clientId)
      .then((ls) => {
        if (!cancelled) setAllLabels(ls);
      })
      .catch(() => {
        /* labels indisponibles → pas de badges, non bloquant */
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const current = useMemo(() => resolveUserLabels(labelIds, allLabels), [labelIds, allLabels]);
  const addable = useMemo(
    () => allLabels.filter((l) => !labelIds.includes(l.id)),
    [allLabels, labelIds],
  );

  const openPicker = () => {
    if (triggerRef.current) setAnchorRect(triggerRef.current.getBoundingClientRect());
    setPickerOpen(true);
  };

  // Raccourci clavier global `l` → ouvre le sélecteur (sauf focus dans un champ).
  useEffect(() => {
    if (!enableShortcuts || !clientId) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "l" && e.key !== "L") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (triggerRef.current) setAnchorRect(triggerRef.current.getBoundingClientRect());
      setPickerOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enableShortcuts, clientId]);

  const mutate = async (labelId: string, action: "add" | "remove") => {
    if (!clientId) return;
    const prev = labelIds;
    setLabelIds(action === "add" ? [...labelIds, labelId] : labelIds.filter((id) => id !== labelId));
    try {
      if (action === "add") await addThreadLabel(clientId, thread.id, labelId);
      else await removeThreadLabel(clientId, thread.id, labelId);
    } catch (err) {
      setLabelIds(prev);
      toast({
        title: action === "add" ? "Ajout du label échoué" : "Retrait du label échoué",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  if (!thread.messages.length) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Thread vide.
      </p>
    );
  }
  const subject = thread.messages[0]?.subject;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {subject && (
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {subject}
          </h2>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {current.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
            >
              <Tag size={10} />
              <span className="max-w-[12rem] truncate">{l.name}</span>
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                onPress={() => void mutate(l.id, "remove")}
                aria-label={`Retirer le label ${l.name}`}
                className="ml-0.5 h-auto min-h-0 min-w-0 p-0 hover:opacity-70"
              >
                <X size={10} />
              </Button>
            </span>
          ))}
          <Button
            ref={triggerRef}
            variant="ghost"
            size="sm"
            onPress={openPicker}
            aria-label="Ajouter un label (touche l)"
            className="flex h-auto items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ border: "1px dashed var(--border)", color: "var(--text-muted)" }}
          >
            <Plus size={10} weight="bold" /> Label
          </Button>
        </div>
      </div>

      {thread.messages.map((m) => (
        <MessageBubble key={m.id} message={m} kind={classifyBubble(m.from.email, selfEmail)} />
      ))}

      <LabelPicker
        open={pickerOpen}
        anchorRect={anchorRect}
        labels={addable}
        onPick={(id) => void mutate(id, "add")}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

/**
 * Sélecteur de label ancré (position fixe, même esprit que TagSelector) avec
 * navigation 100 % clavier : recherche au focus, flèches ↑/↓, Entrée applique,
 * Échap ferme. Clic-extérieur ferme aussi.
 */
function LabelPicker({
  open,
  anchorRect,
  labels,
  onPick,
  onClose,
}: {
  open: boolean;
  anchorRect: DOMRect | null;
  labels: GmailLabel[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const id = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...labels].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((l) => l.name.toLowerCase().includes(q)) : sorted;
  }, [labels, query]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open || !anchorRect) return null;

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = filtered[active];
      if (sel) {
        onPick(sel.id);
        onClose();
      }
    }
  };

  const POP_W = 240;
  const POP_H = 300;
  const margin = 6;
  let left = anchorRect.left;
  let top = anchorRect.bottom + margin;
  if (left + POP_W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - POP_W - 8);
  if (top + POP_H > window.innerHeight - 8) top = Math.max(8, anchorRect.top - POP_H - margin);

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Ajouter un label"
      className="fixed z-50 flex flex-col rounded-lg shadow-xl"
      style={{
        left,
        top,
        width: POP_W,
        maxHeight: POP_H,
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center gap-1.5 border-b px-2 py-1.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <MagnifyingGlass size={12} style={{ color: "var(--text-muted)" }} />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Filtrer les labels…"
          className="flex-1 bg-transparent text-xs outline-none"
          style={{ color: "var(--text-primary)" }}
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <p className="px-3 py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {labels.length === 0 ? "Tous les labels sont appliqués." : "Aucun résultat."}
          </p>
        )}
        {filtered.map((l, i) => (
          <Button
            key={l.id}
            variant="ghost"
            onPress={() => {
              onPick(l.id);
              onClose();
            }}
            className="flex h-auto w-full items-center gap-1.5 px-2 py-1 text-left text-xs"
            style={{
              backgroundColor: i === active ? "var(--surface-2)" : "transparent",
              color: "var(--text-secondary)",
            }}
          >
            <Tag size={11} style={{ color: "var(--text-muted)" }} />
            <span className="flex-1 truncate">{l.name}</span>
            {i === active && <Check size={11} style={{ color: "var(--accent)" }} />}
          </Button>
        ))}
      </div>
    </div>
  );
}

// Teinte « interne » (collègue même domaine) : dérivée du token sémantique
// existant `--success` (oklch cool, hue ~150) via color-mix → fill subtil sans
// toucher globals.css. Tranche avec « moi » (violet `--accent-subtle`) et
// « externe » (`--surface-1`). NB : `--success` n'est pas redéfini par thème →
// teinte stable ; tokeniser un `--internal` dédié si on veut une vraie variante
// par thème plus tard.
const INTERNAL_BG = "color-mix(in oklch, var(--success) 14%, transparent)";
const INTERNAL_BORDER = "color-mix(in oklch, var(--success) 35%, transparent)";
const INTERNAL_ACCENT = "var(--success)";

function MessageBubble({ message, kind }: { message: EmailMessage; kind: BubbleKind }) {
  const mine = kind === "mine";
  const internal = kind === "internal";
  const date = message.date ? new Date(message.date).toLocaleString() : "";
  const { body, quoted, signature } = parseEmailBody(message.bodyText || message.snippet);
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[85%] rounded-2xl border px-3.5 py-2.5"
        style={{
          backgroundColor: mine ? "var(--accent-subtle)" : internal ? INTERNAL_BG : "var(--surface-1)",
          borderColor: internal ? INTERNAL_BORDER : "var(--border-subtle)",
        }}
      >
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <span
            className="flex min-w-0 items-center gap-1.5 text-xs font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            {internal && (
              <span
                title="Collègue interne"
                aria-label="Collègue interne"
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: INTERNAL_ACCENT }}
              />
            )}
            <span className="truncate">{mine ? "Moi" : message.from.name || message.from.email}</span>
          </span>
          <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
            {date}
          </span>
        </div>

        {body && (
          <p className="whitespace-pre-wrap break-words text-sm" style={{ color: "var(--text-secondary)" }}>
            {body}
          </p>
        )}
        {!body && !quoted && !signature && (
          <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
            (message vide)
          </p>
        )}

        {signature && (
          <CollapsibleBlock openLabel="··· Afficher la signature" closeLabel="Masquer la signature" text={signature} />
        )}
        {quoted && (
          <CollapsibleBlock openLabel="··· Afficher la citation" closeLabel="Masquer la citation" text={quoted} />
        )}

        {message.webLink && (
          <a
            href={message.webLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs"
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            Ouvrir dans Gmail <ArrowSquareOut size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Bloc repliable (citation / signature). Bouton natif inline — composant
 * présentational self-contained, même esprit que le lien Gmail.
 */
function CollapsibleBlock({
  openLabel,
  closeLabel,
  text,
}: {
  openLabel: string;
  closeLabel: string;
  text: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs"
        style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {open ? closeLabel : openLabel}
      </button>
      {open && (
        <p
          className="mt-1 whitespace-pre-wrap break-words border-l pl-2 text-sm"
          style={{ color: "var(--text-muted)", borderColor: "var(--border-subtle)" }}
        >
          {text}
        </p>
      )}
    </div>
  );
}
