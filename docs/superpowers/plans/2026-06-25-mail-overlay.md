# Surcouche mail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Surcouche Supernote au-dessus du flux Gmail : regroupement auto (label d'abord, puis expéditeur, ≥2) + navigation 3 volets sur `/mail`.

**Architecture:** `lib/gmail.ts` fournit les données à plat (+ labels) ; `lib/mail-overlay.ts` (pur) regroupe ; `/mail` 3-volets consomme. Cf. spec `docs/superpowers/specs/2026-06-25-mail-overlay-design.md`.

**Prérequis :** intégration Gmail P1-P4 sur `main`. Branche `feat/mail-overlay`.

---

## Task 1 : lib — `labelIds` + `listLabels`

**Files:** Modify `apps/web/src/lib/gmail.ts`, `apps/web/src/lib/gmail.test.ts`

Le `GmailRawMessage` doit exposer `labelIds`; `ThreadListItem` gagne `labelIds` (union des messages du thread); nouveau `listLabels` (labels user).

- [ ] **Step 1: Tests qui échouent** — append à `gmail.test.ts` :

```ts
import { listLabels } from "./gmail";

describe("listLabels", () => {
  it("ne renvoie que les labels utilisateur (exclut système)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        labels: [
          { id: "Label_1", name: "Projet", type: "user" },
          { id: "INBOX", name: "INBOX", type: "system" },
          { id: "Label_2", name: "Perso", type: "user" },
        ],
      }),
    })));
    const labels = await listLabels("cid");
    expect(labels).toEqual([
      { id: "Label_1", name: "Projet" },
      { id: "Label_2", name: "Perso" },
    ]);
    vi.unstubAllGlobals();
  });
});
```

Et étendre le test `listThreadSummaries` existant pour vérifier `labelIds` : dans la réponse metadata du thread, ajouter `labelIds` sur le message (`labelIds: ["Label_1","INBOX"]`) et asserter `items[0].labelIds` contient `"Label_1"`.

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter web test -- gmail` → FAIL.

- [ ] **Step 3: Implémenter dans `gmail.ts`** :
  - Ajouter `labelIds?: string[]` à l'interface `GmailRawMessage`.
  - Ajouter `labelIds: string[]` à `ThreadListItem`.
  - Dans `getThreadListItem`, calculer l'union : `const labelIds = [...new Set(msgs.flatMap((m) => m.labelIds ?? []))];` et l'ajouter au retour.
  - Ajouter :

```ts
export interface GmailLabel {
  id: string;
  name: string;
}

/** Labels utilisateur (exclut les labels système Gmail). */
export async function listLabels(clientId: string): Promise<GmailLabel[]> {
  const json = await gmailFetch<{ labels?: Array<{ id: string; name: string; type?: string }> }>(
    clientId,
    "/labels",
  );
  return (json.labels ?? [])
    .filter((l) => l.type === "user")
    .map((l) => ({ id: l.id, name: l.name }));
}
```

- [ ] **Step 4: Vérifier le succès** — `pnpm --filter web test -- gmail` → PASS.
- [ ] **Step 5: Typecheck** — `pnpm --filter web typecheck` → clean.
- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/gmail.ts apps/web/src/lib/gmail.test.ts
git commit -m "feat(mail): labelIds sur ThreadListItem + listLabels (labels user)"
```

---

## Task 2 : `lib/mail-overlay.ts` — `buildMailOverlay` (pur, TDD)

**Files:** Create `apps/web/src/lib/mail-overlay.ts`, `apps/web/src/lib/mail-overlay.test.ts`

- [ ] **Step 1: Tests qui échouent** — `mail-overlay.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { buildMailOverlay } from "./mail-overlay";
import type { ThreadListItem } from "@/lib/gmail";

function item(id: string, fromEmail: string, date: string, labelIds: string[] = [], subject = "s"): ThreadListItem {
  return { id, subject, from: { name: fromEmail.split("@")[0]!, email: fromEmail }, date, snippet: "", labelIds };
}
const labels = new Map([["L1", "Projet"], ["L2", "Perso"]]);

describe("buildMailOverlay", () => {
  it("groupe par label d'abord (≥2), avec count + date la plus récente", () => {
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"]),
        item("b", "bob@x.io", "2026-06-22T10:00:00Z", ["L1"]),
      ],
      labels,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "group", groupType: "label", title: "Projet", count: 2 });
    expect(rows[0]!.kind === "group" && rows[0].date).toMatch(/^2026-06-22/);
  });

  it("label prime sur expéditeur", () => {
    // 2 emails de ada : un avec label L1, un sans. Le labellisé part en groupe-label.
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"]),
        item("b", "ada@x.io", "2026-06-21T10:00:00Z", ["L1"]),
        item("c", "ada@x.io", "2026-06-22T10:00:00Z", []),
      ],
      labels,
    );
    // a,b → groupe-label Projet (2) ; c seul (1 email ada restant → pas de groupe-sender)
    const group = rows.find((r) => r.kind === "group");
    expect(group).toMatchObject({ groupType: "label", count: 2 });
    expect(rows.some((r) => r.kind === "single" && r.item.id === "c")).toBe(true);
  });

  it("groupe par expéditeur sur le reste (≥2)", () => {
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z"),
        item("b", "ada@x.io", "2026-06-21T10:00:00Z"),
        item("c", "bob@x.io", "2026-06-22T10:00:00Z"),
      ],
      labels,
    );
    expect(rows.find((r) => r.kind === "group")).toMatchObject({ groupType: "sender", count: 2 });
    expect(rows.some((r) => r.kind === "single" && r.item.id === "c")).toBe(true);
  });

  it("item multi-label → plus gros groupe", () => {
    const rows = buildMailOverlay(
      [
        item("a", "x@x.io", "2026-06-20T10:00:00Z", ["L1", "L2"]),
        item("b", "y@x.io", "2026-06-21T10:00:00Z", ["L1"]),
        item("c", "z@x.io", "2026-06-22T10:00:00Z", ["L1"]),
        item("d", "w@x.io", "2026-06-19T10:00:00Z", ["L2"]),
      ],
      labels,
    );
    // L1 a {a,b,c}=3, L2 a {a,d}=2 → a rejoint L1 (plus gros). L1=3, L2={d} seul.
    const l1 = rows.find((r) => r.kind === "group" && r.title === "Projet");
    expect(l1).toMatchObject({ count: 3 });
    expect(rows.some((r) => r.kind === "single" && r.item.id === "d")).toBe(true);
  });

  it("tri par date la plus récente, liste vide → []", () => {
    expect(buildMailOverlay([], labels)).toEqual([]);
    const rows = buildMailOverlay(
      [
        item("old", "a@x.io", "2026-06-01T10:00:00Z"),
        item("new", "b@x.io", "2026-06-25T10:00:00Z"),
      ],
      labels,
    );
    expect(rows[0]!.kind === "single" && rows[0].item.id).toBe("new");
  });

  it("sans labels → seulement sender + singles", () => {
    const rows = buildMailOverlay(
      [item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"])],
      new Map(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("single");
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter web test -- mail-overlay` → FAIL.

- [ ] **Step 3: Implémenter `mail-overlay.ts`** :

```ts
import type { ThreadListItem } from "@/lib/gmail";

export type OverlayRow =
  | { kind: "single"; item: ThreadListItem }
  | {
      kind: "group";
      groupType: "label" | "sender";
      key: string;
      title: string;
      count: number;
      items: ThreadListItem[];
      date: string;
    };

function mostRecent(items: ThreadListItem[]): string {
  return items.reduce((max, it) => (it.date > max ? it.date : max), "");
}

/**
 * Surcouche de regroupement. Label d'abord (≥2), puis expéditeur (≥2) sur le
 * reste, puis lignes seules. Tri par date la plus récente. Pur.
 *
 * `userLabels` : map labelId → nom (labels user uniquement). Un item multi-label
 * rejoint le plus gros groupe-label (tie-break : taille, puis nom).
 */
export function buildMailOverlay(
  items: ThreadListItem[],
  userLabels: Map<string, string>,
): OverlayRow[] {
  const consumed = new Set<string>();

  // 1. Compter les items par label user.
  const byLabel = new Map<string, ThreadListItem[]>();
  for (const it of items) {
    for (const lid of it.labelIds) {
      if (!userLabels.has(lid)) continue;
      (byLabel.get(lid) ?? byLabel.set(lid, []).get(lid)!).push(it);
    }
  }
  // Labels candidats (≥2), triés par taille desc puis nom asc (tie-break déterministe).
  const labelGroups = [...byLabel.entries()]
    .filter(([, arr]) => arr.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || (userLabels.get(a[0])! < userLabels.get(b[0])! ? -1 : 1));

  const rows: OverlayRow[] = [];
  for (const [lid, candidates] of labelGroups) {
    const members = candidates.filter((it) => !consumed.has(it.id));
    if (members.length < 2) continue; // après retrait des déjà-consommés
    members.forEach((it) => consumed.add(it.id));
    rows.push({
      kind: "group",
      groupType: "label",
      key: `label:${lid}`,
      title: userLabels.get(lid)!,
      count: members.length,
      items: members,
      date: mostRecent(members),
    });
  }

  // 2. Groupes-expéditeur sur le reste.
  const remaining = items.filter((it) => !consumed.has(it.id));
  const bySender = new Map<string, ThreadListItem[]>();
  for (const it of remaining) {
    const key = it.from.email || it.from.name;
    (bySender.get(key) ?? bySender.set(key, []).get(key)!).push(it);
  }
  for (const [email, arr] of bySender.entries()) {
    if (arr.length >= 2) {
      arr.forEach((it) => consumed.add(it.id));
      rows.push({
        kind: "group",
        groupType: "sender",
        key: `sender:${email}`,
        title: arr[0]!.from.name || email,
        count: arr.length,
        items: arr,
        date: mostRecent(arr),
      });
    }
  }

  // 3. Lignes seules.
  for (const it of items) {
    if (!consumed.has(it.id)) rows.push({ kind: "single", item: it });
  }

  // 4. Tri par date desc.
  const rowDate = (r: OverlayRow) => (r.kind === "single" ? r.item.date : r.date);
  return rows.sort((a, b) => (rowDate(a) < rowDate(b) ? 1 : -1));
}
```

> Note : `byLabel.get(lid) ?? byLabel.set(...).get(...)!` est idiomatique mais vérifier la lisibilité ; sinon une init explicite. Garder le comportement.

- [ ] **Step 4: Vérifier le succès** — `pnpm --filter web test -- mail-overlay` → PASS (tous les cas).
- [ ] **Step 5: Typecheck** — clean.
- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/mail-overlay.ts apps/web/src/lib/mail-overlay.test.ts
git commit -m "feat(mail): buildMailOverlay — surcouche de regroupement (pur)"
```

---

## Task 3 : UI 3 volets sur `/mail`

**Files:**
- Create `apps/web/src/components/mail/MailOverlayList.tsx` (volet 1 : lignes surcouche)
- Create `apps/web/src/components/mail/MailGroupList.tsx` (volet 2 : items d'un groupe)
- Modify `apps/web/src/app/mail/page.tsx` (orchestration 3 volets + fetch overlay)

Réutilise `EmailThreadView` (volet 3). `getThread`, `listThreadSummaries`, `listLabels`, `buildMailOverlay`.

- [ ] **Step 1: `MailOverlayList.tsx`** — liste des `OverlayRow`. Une ligne :

```tsx
"use client";

import { Button } from "@heroui/react";
import { Tag } from "@phosphor-icons/react";
import type { OverlayRow } from "@/lib/mail-overlay";

function shortDate(d: string): string {
  return d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : "";
}

export function MailOverlayList({
  rows,
  activeKey,
  onPick,
}: {
  rows: OverlayRow[];
  activeKey?: string;
  onPick: (row: OverlayRow) => void;
}) {
  return (
    <div className="flex flex-col gap-1" role="listbox" aria-label="Boîte mail">
      {rows.map((row) => {
        const key = row.kind === "single" ? `t:${row.item.id}` : row.key;
        const title = row.kind === "single" ? (row.item.from.name || row.item.from.email) : row.title;
        const subject = row.kind === "single" ? row.item.subject : (row.items[0]?.subject ?? "");
        const date = row.kind === "single" ? row.item.date : row.date;
        const isLabel = row.kind === "group" && row.groupType === "label";
        return (
          <Button
            key={key}
            variant={activeKey === key ? "primary" : "ghost"}
            onPress={() => onPick(row)}
            className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left"
          >
            <span className="flex w-full min-w-0 flex-col gap-0.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {isLabel && <Tag size={13} aria-hidden />}
                  <span className="truncate text-sm font-medium">{title}</span>
                  {row.kind === "group" && (
                    <span
                      className="shrink-0 rounded-full px-1.5 text-xs"
                      style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
                    >
                      {row.count}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
                  {shortDate(date)}
                </span>
              </span>
              <span className="truncate text-sm" style={{ color: "var(--text-secondary)" }}>
                {subject}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: `MailGroupList.tsx`** — items d'un groupe (lignes émetteur/objet/date) :

```tsx
"use client";

import { Button } from "@heroui/react";
import type { ThreadListItem } from "@/lib/gmail";

function shortDate(d: string): string {
  return d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : "";
}

export function MailGroupList({
  title,
  items,
  activeThreadId,
  onPick,
}: {
  title: string;
  items: ThreadListItem[];
  activeThreadId?: string;
  onPick: (threadId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {title} · {items.length}
      </p>
      {items.map((it) => (
        <Button
          key={it.id}
          variant={activeThreadId === it.id ? "primary" : "ghost"}
          onPress={() => onPick(it.id)}
          className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left"
        >
          <span className="flex w-full min-w-0 flex-col gap-0.5">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium">{it.from.name || it.from.email}</span>
              <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>{shortDate(it.date)}</span>
            </span>
            <span className="truncate text-sm" style={{ color: "var(--text-secondary)" }}>{it.subject}</span>
          </span>
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Réécrire `mail/page.tsx`** (orchestration). Garde le gate `useGmailConnected` + `AppShell` + `useMobileTitle`. Remplace EmailPicker par le flux surcouche :

Logique :
- Au montage (connecté) : `Promise.all([listThreadSummaries(clientId, "in:inbox"), listLabels(clientId).catch(() => [])])` → `rows = buildMailOverlay(items, new Map(labels.map(l => [l.id, l.name])))`. (listLabels en échec → Map vide → pas de groupes-label.)
- État : `selectedGroup: OverlayRow|null`, `selectedThreadId: string|null`, `thread`, loading/error pour le contenu.
- `onPick(row)` : si `single` → `selectedGroup=null`, charge le thread (`row.item.id`). Si `group` → `selectedGroup=row`, `selectedThreadId=null`, `thread=null`.
- `onPickThread(id)` : charge le thread → volet 3.
- Recherche : conserver un champ de recherche en haut du volet 1 qui relance `listThreadSummaries(query)` puis rebuild overlay (réutiliser le même pipeline ; query par défaut `in:inbox`).
- Desktop (≥768) : 3 colonnes flex côte à côte — volet1 (w-80 fixe), volet2 (w-80, rendu seulement si `selectedGroup`), volet3 (flex-1, si `thread`/loading/error). Bordures `var(--border-subtle)`.
- Mobile (<768, `useIsMobile`) : un seul volet visible selon l'état le plus profond : thread ? volet3 (+ bouton ‹ retour) : selectedGroup ? volet2 (+ retour) : volet1. Boutons retour HeroUI `variant="ghost"`.

Garder le contenu (volet 3) = barre d'actions capture (Capturer en note / dans une base, déjà présentes) + `<EmailThreadView thread={thread} />`. Le `CaptureEmailModal` reste monté.

> Lire le `mail/page.tsx` actuel et réutiliser au maximum (handlers capture, modal, AppShell, gate). C'est une restructuration du rendu, pas une réécriture des features capture.

- [ ] **Step 4: Typecheck + tests** — `pnpm --filter web typecheck` clean ; `pnpm --filter web test` vert.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/mail/MailOverlayList.tsx apps/web/src/components/mail/MailGroupList.tsx apps/web/src/app/mail/page.tsx
git commit -m "feat(mail): /mail 3 volets (surcouche groupée → groupe → contenu)"
```

---

## Task 4 : vérification finale

- [ ] **Step 1: Typecheck global** — `pnpm typecheck` → clean.
- [ ] **Step 2: Suites** — `pnpm --filter web test` → vert (gmail, mail-overlay).
- [ ] **Step 3: Smoke manuel** (Gmail connecté, ≥2 emails d'un même expéditeur et/ou label) :
  1. `/mail` se remplit ; expéditeurs/labels avec ≥2 emails apparaissent en groupes avec badge ; labels prioritaires sur expéditeurs.
  2. Clic ligne seule → contenu direct (volet 3).
  3. Clic groupe → volet 2 (liste) → clic email → volet 3 (contenu).
  4. Capture (note/base) fonctionne depuis le volet 3.
  5. Mobile : drill volet par volet + retour ; pas de débordement.
  6. Compte sans labels user → uniquement groupes-expéditeur + singles (pas de crash).

---

## Self-Review (couverture vs spec)

- **labelIds + listLabels** → Task 1 ✓
- **buildMailOverlay (label d'abord, sender, singles, tri, multi-label, ≥2)** → Task 2 ✓
- **Ligne : titre/badge + objet + date** → Task 3 (MailOverlayList) ✓
- **3 volets desktop + drill mobile** → Task 3 ✓
- **Réutilise EmailThreadView + capture** → Task 3 ✓
- **Dégradé si listLabels échoue** → Task 3 (catch → Map vide) ✓
- **Tests purs** → Tasks 1-2 ✓

**Hors v1 :** UI de config de la surcouche (auto), groupes To/envoyés, actions de masse.
