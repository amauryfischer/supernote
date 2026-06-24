# Gmail — Phase 2 (Bloc embed email) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Référencer un email Gmail dans une note via un bloc BlockNote custom `gmailMessage`, décalqué sur le bloc `googleSheet` : sélection par picker (pas d'URL collable), rendu lecture seule délégué à l'hôte (réutilise `getThread` + `EmailThreadView`), fallback carte+lien, sérialisé `[gmail threadId="…"]`.

**Architecture:** Bloc dans `@supernote/editor` (prop unique `threadId`, url dérivée). Provider `GmailEmbedProvider` injecte une API `{ render, pickEmail }` depuis l'app : `render` = carte de thread (host), `pickEmail()` = modal HeroUI enveloppant `EmailPicker` (Phase 1) résolvant un `threadId`. Câblage `NoteEditor → SupernoteEditor` calqué sur `renderGoogleSheet`.

**Tech Stack:** BlockNote (`createReactBlockSpec`), React context, HeroUI v3 (`Modal`), vitest (editor package). Lib Gmail P1 (`getThread`, `searchThreads`, `EmailThreadView`, `EmailPicker`, `useGmailConnected`).

**Prérequis :** Phase 1 (branche `feat/gmail-p1`) déjà en place. On continue sur la même branche.

**⚠️ GOTCHA BUILD :** `@supernote/editor` est consommé via `dist/` (`main: ./dist/index.js`). Toute modif `.ts(x)` du package **exige `pnpm --filter @supernote/editor build`** avant que l'app (typecheck/runtime) la voie. Chaque tâche touchant le package finit par un build.

---

## File Structure

**Package `@supernote/editor` :**
- Create `packages/editor/src/blocks/gmailEmbedUrl.ts` — `buildGmailThreadUrl(threadId)` (+ test).
- Create `packages/editor/src/blocks/gmailMessage.tsx` — block spec + `GmailEmbedProvider`/`useGmailEmbed` + sous-composants (EmptyState, FallbackCard).
- Modify `packages/editor/src/schema.ts` — enregistrer `gmailMessage`.
- Modify `packages/editor/src/blocks/index.ts` — ré-exporter bloc/provider/hook/types/helper.
- Modify `packages/editor/src/index.ts` — exports publics.
- Modify `packages/editor/src/serialization/serialize.ts` — case `gmailMessage` → `[gmail threadId="…"]`.
- Modify `packages/editor/src/serialization/parse.ts` — parse `[gmail threadId="…"]` → `{ threadId }`.
- Modify `packages/editor/src/serialization/serialization.test.ts` — round-trip.
- Modify `packages/editor/src/extensions/slashMenu.tsx` — item « Email ».
- Modify `packages/editor/src/SupernoteEditor.tsx` — prop `gmailEmbed`, provider wiring, `NON_EDITABLE_TRAILING` += `gmailMessage`.
- Modify `packages/editor/src/types.ts` — type de la prop `gmailEmbed`.

**App `apps/web` :**
- Create `apps/web/src/components/notes/GmailMessageView.tsx` — `renderGmailMessage` (fetch thread → `EmailThreadView`).
- Create `apps/web/src/components/notes/GmailPickerModal.tsx` — `Modal` HeroUI + `EmailPicker`.
- Modify `apps/web/src/components/notes/NoteEditor.tsx` — `pickEmail` (promise+resolver), monte la modal, passe `gmailEmbed={{ render, pickEmail }}`.

---

## Task 1 : helper `buildGmailThreadUrl` (pur, TDD)

**Files:**
- Create: `packages/editor/src/blocks/gmailEmbedUrl.ts`
- Test: `packages/editor/src/blocks/gmailEmbedUrl.test.ts`

- [ ] **Step 1: Test qui échoue**

```ts
import { describe, it, expect } from "vitest";
import { buildGmailThreadUrl } from "./gmailEmbedUrl";

describe("buildGmailThreadUrl", () => {
  it("construit l'URL web Gmail d'un thread", () => {
    expect(buildGmailThreadUrl("abc123")).toBe("https://mail.google.com/mail/u/0/#all/abc123");
  });
  it("encode les caractères spéciaux du threadId", () => {
    expect(buildGmailThreadUrl("a/b")).toBe("https://mail.google.com/mail/u/0/#all/a%2Fb");
  });
  it("threadId vide → chaîne vide", () => {
    expect(buildGmailThreadUrl("")).toBe("");
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @supernote/editor test -- gmailEmbedUrl` → FAIL (module absent).

- [ ] **Step 3: Implémenter `gmailEmbedUrl.ts`**

```ts
/**
 * Helpers d'URL pour le bloc embed Gmail. Un thread n'a pas d'URL « collable »
 * stable côté utilisateur ; on dérive le lien web Gmail depuis le threadId.
 */

/** Lien web Gmail vers un thread (ouvre la conversation dans Gmail). */
export function buildGmailThreadUrl(threadId: string): string {
  if (!threadId) return "";
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}
```

- [ ] **Step 4: Vérifier le succès** — `pnpm --filter @supernote/editor test -- gmailEmbedUrl` → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/blocks/gmailEmbedUrl.ts packages/editor/src/blocks/gmailEmbedUrl.test.ts
git commit -m "feat(editor): helper buildGmailThreadUrl (bloc embed Gmail)"
```

---

## Task 2 : bloc `gmailMessage` + provider

**Files:**
- Create: `packages/editor/src/blocks/gmailMessage.tsx`

Mirror `googleSheet.tsx`. Prop unique `threadId` ; url dérivée. Provider expose `{ render, pickEmail }`.

- [ ] **Step 1: Créer `gmailMessage.tsx`**

```tsx
import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { buildGmailThreadUrl } from "./gmailEmbedUrl.js";

// ─── Provider (renderer délégué + picker hôte) ────────────────────────────────

export interface GmailEmbedRenderProps {
  threadId: string;
  url: string;
  onClear: () => void;
}

export interface GmailEmbedApi {
  /** Rendu lecture seule du thread (fourni par l'app : fetch + EmailThreadView). */
  render: (props: GmailEmbedRenderProps) => React.ReactNode;
  /** Ouvre le picker d'email (modal hôte). Résout le threadId choisi, ou null si annulé. */
  pickEmail: () => Promise<string | null>;
}

const GmailEmbedContext = React.createContext<GmailEmbedApi | null>(null);

export function GmailEmbedProvider({
  api,
  children,
}: {
  api: GmailEmbedApi | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return <GmailEmbedContext.Provider value={api}>{children}</GmailEmbedContext.Provider>;
}

export function useGmailEmbed(): GmailEmbedApi | null {
  return React.useContext(GmailEmbedContext);
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function EmptyState({
  api,
  onPicked,
}: {
  api: GmailEmbedApi | null;
  onPicked: (threadId: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  if (!api) {
    return (
      <div className="sn-gmail-empty" style={{ padding: 16, fontSize: 13, color: "var(--text-muted)" }}>
        Connectez Gmail pour insérer un email.
      </div>
    );
  }
  const pick = async () => {
    setBusy(true);
    try {
      const id = await api.pickEmail();
      if (id) onPicked(id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sn-gmail-empty" style={{ padding: 16 }}>
      <button
        type="button"
        onClick={pick}
        disabled={busy}
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          border: "1px solid var(--border-subtle)",
          background: "var(--surface-2)",
          color: "var(--text-primary)",
          fontSize: 13,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "…" : "✉️ Choisir un email"}
      </button>
    </div>
  );
}

function FallbackCard({ url, onClear }: { url: string; onClear: () => void }) {
  return (
    <div
      className="sn-gmail-card"
      style={{
        padding: 14,
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        background: "var(--surface-1)",
        fontSize: 13,
      }}
    >
      <span style={{ color: "var(--text-secondary)" }}>Email Gmail</span>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 12, color: "var(--accent)", textDecoration: "none" }}
        >
          Ouvrir dans Gmail ↗
        </a>
      )}
      <button
        type="button"
        onClick={onClear}
        style={{ marginLeft: 12, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
      >
        changer
      </button>
    </div>
  );
}

// ─── Block spec ───────────────────────────────────────────────────────────────

export const gmailMessageBlockSpec = createReactBlockSpec(
  {
    type: "gmailMessage" as const,
    propSchema: {
      threadId: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const threadId = (block.props.threadId ?? "") as string;
      const api = useGmailEmbed();
      const url = buildGmailThreadUrl(threadId);

      const setThreadId = (next: string) => {
        editor.updateBlock(block, { props: { threadId: next } } as never);
      };
      const clear = () => setThreadId("");

      let body: React.ReactNode;
      if (!threadId) {
        body = <EmptyState api={api} onPicked={setThreadId} />;
      } else if (api) {
        body = api.render({ threadId, url, onClear: clear });
      } else {
        body = <FallbackCard url={url} onClear={clear} />;
      }

      return (
        <div className="sn-gmail" contentEditable={false}>
          {body}
        </div>
      );
    },
  },
);
```

> Vérifier l'import exact de `createReactBlockSpec` contre `googleSheet.tsx` (même chemin/forme). Les boutons natifs `<button>`/lien `<a>` ici suivent l'exception « blocs éditeur self-contained » déjà admise pour `googleSheet` (cf. EmptyState/DesktopEmbed natifs) — cohérent avec la règle CLAUDE.md (cas justifiés éditeur).

- [ ] **Step 2: Typecheck package** — `pnpm --filter @supernote/editor typecheck` (ou `tsc -p packages/editor/tsconfig.build.json --noEmit`) → pas d'erreur. (Le bloc n'est pas encore enregistré ; ça compile quand même.)

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/blocks/gmailMessage.tsx
git commit -m "feat(editor): bloc gmailMessage + GmailEmbedProvider (picker + renderer délégué)"
```

---

## Task 3 : enregistrement schema + exports + trailing-paragraph

**Files:**
- Modify: `packages/editor/src/schema.ts`
- Modify: `packages/editor/src/blocks/index.ts`
- Modify: `packages/editor/src/index.ts`
- Modify: `packages/editor/src/SupernoteEditor.tsx` (NON_EDITABLE_TRAILING)

- [ ] **Step 1: schema.ts** — dans `BlockNoteSchema.create({ blockSpecs: { ... } })`, ajouter après `googleSheet: googleSheetBlockSpec(),` :

```ts
    gmailMessage: gmailMessageBlockSpec(),
```

Et l'import en tête du fichier (à côté de l'import de `googleSheetBlockSpec`). Vérifier comment `googleSheetBlockSpec` est importé dans schema.ts et copier la forme.

- [ ] **Step 2: blocks/index.ts** — ajouter à côté des ré-exports googleSheet :

```ts
export {
  gmailMessageBlockSpec,
  GmailEmbedProvider,
  useGmailEmbed,
} from "./gmailMessage.js";
export type { GmailEmbedApi, GmailEmbedRenderProps } from "./gmailMessage.js";
export { buildGmailThreadUrl } from "./gmailEmbedUrl.js";
```

- [ ] **Step 3: index.ts (exports publics)** — ajouter à côté des exports googleSheet :

```ts
export {
  gmailMessageBlockSpec,
  GmailEmbedProvider,
  useGmailEmbed,
  buildGmailThreadUrl,
} from "./blocks/index.js";
export type { GmailEmbedApi, GmailEmbedRenderProps } from "./blocks/index.js";
```

- [ ] **Step 4: SupernoteEditor.tsx NON_EDITABLE_TRAILING** — trouver `const NON_EDITABLE_TRAILING = new Set(["databaseView", "googleSheet"]);` et ajouter `"gmailMessage"` :

```ts
      const NON_EDITABLE_TRAILING = new Set(["databaseView", "googleSheet", "gmailMessage"]);
```

- [ ] **Step 5: Typecheck** — `pnpm --filter @supernote/editor typecheck` → pas d'erreur. (Note : la prop `gmailEmbed` et le provider wiring arrivent en Task 5 ; ici on ne fait que registration + trailing.)

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/schema.ts packages/editor/src/blocks/index.ts packages/editor/src/index.ts packages/editor/src/SupernoteEditor.tsx
git commit -m "feat(editor): enregistre gmailMessage (schema, exports, trailing paragraph)"
```

---

## Task 4 : sérialisation `[gmail threadId="…"]` (TDD round-trip)

**Files:**
- Modify: `packages/editor/src/serialization/serialize.ts`
- Modify: `packages/editor/src/serialization/parse.ts`
- Modify: `packages/editor/src/serialization/serialization.test.ts`

- [ ] **Step 1: Test round-trip qui échoue** — dans `serialization.test.ts`, ajouter (en s'inspirant du test googleSheet existant) un cas :

```ts
it("round-trip bloc gmailMessage", () => {
  const md = '[gmail threadId="thread_abc123"]';
  const blocks = parseMarkdownToBlocks(md);
  expect(blocks[0]).toMatchObject({ type: "gmailMessage", props: { threadId: "thread_abc123" } });
  const back = serializeBlocksToMarkdown(blocks);
  expect(back.trim()).toBe(md);
});
```

> Adapter les noms `parseMarkdownToBlocks` / `serializeBlocksToMarkdown` aux fonctions réellement importées dans `serialization.test.ts` (lire le haut du fichier + le test googleSheet pour les noms exacts).

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @supernote/editor test -- serialization` → FAIL (case absente).

- [ ] **Step 3: serialize.ts** — ajouter une `case` après celle de `googleSheet` :

```ts
    case "gmailMessage": {
      const threadId = (props.threadId as string) ?? "";
      return `[gmail threadId="${escapeAttr(threadId)}"]`;
    }
```

- [ ] **Step 4: parse.ts** — ajouter après le bloc googleSheet :

```ts
    // Bloc gmailMessage — sérialisé en `[gmail threadId="..."]`.
    const gmailMatch = /^\[gmail\s+threadId="((?:[^"\\]|\\.)*)"\]\s*$/.exec(line);
    if (gmailMatch) {
      return {
        type: "gmailMessage",
        props: { threadId: unescapeAttr(gmailMatch[1] ?? "") },
      };
    }
```

> Placer ce bloc au même niveau que la détection googleSheet (mêmes `line`/return shape). Vérifier la structure de contrôle exacte dans parse.ts et insérer de façon cohérente.

- [ ] **Step 5: Vérifier le succès** — `pnpm --filter @supernote/editor test -- serialization` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/serialization/serialize.ts packages/editor/src/serialization/parse.ts packages/editor/src/serialization/serialization.test.ts
git commit -m "feat(editor): sérialisation bloc gmailMessage ([gmail threadId=...])"
```

---

## Task 5 : slash menu + prop `gmailEmbed` + provider wiring

**Files:**
- Modify: `packages/editor/src/extensions/slashMenu.tsx`
- Modify: `packages/editor/src/types.ts`
- Modify: `packages/editor/src/SupernoteEditor.tsx`

- [ ] **Step 1: slashMenu.tsx — item « Email »** — calquer `googleSheetItem`. Ajouter :

```tsx
  const gmailItem: DefaultReactSuggestionItem = {
    title: "Email",
    subtext: "Insère un email Gmail (lecture seule)",
    group: "Bases",
    aliases: ["email", "mail", "gmail", "courriel", "message"],
    icon: <span aria-hidden="true">✉️</span>,
    onItemClick() {
      const inserted = editor.insertBlocks(
        [
          { type: "gmailMessage" as never, props: { threadId: "" } } as never,
          { type: "paragraph" } as never,
        ],
        editor.getTextCursorPosition().block,
        "after",
      );
      const trailing = inserted?.[1];
      if (trailing) {
        editor.setTextCursorPosition(trailing as never, "start");
      }
    },
  };
```

Puis l'ajouter au tableau retourné par `getSupernoteSlashMenuItems()` (à côté de `googleSheetItem`). Respecter le typage `as never`/`as any` réellement utilisé par `googleSheetItem` dans ce fichier (copier sa forme exacte).

- [ ] **Step 2: types.ts — prop `gmailEmbed`** — à côté de `renderGoogleSheet?`, ajouter :

```ts
  /** API d'embed Gmail (Phase 2) : rendu d'un thread + picker d'email. */
  gmailEmbed?: import("./blocks/gmailMessage.js").GmailEmbedApi;
```

> Si `types.ts` importe déjà des types via `import type {...}` en tête, préférer ajouter un `import type { GmailEmbedApi } from "./blocks/gmailMessage.js";` en tête et écrire `gmailEmbed?: GmailEmbedApi;` (cohérent avec le style du fichier). Vérifier comment `renderGoogleSheet` est typé et s'aligner.

- [ ] **Step 3: SupernoteEditor.tsx — wiring** — calquer `renderGoogleSheet` :
  - Destructurer `gmailEmbed` dans les props.
  - `const gmailEmbedApi = gmailEmbed ?? null;`
  - Envelopper l'éditeur dans `<GmailEmbedProvider api={gmailEmbedApi}>…</GmailEmbedProvider>` (imbriqué avec `GoogleSheetProvider`, même endroit). Importer `GmailEmbedProvider` depuis `./blocks/index.js` (ou le chemin utilisé pour `GoogleSheetProvider`).

- [ ] **Step 4: Typecheck** — `pnpm --filter @supernote/editor typecheck` → pas d'erreur.

- [ ] **Step 5: BUILD editor** — `pnpm --filter @supernote/editor build` → dist régénéré (obligatoire pour que l'app voie le nouveau bloc + la prop).

- [ ] **Step 6: Tests editor** — `pnpm --filter @supernote/editor test` → tout vert.

- [ ] **Step 7: Commit**

```bash
git add packages/editor/src/extensions/slashMenu.tsx packages/editor/src/types.ts packages/editor/src/SupernoteEditor.tsx
git commit -m "feat(editor): slash menu Email + prop gmailEmbed + provider wiring"
```

---

## Task 6 : host renderer + picker modal + wiring NoteEditor (app)

**Files:**
- Create: `apps/web/src/components/notes/GmailMessageView.tsx`
- Create: `apps/web/src/components/notes/GmailPickerModal.tsx`
- Modify: `apps/web/src/components/notes/NoteEditor.tsx`

- [ ] **Step 1: `GmailMessageView.tsx`** (renderer hôte : fetch thread → EmailThreadView)

```tsx
"use client";

import { useEffect, useState } from "react";
import type { GmailEmbedRenderProps } from "@supernote/editor";
import { useSettings } from "@/components/settings/SettingsContext";
import { getThread, type EmailThread } from "@/lib/gmail";
import { EmailThreadView } from "@/components/mail/EmailThreadView";

/** Fonction passée au provider editor : rend un thread Gmail dans un bloc note. */
export function renderGmailMessage(props: GmailEmbedRenderProps): React.ReactNode {
  return <GmailMessageView {...props} />;
}

function GmailMessageView({ threadId, url, onClear }: GmailEmbedRenderProps) {
  const { settings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getThread(clientId, threadId)
      .then((t) => {
        if (!cancelled) setThread(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, threadId]);

  return (
    <div
      contentEditable={false}
      style={{
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        background: "var(--surface-1)",
        padding: 12,
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Email Gmail
        </span>
        <span className="flex items-center gap-3 text-xs">
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>
              Ouvrir ↗
            </a>
          )}
          <button type="button" onClick={onClear} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            changer
          </button>
        </span>
      </div>
      {loading && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement…</p>}
      {error && <p className="text-sm" style={{ color: "var(--color-danger, #ef4444)" }}>{error}</p>}
      {!loading && !error && thread && <EmailThreadView thread={thread} />}
    </div>
  );
}
```

- [ ] **Step 2: `GmailPickerModal.tsx`** (HeroUI Modal + EmailPicker)

```tsx
"use client";

import { Modal } from "@heroui/react";
import { EmailPicker } from "@/components/mail/EmailPicker";

/** Modal de sélection d'un email — enveloppe EmailPicker pour le bloc embed. */
export function GmailPickerModal({
  isOpen,
  onSelect,
  onClose,
}: {
  isOpen: boolean;
  onSelect: (threadId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} title="Choisir un email" size="lg">
      <EmailPicker onSelect={onSelect} />
    </Modal>
  );
}
```

> Vérifier l'API `Modal` HeroUI v3 réellement utilisée dans le repo (cf. `NewItemSheet.tsx` : `<Modal isOpen onOpenChange title size>`). S'aligner.

- [ ] **Step 3: Wiring `NoteEditor.tsx`** — calquer le passage de `renderGoogleSheet`. Ajouter :
  - Imports : `import { renderGmailMessage } from "./GmailMessageView";`, `import { GmailPickerModal } from "./GmailPickerModal";`, et `useCallback`/`useMemo`/`useRef`/`useState` si pas déjà importés.
  - Dans le composant, l'état du picker + le resolver de promesse :

```tsx
  const [gmailPickerOpen, setGmailPickerOpen] = useState(false);
  const gmailResolveRef = useRef<((id: string | null) => void) | null>(null);

  const pickEmail = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        gmailResolveRef.current = resolve;
        setGmailPickerOpen(true);
      }),
    [],
  );

  const handleGmailSelect = useCallback((id: string) => {
    setGmailPickerOpen(false);
    gmailResolveRef.current?.(id);
    gmailResolveRef.current = null;
  }, []);

  const handleGmailCancel = useCallback(() => {
    setGmailPickerOpen(false);
    gmailResolveRef.current?.(null);
    gmailResolveRef.current = null;
  }, []);

  const gmailEmbed = useMemo(
    () => ({ render: renderGmailMessage, pickEmail }),
    [pickEmail],
  );
```

  - Passer la prop à `SupernoteEditor` (à côté de `renderGoogleSheet={renderGoogleSheet}`) :

```tsx
        gmailEmbed={gmailEmbed}
```

  - Monter la modal à côté de l'éditeur (dans le JSX rendu par NoteEditor, après `<SupernoteEditor … />`) :

```tsx
      <GmailPickerModal isOpen={gmailPickerOpen} onSelect={handleGmailSelect} onClose={handleGmailCancel} />
```

> Lire la structure réelle de NoteEditor (où `renderGoogleSheet` est passé, ~ligne 1339-1361, et où placer la modal) et insérer proprement. Si NoteEditor est volumineux, rester chirurgical.

- [ ] **Step 4: Typecheck app** — `pnpm --filter web typecheck` → pas d'erreur. (L'editor a déjà été buildé en Task 5 ; sinon rebuild d'abord.)

- [ ] **Step 5: Tests** — `pnpm --filter web test` (tail) → tout vert.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/notes/GmailMessageView.tsx apps/web/src/components/notes/GmailPickerModal.tsx apps/web/src/components/notes/NoteEditor.tsx
git commit -m "feat(mail): bloc embed Gmail câblé (renderer + picker modal dans NoteEditor)"
```

---

## Task 7 : vérification finale P2

- [ ] **Step 1: Build editor + typecheck global** — `pnpm --filter @supernote/editor build && pnpm typecheck` → clean.
- [ ] **Step 2: Suites** — `pnpm --filter @supernote/editor test && pnpm --filter web test` → tout vert.
- [ ] **Step 3: Smoke manuel** (Gmail connecté) :
  1. Dans une note, slash menu → « Email » → bloc inséré (état vide « Choisir un email »).
  2. Clic « Choisir un email » → modal `EmailPicker` → recherche → sélection → le bloc affiche le thread (EmailThreadView) + « Ouvrir ↗ » + « changer ».
  3. Sauvegarder la note → rouvrir → le bloc persiste (sérialisé `[gmail threadId="…"]`, rechargé et re-rendu).
  4. « changer » → revient à l'état vide.
  5. Mobile <768px : bloc lisible, pas de débordement ; modal picker utilisable.
  6. Gmail déconnecté : bloc existant → fallback carte + lien (pas de crash) ; état vide → « Connectez Gmail ».

---

## Self-Review (couverture vs spec P2)

- **Bloc `gmailMessage` décalqué googleSheet** → Tasks 2-3 ✓
- **Picker au lieu d'URL collable** (`pickEmail` provider + modal hôte) → Tasks 2, 6 ✓
- **Renderer délégué (host) réutilise getThread + EmailThreadView** → Task 6 ✓
- **Fallback carte+lien (non connecté / pas de provider)** → Tasks 2, 6 ✓
- **Sérialisé `[gmail threadId="…"]`** → Task 4 ✓
- **Slash menu** → Task 5 ✓
- **Mobile en même mouvement** (modal HeroUI responsive, bloc fluide) → Tasks 6-7 ✓
- **Gotcha build dist** → Tasks 5, 7 ✓

**Hors P2 :** compose/draft (P3), capture→entité (P4), rendu HTML sanitisé, sélection d'un message précis dans le thread (P2 référence le thread entier).
```
