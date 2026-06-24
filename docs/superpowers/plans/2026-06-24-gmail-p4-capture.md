# Gmail — Phase 4 (Capture email → entité) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Transformer un email Gmail en entité depuis le reader `/mail` : (P4a) en **note** markdown (sujet→titre, corps+métadonnées→body) ; (P4b) en **ligne d'une base** existante via une UI de mapping de champs (valeurs email → colonnes de la base).

**Architecture:** Tout via `trpc.entities.create` (worker entités). Fields keyés par **name**. Réutilise P1 (`EmailMessage`, le thread chargé sur `/mail`). Helpers de transformation purs (testés) dans `lib/mail-capture.ts`. P4a = hook + bouton. P4b = modal (liste des bases non-Coda via `schemas.list`, mapping auto + manuel, création de ligne). Capture porte sur **un message représentatif** du thread (le premier = origine du fil).

**Tech Stack:** tRPC (`entities.create`, `schemas.list`), HeroUI v3 (`Modal`, `Button`, `Select`/`Listbox`), `useToast`, vitest. Réutilise `useGmailConnected`.

**Prérequis :** P1-P3 sur `feat/gmail-p1`. On continue dessus.

**Livraison :** P4a (note) d'abord → **checkpoint** → P4b (base). Chaque sous-partie testée + revue avant la suite.

---

## File Structure

- Create `apps/web/src/lib/mail-capture.ts` — helpers purs : `emailToMarkdown`, `EmailFieldSource`, `emailSourceValue`, `autoMapBaseFields`.
- Create `apps/web/src/lib/mail-capture.test.ts` — tests des helpers.
- Create `apps/web/src/components/mail/useCaptureEmail.ts` — hook : `captureToNote(msg)`, `captureToBase(typeId, fields)`.
- Create `apps/web/src/components/mail/CaptureEmailModal.tsx` — modal « Capturer » (note + base + mapping).
- Modify `apps/web/src/app/mail/page.tsx` — bouton « Capturer » sur le reader → ouvre la modal.

---

## Task 1 (P4a) : helpers purs de transformation

**Files:** Create `apps/web/src/lib/mail-capture.ts`, `apps/web/src/lib/mail-capture.test.ts`

- [ ] **Step 1: Tests qui échouent** — `mail-capture.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { emailToMarkdown, emailSourceValue, autoMapBaseFields } from "./mail-capture";
import type { EmailMessage } from "@/lib/gmail";

const msg: EmailMessage = {
  id: "m1",
  threadId: "t1",
  subject: "Compte rendu réunion",
  from: { name: "Ada Lovelace", email: "ada@calc.io" },
  to: [{ name: "Bob", email: "bob@x.io" }],
  date: "2026-06-23T08:00:00.000Z",
  snippet: "Voici le compte rendu…",
  bodyText: "Bonjour,\n\nVoici le compte rendu.\n\nAda",
  webLink: "https://mail.google.com/mail/u/0/#all/m1",
};

describe("emailToMarkdown", () => {
  it("compose un corps avec en-tête De/Date + corps", () => {
    const md = emailToMarkdown(msg);
    expect(md).toContain("**De :** Ada Lovelace <ada@calc.io>");
    expect(md).toContain("Voici le compte rendu.");
    expect(md).toContain("[Ouvrir dans Gmail]");
  });
});

describe("emailSourceValue", () => {
  it("résout chaque source", () => {
    expect(emailSourceValue(msg, "subject")).toBe("Compte rendu réunion");
    expect(emailSourceValue(msg, "fromName")).toBe("Ada Lovelace");
    expect(emailSourceValue(msg, "fromEmail")).toBe("ada@calc.io");
    expect(emailSourceValue(msg, "date")).toBe("2026-06-23T08:00:00.000Z");
    expect(emailSourceValue(msg, "snippet")).toBe("Voici le compte rendu…");
    expect(emailSourceValue(msg, "body")).toContain("Bonjour");
  });
});

describe("autoMapBaseFields", () => {
  it("auto-mappe par nom/type (titre→subject, email→fromEmail, date→date)", () => {
    const fields = [
      { name: "title", label: "Titre", type: "text" },
      { name: "email", label: "Email", type: "email" },
      { name: "received", label: "Reçu le", type: "date" },
      { name: "priority", label: "Priorité", type: "select" },
    ];
    const map = autoMapBaseFields(fields);
    expect(map.title).toBe("subject");
    expect(map.email).toBe("fromEmail");
    expect(map.received).toBe("date");
    expect(map.priority).toBe(""); // select non auto-mappable
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter web test -- mail-capture` → FAIL.

- [ ] **Step 3: Implémenter `mail-capture.ts`** :

```ts
import type { EmailMessage } from "@/lib/gmail";

/** Sources de valeur extractibles d'un email pour le mapping de capture. */
export type EmailFieldSource = "subject" | "fromName" | "fromEmail" | "date" | "snippet" | "body";

/** Libellés UI des sources email. */
export const EMAIL_FIELD_SOURCE_LABELS: Record<EmailFieldSource, string> = {
  subject: "Sujet",
  fromName: "Expéditeur (nom)",
  fromEmail: "Expéditeur (email)",
  date: "Date",
  snippet: "Extrait",
  body: "Corps",
};

/** Valeur (string) d'une source email donnée. Date = ISO. */
export function emailSourceValue(msg: EmailMessage, src: EmailFieldSource): string {
  switch (src) {
    case "subject": return msg.subject;
    case "fromName": return msg.from.name;
    case "fromEmail": return msg.from.email;
    case "date": return msg.date;
    case "snippet": return msg.snippet;
    case "body": return msg.bodyText;
  }
}

/** Compose le corps markdown d'une note de capture (en-tête + corps + lien). */
export function emailToMarkdown(msg: EmailMessage): string {
  const date = msg.date ? new Date(msg.date).toLocaleString() : "";
  const lines = [
    `**De :** ${msg.from.name}${msg.from.email ? ` <${msg.from.email}>` : ""}`,
    date ? `**Date :** ${date}` : "",
    msg.subject ? `**Sujet :** ${msg.subject}` : "",
    "",
    msg.bodyText || msg.snippet,
    "",
    `[Ouvrir dans Gmail](${msg.webLink})`,
  ];
  return lines.filter((l) => l !== "").join("\n\n");
}

interface MappableField {
  name: string;
  label: string;
  type: string;
}

/**
 * Auto-mappe les champs d'une base vers des sources email par heuristique
 * (nom + type). Champs non text/date/email → non mappés (""). L'utilisateur
 * ajuste ensuite.
 */
export function autoMapBaseFields(fields: MappableField[]): Record<string, EmailFieldSource | ""> {
  const map: Record<string, EmailFieldSource | ""> = {};
  for (const f of fields) {
    const n = `${f.name} ${f.label}`.toLowerCase();
    const t = f.type;
    let src: EmailFieldSource | "" = "";
    if (t === "email") src = "fromEmail";
    else if (t === "date" || t === "datetime") src = "date";
    else if (t === "text" || t === "longtext" || t === "markdown") {
      if (/titre|title|sujet|subject|name|nom/.test(n)) src = "subject";
      else if (/expéd|from|exp\b|sender/.test(n)) src = "fromName";
      else if (/mail/.test(n)) src = "fromEmail";
      else if (/corps|body|contenu|content|message|note/.test(n)) src = "body";
      else if (/extrait|snippet|résumé|apercu|aperçu/.test(n)) src = "snippet";
    }
    map[f.name] = src;
  }
  return map;
}
```

- [ ] **Step 4: Vérifier le succès** — `pnpm --filter web test -- mail-capture` → PASS.
- [ ] **Step 5: Typecheck** — `pnpm --filter web typecheck` → clean.
- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/mail-capture.ts apps/web/src/lib/mail-capture.test.ts
git commit -m "feat(mail): helpers purs de capture (emailToMarkdown, sources, auto-mapping)"
```

---

## Task 2 (P4a) : hook capture + bouton « Capturer en note »

**Files:**
- Create `apps/web/src/components/mail/useCaptureEmail.ts`
- Modify `apps/web/src/app/mail/page.tsx`

- [ ] **Step 1: Hook `useCaptureEmail`** :

```ts
import { useCallback } from "react";
import { trpc } from "@/lib/trpc/client";
import { noteFilePath } from "@/components/notes/hooks";
import { emailToMarkdown } from "@/lib/mail-capture";
import type { EmailMessage } from "@/lib/gmail";

/**
 * Capture un email en entité. captureToNote crée une note (Inbox) ; captureToBase
 * crée une ligne dans une base existante (fields keyés par name). Réutilise
 * trpc.entities.create (worker).
 */
export function useCaptureEmail() {
  const utils = trpc.useUtils();
  const create = trpc.entities.create.useMutation({
    onSuccess: () => {
      void utils.entities.invalidate();
    },
  });

  const captureToNote = useCallback(
    async (msg: EmailMessage): Promise<string> => {
      const title = msg.subject || "Email sans sujet";
      const filePath = noteFilePath("Inbox", title);
      const entity = await create.mutateAsync({
        typeId: "note",
        fields: { title, filePath },
        body: emailToMarkdown(msg),
        tags: [],
      });
      return (entity as { id: string }).id;
    },
    [create],
  );

  const captureToBase = useCallback(
    async (typeId: string, fields: Record<string, unknown>): Promise<string> => {
      const entity = await create.mutateAsync({ typeId, fields, body: "" });
      return (entity as { id: string }).id;
    },
    [create],
  );

  return { captureToNote, captureToBase };
}
```

> Vérifier que `noteFilePath` est exporté depuis `@/components/notes/hooks` ; sinon l'exporter là-bas (petit export) ou réimplémenter le chemin (`Inbox/<slug>.md`). Vérifier la forme réelle de `trpc.entities.create` (input `{ typeId, fields, body, tags? }`).

- [ ] **Step 2: Bouton « Capturer en note » sur le reader `/mail`** — dans `mail/page.tsx`, au-dessus de `EmailThreadView` (quand un thread est chargé), ajouter une barre d'actions avec un `Button` (HeroUI v3) :

```tsx
  const { captureToNote } = useCaptureEmail();
  const { toast } = useToast();
  const navigate = useNavigate(); // déjà présent

  const handleCaptureNote = async () => {
    const msg = thread?.messages[0];
    if (!msg) return;
    try {
      const id = await captureToNote(msg);
      toast({ title: "Note créée depuis l'email", description: "Dans Inbox." });
      navigate(`/notes/${id}`);
    } catch (err) {
      toast({ title: "Échec de la capture", description: err instanceof Error ? err.message : String(err), variant: "danger" });
    }
  };
```

Et dans le JSX du reader (au-dessus de `<EmailThreadView thread={thread} />`) :

```tsx
        {thread && (
          <div className="mb-3 flex gap-2">
            <Button variant="ghost" size="sm" onPress={() => void handleCaptureNote()}>
              <FilePlus size={16} /> Capturer en note
            </Button>
          </div>
        )}
```

(Importer `Button` de `@heroui/react`, `useToast` de `@supernote/ui`, `FilePlus` de `@phosphor-icons/react`.)

- [ ] **Step 3: Typecheck + tests** — `pnpm --filter web typecheck` clean ; `pnpm --filter web test` vert.
- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/mail/useCaptureEmail.ts apps/web/src/app/mail/page.tsx
git commit -m "feat(mail): capturer un email en note (P4a)"
```

---

## ⛳ CHECKPOINT P4a → P4b

Après Task 2 : capture→note livrée et vérifiée. Reprendre P4b (capture→base) ci-dessous.

---

## Task 3 (P4b) : `CaptureEmailModal` (liste bases + mapping + création ligne)

**Files:** Create `apps/web/src/components/mail/CaptureEmailModal.tsx`

Modal ouverte depuis le reader. Étapes internes : choix base → mapping champ→source → créer.

- [ ] **Step 1: Créer le composant**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Modal, Button } from "@heroui/react";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@supernote/ui";
import { isCodaBase } from "@/components/bases/hooks";
import {
  EMAIL_FIELD_SOURCE_LABELS,
  emailSourceValue,
  autoMapBaseFields,
  type EmailFieldSource,
} from "@/lib/mail-capture";
import { useCaptureEmail } from "./useCaptureEmail";
import type { EmailMessage } from "@/lib/gmail";

const SOURCE_OPTIONS: Array<{ value: EmailFieldSource | ""; label: string }> = [
  { value: "", label: "— (ignorer)" },
  ...(Object.keys(EMAIL_FIELD_SOURCE_LABELS) as EmailFieldSource[]).map((s) => ({
    value: s,
    label: EMAIL_FIELD_SOURCE_LABELS[s],
  })),
];

export function CaptureEmailModal({
  isOpen,
  message,
  onClose,
}: {
  isOpen: boolean;
  message: EmailMessage | null;
  onClose: () => void;
}) {
  const { data: bases } = trpc.schemas.list.useQuery({ search: undefined }, { enabled: isOpen });
  const { captureToBase } = useCaptureEmail();
  const { toast } = useToast();
  const [typeId, setTypeId] = useState<string>("");
  const [mapping, setMapping] = useState<Record<string, EmailFieldSource | "">>({});
  const [busy, setBusy] = useState(false);

  // Cibles = bases non-Coda, non-système, hors "note".
  const targets = useMemo(
    () => (bases ?? []).filter((b) => b.id !== "note" && !b.isSystem && !isCodaBase(b.id)),
    [bases],
  );
  const selected = targets.find((b) => b.id === typeId) ?? null;

  const chooseBase = (id: string) => {
    setTypeId(id);
    const b = targets.find((t) => t.id === id);
    setMapping(b ? autoMapBaseFields(b.fields.map((f) => ({ name: f.name, label: f.label, type: f.type }))) : {});
  };

  const submit = async () => {
    if (!selected || !message) return;
    setBusy(true);
    try {
      const fields: Record<string, unknown> = {};
      for (const f of selected.fields) {
        const src = mapping[f.name];
        if (src) fields[f.name] = emailSourceValue(message, src);
      }
      await captureToBase(selected.id, fields);
      toast({ title: `Ligne créée dans « ${selected.name} »` });
      onClose();
    } catch (err) {
      toast({ title: "Échec de la capture", description: err instanceof Error ? err.message : String(err), variant: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(o) => { if (!o) onClose(); }} title="Capturer dans une base" size="lg">
      <div className="flex flex-col gap-4">
        {/* Choix de la base */}
        <div className="flex flex-col gap-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Base cible</span>
          <div className="flex flex-wrap gap-2">
            {targets.length === 0 && (
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>Aucune base disponible.</span>
            )}
            {targets.map((b) => (
              <Button key={b.id} variant={b.id === typeId ? "primary" : "ghost"} size="sm" onPress={() => chooseBase(b.id)}>
                {b.name}
              </Button>
            ))}
          </div>
        </div>

        {/* Mapping des champs */}
        {selected && (
          <div className="flex flex-col gap-2">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Mapping des champs</span>
            {selected.fields.map((f) => (
              <div key={f.name} className="flex items-center justify-between gap-3">
                <span className="text-sm">{f.label}</span>
                <select
                  value={mapping[f.name] ?? ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.name]: e.target.value as EmailFieldSource | "" }))}
                  className="rounded-md border px-2 py-1 text-sm"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--surface-1)" }}
                >
                  {SOURCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            ))}
            <Button color="primary" isDisabled={busy} onPress={() => void submit()} className="mt-2 self-end">
              {busy ? "Création…" : "Créer la ligne"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
```

> Notes : (a) le `<select>` natif est une exception justifiée (HeroUI v3 `Select` peut diverger ; un select de mapping dense est acceptable — comme les exceptions Cell editor). Si le repo a un `NativeSelect` partagé (`components/settings/NativeSelect.tsx`), le réutiliser. (b) Vérifier que `isCodaBase` est exporté depuis `@/components/bases/hooks`. (c) Vérifier la forme réelle de `b.fields` (FieldDefinition `{ name, label, type }`). (d) `schemas.list` input réel (`{ search? }`).

- [ ] **Step 2: Typecheck** — `pnpm --filter web typecheck` → clean.
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/mail/CaptureEmailModal.tsx
git commit -m "feat(mail): CaptureEmailModal (capture vers une base + mapping de champs)"
```

---

## Task 4 (P4b) : câbler « Capturer vers une base » sur `/mail`

**Files:** Modify `apps/web/src/app/mail/page.tsx`

- [ ] **Step 1: Wiring** — état + bouton + modal :

```tsx
  const [captureOpen, setCaptureOpen] = useState(false);
```

Dans la barre d'actions du reader (à côté de « Capturer en note ») :

```tsx
            <Button variant="ghost" size="sm" onPress={() => setCaptureOpen(true)} isDisabled={!thread?.messages[0]}>
              <Database size={16} /> Capturer dans une base
            </Button>
```

Et monter la modal (après le reader) :

```tsx
      <CaptureEmailModal
        isOpen={captureOpen}
        message={thread?.messages[0] ?? null}
        onClose={() => setCaptureOpen(false)}
      />
```

(Importer `CaptureEmailModal` + `Database` de `@phosphor-icons/react`.)

- [ ] **Step 2: Typecheck + tests** — clean / vert.
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/mail/page.tsx
git commit -m "feat(mail): bouton « Capturer dans une base » sur le reader /mail (P4b)"
```

---

## Task 5 : vérification finale P4

- [ ] **Step 1: Typecheck global** — `pnpm typecheck` → clean.
- [ ] **Step 2: Suites** — `pnpm --filter web test` → vert (incl. mail-capture).
- [ ] **Step 3: Smoke manuel** (Gmail connecté, au moins une base utilisateur existante) :
  1. `/mail` → ouvrir un thread → « Capturer en note » → note créée dans Inbox (en-tête De/Date + corps + lien) → navigation vers la note + toast.
  2. « Capturer dans une base » → modal → choisir une base → mapping auto pré-rempli (titre←sujet, email←from, date←date) → ajuster → « Créer la ligne » → ligne créée (champs keyés par name) + toast.
  3. Bases Coda **absentes** de la liste cible (gate `isCodaBase`).
  4. Aucune base utilisateur → message « Aucune base disponible ».
  5. Mobile : boutons capture accessibles, modal utilisable, pas de débordement.

---

## Self-Review (couverture vs spec P4)

- **Email→note (sujet→titre, corps+métadonnées, Inbox)** → Tasks 1-2 ✓
- **Email→ligne de base (mapping champ→source, fields keyés par name)** → Tasks 1, 3-4 ✓
- **Exclut les bases Coda readonly** (`isCodaBase`) → Task 3 ✓
- **Réutilise worker `entities.create`** (pas de nouveau chemin worker) → Task 2 ✓
- **Auto-mapping heuristique + ajustement manuel** → Tasks 1, 3 ✓
- **Mobile en même mouvement** (boutons + modal HeroUI) → Tasks 2-4 ✓
- **Surface sur le reader /mail** → Tasks 2, 4 ✓

**Hors P4 :** capture multi-emails en lot (un message à la fois ici), mapping vers champs select/relation (texte/date/email seulement), création d'une nouvelle base à la volée, dédup. **Toutes les phases du spec Gmail seront alors couvertes (P1 lecture, P2 embed, P3 compose, P4 capture).**
