"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, LockSimple, Trash } from "@phosphor-icons/react";
import { Badge, Button, Input, Modal, Switch, Tooltip } from "@supernote/ui";
import { MobileSheet } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";
import { useConfirm } from "@/lib/confirm";
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  shareUrl,
  ShareGoneError,
  type OwnedShare,
  type ShareLink,
} from "@/lib/share/shareApi";
import type { ShareKind, ShareMode } from "@/lib/share/types";

const HOUR = 3_600_000;
const DURATIONS: { id: string; label: string; ms: number | null }[] = [
  { id: "none", label: "Sans limite", ms: null },
  { id: "1h", label: "1 h", ms: HOUR },
  { id: "24h", label: "24 h", ms: 24 * HOUR },
  { id: "7d", label: "7 j", ms: 7 * 24 * HOUR },
  { id: "30d", label: "30 j", ms: 30 * 24 * HOUR },
  { id: "date", label: "Date…", ms: null },
];

const MAX_PASSWORD_LENGTH = 200;

const whenFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

function expiryText(link: ShareLink): string {
  if (link.expiresAt == null) return "Sans limite";
  return link.expiresAt <= Date.now() ? "Expiré" : `Jusqu'au ${whenFmt.format(link.expiresAt)}`;
}

function toLocalDateTimeInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function LinkRow({ link, onRevoke }: { link: ShareLink; onRevoke: () => Promise<void> }) {
  const copyFb = useActionFeedback();
  const revokeFb = useActionFeedback();
  const url = shareUrl(link.slug);
  return (
    <li className="flex items-center gap-2 border-b border-[var(--border-subtle)] py-2 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <Badge variant={link.mode === "write" ? "warning" : "default"}>{link.mode === "write" ? "Écriture" : "Lecture"}</Badge>
          {link.hasPassword && <LockSimple size={14} aria-label="Protégé par mot de passe" />}
          <span className="text-[var(--text-muted)]">{expiryText(link)}</span>
          {link.label && <span className="truncate">· {link.label}</span>}
        </div>
        <span data-testid="share-link-url" className="truncate font-mono text-xs text-[var(--text-muted)]">{url}</span>
      </div>
      <Tooltip content={copyFb.state === "success" ? "Copié" : (copyFb.error ?? "Copier le lien")}>
        <Button variant="ghost" size="icon" aria-label="Copier le lien" className="h-9 w-9" onPress={() => void copyFb.run(() => navigator.clipboard.writeText(url))}>
          <FeedbackIcon state={copyFb.state} error={copyFb.error} idle={<Copy size={16} />} />
        </Button>
      </Tooltip>
      <Tooltip content={revokeFb.error ?? "Retirer ce lien"}>
        <Button variant="ghost" size="icon" aria-label="Retirer ce lien" className="h-9 w-9" onPress={() => void revokeFb.run(onRevoke)}>
          <FeedbackIcon state={revokeFb.state} error={revokeFb.error} idle={<Trash size={16} />} />
        </Button>
      </Tooltip>
    </li>
  );
}

export interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  kind: ShareKind;
  title: string;
  owned: OwnedShare | null;
  onStart: () => Promise<OwnedShare>;
  onStop: () => Promise<void>;
  onGone: () => void;
  /** Avertissement propre au type de ressource (ex. clé stockée dans la note). */
  note?: string;
}

export function ShareDialog({ isOpen, onClose, kind, title, owned, onStart, onStop, onGone, note }: ShareDialogProps) {
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [mode, setMode] = useState<ShareMode>("read");
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState("");
  const [duration, setDuration] = useState("none");
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const createFb = useActionFeedback();
  const stopFb = useActionFeedback();

  const guard = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ShareGoneError) onGone();
        throw err;
      }
    },
    [onGone],
  );

  useEffect(() => {
    if (!isOpen || !owned) return setLinks([]);
    void guard(() => listShareLinks(owned)).then(setLinks, () => setLinks([]));
  }, [isOpen, owned, guard]);

  const expiresAt = (): number | null => {
    if (duration === "date") return date ? new Date(date).getTime() : null;
    const ms = DURATIONS.find((d) => d.id === duration)?.ms;
    return ms == null ? null : Date.now() + ms;
  };

  const create = () =>
    createFb.run(async () => {
      const share = owned ?? (await onStart());
      const link = await guard(() =>
        createShareLink(share, {
          mode: kind === "email" ? "read" : mode,
          password: protect ? password : undefined,
          expiresAt: expiresAt(),
          label: label.trim() || undefined,
        }),
      );
      setLinks((prev) => [...prev, link]);
      setPassword("");
      setLabel("");
    });

  const stop = async () => {
    const ok = await confirm({
      title: "Arrêter le partage ?",
      body: "Tous les liens cessent de fonctionner et les personnes connectées sont déconnectées.",
      confirmLabel: "Arrêter le partage",
      variant: "danger",
    });
    if (ok) await stopFb.run(onStop);
  };

  const active = links.filter((l) => !l.revokedAt);
  const passwordValid = !protect || (password.length >= 6 && password.length <= MAX_PASSWORD_LENGTH);
  const dateValid = duration !== "date" || (date !== "" && new Date(date).getTime() > Date.now());
  const canCreate = passwordValid && dateValid;

  const body = (
    <div className="flex flex-col gap-5">
      {active.length > 0 && (
        <ul className="flex flex-col">
          {active.map((link) => (
            <LinkRow
              key={link.slug}
              link={link}
              onRevoke={async () => {
                await guard(() => revokeShareLink(owned!, link.slug));
                setLinks((prev) => prev.filter((l) => l.slug !== link.slug));
              }}
            />
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-3" aria-label="Nouveau lien">
        <h3 className="text-sm font-semibold">Nouveau lien</h3>
        {kind === "note" && (
          <div className="flex gap-1" role="group" aria-label="Droits">
            {(["read", "write"] as const).map((m) => (
              <Button key={m} size="sm" variant={mode === m ? "primary" : "ghost"} aria-pressed={mode === m} onPress={() => setMode(m)}>
                {m === "read" ? "Lecture" : "Écriture"}
              </Button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="share-protect" className="text-sm">Protéger par mot de passe</label>
          <Switch id="share-protect" isSelected={protect} onChange={setProtect} aria-label="Protéger par mot de passe" />
        </div>
        {protect && (
          <Input
            type="password"
            aria-label="Mot de passe du lien"
            placeholder="6 caractères minimum"
            value={password}
            maxLength={MAX_PASSWORD_LENGTH}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <div className="flex flex-wrap gap-1" role="group" aria-label="Durée">
          {DURATIONS.map((d) => (
            <Button key={d.id} size="sm" variant={duration === d.id ? "primary" : "ghost"} aria-pressed={duration === d.id} onPress={() => setDuration(d.id)}>
              {d.label}
            </Button>
          ))}
        </div>
        {duration === "date" && (
          <Input
            type="datetime-local"
            aria-label="Date d'expiration"
            value={date}
            min={toLocalDateTimeInput(Date.now())}
            onChange={(e) => setDate(e.target.value)}
          />
        )}
        <Input aria-label="Libellé (facultatif)" placeholder="Libellé, ex. pour Paul" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
        <Button variant="primary" isDisabled={!canCreate || createFb.isPending} onPress={() => void create()}>
          <FeedbackIcon state={createFb.state} error={createFb.error} idle={null} />
          Créer le lien
        </Button>
        {createFb.error && <p role="alert" className="text-sm text-[var(--color-danger)]">{createFb.error}</p>}
      </section>

      {note && <p className="text-xs text-[var(--text-muted)]">{note}</p>}

      {owned && (
        <Tooltip content={stopFb.error ?? "Arrêter le partage"}>
          <Button variant="ghost" className="self-start text-[var(--color-danger)]" onPress={() => void stop()}>
            <FeedbackIcon state={stopFb.state} error={stopFb.error} idle={null} />
            Arrêter le partage
          </Button>
        </Tooltip>
      )}
    </div>
  );

  const heading = `Partager « ${title || (kind === "note" ? "Sans titre" : "(sans objet)")} »`;
  if (isMobile) {
    return (
      <MobileSheet isOpen={isOpen} onClose={onClose} title={heading} size="lg">
        <div className="px-4 pb-6">{body}</div>
      </MobileSheet>
    );
  }
  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} title={heading} size="md">
      {body}
    </Modal>
  );
}
