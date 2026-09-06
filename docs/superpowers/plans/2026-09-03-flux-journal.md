# Flux — le journal comme porte d'entrée — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire du Journal (entrée quotidienne) la porte d'entrée par défaut de Supernote, avec une extraction IA locale qui propose (jamais n'impose) de lier les mentions de contacts existants et de créer des todos depuis le texte libre, plus une capture rapide unifiée qui écrit dans l'entrée du jour.

**Architecture:** Un hook de persistance (`useDailyEntity`) fait de `/journal` une vraie fonctionnalité (elle ne l'était pas — voir Task 1) ; le routeur pointe `/` dessus ; un module d'orchestration pur (`journal-extract.ts`) branche le moteur d'extraction déjà existant (`@supernote/ai`, jusqu'ici réservé au mail) sur le texte du jour ; un panneau de suggestions HORS du DOM de l'éditeur (jamais dedans — piège MutationObserver documenté) affiche les candidats avec accept/reject explicite.

**Tech Stack:** React 18 / SPA Vite (react-router-dom), tRPC (`@/lib/trpc/client`), `@supernote/ai` (extraction Ollama + repli heuristique), `@supernote/editor` (BlockNote), HeroUI v3 (`@heroui/react` + wrapper `@supernote/ui`), Playwright (harness actuel non fonctionnel dans ce repo — voir Task 8).

## Global Constraints

- TypeScript strict, pas de `any`. `pnpm typecheck` doit passer avant chaque commit de ce plan.
- UI : composants HeroUI v3 (`@heroui/react`) obligatoires ; pour un bouton icône spécifiquement, utiliser le wrapper `Button`/`Tooltip` de `@supernote/ui` (pas `@heroui/react` brut) avec `aria-label` toujours présent — retour d'expérience du projet, pas une préférence de ce plan.
- Mobile en même temps que desktop : toute nouvelle surface doit être utilisable au doigt (hit-targets ~32px+, pas de débordement horizontal).
- **Zéro test unitaire.** Pas de vitest, pas de `*.test.ts`. Vérification = `pnpm typecheck` + vérification manuelle au navigateur (`pnpm dev`) par tâche ; Playwright en tâche finale (Task 8), avec une limite connue documentée dedans.
- **Jamais de manipulation DOM directe dans le subtree de l'éditeur** (`setAttribute`, portal interne, décoration ad-hoc) — piège MutationObserver déjà rencontré sur ce projet. Toute UI liée à l'extraction vit en DEHORS du DOM géré par ProseMirror/BlockNote (sibling du `<SupernoteEditor>`, jamais enfant).
- Commits : conventional commits français (`feat(scope):`, `fix(scope):`...), un commit par tâche, message se terminant par la ligne d'attribution standard de la session.
- Ne jamais committer sans que l'exécution de ce plan ait été explicitement choisie par l'utilisateur (cf. handoff en fin de plan) — c'est cette confirmation qui vaut demande explicite pour les commits listés ici.

---

### Task 1: Persistance réelle du Journal (fondation)

`/journal` a une UI complète mais son save est un `console.log` placeholder (`apps/web/src/components/journal/JournalEditor.tsx:28-38`) et rien ne recharge le contenu déjà écrit un jour donné (`initialMarkdown` est TOUJOURS dérivé du gabarit, jamais d'une entité existante). Sans ce socle, promouvoir `/journal` en accueil expose une fonctionnalité qui ne sauvegarde rien.

**Files:**
- Create: `apps/web/src/hooks/useDailyEntity.ts`
- Modify: `apps/web/src/components/journal/JournalEditor.tsx`
- Modify: `apps/web/src/app/journal/page.tsx`
- Modify: `apps/web/src/app/journal/[date]/page.tsx`

**Interfaces:**
- Consumes : `trpc.entities.list.useQuery` / `trpc.entities.create.useMutation` / `trpc.entities.update.useMutation` (`@/lib/trpc/client`, existants) ; `toYmdKey` (`apps/web/src/hooks/journal-dates.ts`, existant, pur) ; `DAILY_JOURNAL` (`@supernote/templates`, existant).
- Produces : `useDailyEntity(date: string): { entityId: string | null; initialMarkdown: string; isLoading: boolean; persist: (markdown: string) => void }` — consommé par `JournalEditor` (ce Task) et par `QuickCaptureOverlay` (Task 7) et `useJournalExtraction` (Task 5, pour `entityId` uniquement).

- [ ] **Step 1: Créer `useDailyEntity`**

```ts
// apps/web/src/hooks/useDailyEntity.ts
"use client";

import { useCallback, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc/client";
import { toYmdKey } from "./journal-dates";
import { DAILY_JOURNAL } from "@supernote/templates";

const DAILY_TYPE_ID = "daily";
const DAILY_LIMIT = 5000;

function buildTemplateMarkdown(date: string): string {
  const d = new Date(date + "T12:00:00");
  const formatted = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return DAILY_JOURNAL.body
    .replace(/\{\{date:[^}]+\}\}/g, formatted)
    .replace(/\{\{cursor\}\}/g, "");
}

interface UseDailyEntityResult {
  entityId: string | null;
  initialMarkdown: string;
  isLoading: boolean;
  persist: (markdown: string) => void;
}

/**
 * Trouve ou prépare l'entité `daily` d'une date donnée. Réutilise la même
 * requête que `useDatesWithNote` (typeId=daily, limite large) plutôt que
 * d'ajouter une procédure IPC dédiée à une seule date.
 */
export function useDailyEntity(date: string): UseDailyEntityResult {
  const utils = trpc.useUtils();
  const listQuery = trpc.entities.list.useQuery(
    { typeId: DAILY_TYPE_ID, limit: DAILY_LIMIT, offset: 0 },
    { staleTime: 30_000 },
  );

  const existing = useMemo(() => {
    for (const item of listQuery.data?.items ?? []) {
      if (toYmdKey(item.fields?.["date"]) === date) return item;
    }
    return null;
  }, [listQuery.data, date]);

  // Comble la fenêtre entre "create a réussi" et "le refetch a vu la
  // nouvelle entité" : sans ça, deux persist() rapprochés avant refetch
  // créeraient deux entités `daily` pour la même date.
  const createdIdRef = useRef<string | null>(null);

  const createMutation = trpc.entities.create.useMutation({
    onSuccess: (created) => {
      createdIdRef.current = created.id;
      void utils.entities.list.invalidate({ typeId: DAILY_TYPE_ID });
    },
  });
  const updateMutation = trpc.entities.update.useMutation();

  const persist = useCallback(
    (markdown: string) => {
      const id = existing?.id ?? createdIdRef.current;
      if (id) {
        void updateMutation.mutateAsync({ id, body: markdown });
      } else {
        void createMutation.mutateAsync({
          typeId: DAILY_TYPE_ID,
          fields: { date },
          body: markdown,
        });
      }
    },
    [existing, date, createMutation, updateMutation],
  );

  return {
    entityId: existing?.id ?? createdIdRef.current,
    initialMarkdown: existing?.body ?? buildTemplateMarkdown(date),
    isLoading: listQuery.isLoading,
    persist,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (le nouveau fichier ne casse rien, rien ne l'importe encore).

- [ ] **Step 3: Remplacer le placeholder dans `JournalEditor`**

Remplacer tout le contenu de `apps/web/src/components/journal/JournalEditor.tsx` par :

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FloppyDisk } from "@phosphor-icons/react";
import type { SupernoteEditorProps } from "@supernote/editor";
import { useDailyEntity } from "@/hooks/useDailyEntity";

const SupernoteEditor = dynamic<SupernoteEditorProps>(
  () => import("@supernote/editor").then((m) => ({ default: m.SupernoteEditor })),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

interface JournalEditorProps {
  date: string; // "YYYY-MM-DD"
}

type SaveStatus = "idle" | "saving" | "saved";

export function JournalEditor({ date }: JournalEditorProps) {
  const { initialMarkdown, isLoading, persist } = useDailyEntity(date);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (markdown: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveStatus("saving");
      debounceRef.current = setTimeout(() => {
        persist(markdown);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      }, 1000);
    },
    [persist],
  );

  const handleSave = useCallback(
    (markdown: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      persist(markdown);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    [persist],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const displayDate = new Date(date + "T12:00:00").toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (isLoading) {
    return (
      <div className="flex h-full flex-col overflow-hidden px-10 py-6">
        <EditorSkeleton />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-10 py-6" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <h1 className="text-2xl font-bold capitalize" style={{ color: "var(--text-primary)" }}>
          {displayDate}
        </h1>
        {saveStatus !== "idle" && (
          <div className="mt-2 flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            <FloppyDisk size={11} />
            <span className="text-[10px]">
              {saveStatus === "saving" ? "Sauvegarde…" : "Sauvegardé"}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-10 py-6">
        <SupernoteEditor
          key={date}
          initialMarkdown={initialMarkdown}
          onChange={handleChange}
          onSave={handleSave}
          className="min-h-[60vh] w-full"
        />
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="animate-pulse space-y-3 pt-2">
      {[100, 80, 90, 60].map((w, i) => (
        <div
          key={i}
          className="h-4 rounded"
          style={{ width: `${w}%`, backgroundColor: "var(--surface-2)" }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Mettre à jour les deux pages appelantes**

Dans `apps/web/src/app/journal/page.tsx` : supprimer l'import `DAILY_JOURNAL` de `@supernote/templates`, supprimer la fonction `buildInitialMarkdown`, supprimer `const initialMarkdown = useMemo(...)`, et changer :
```tsx
<JournalEditor date={selectedDate} initialMarkdown={initialMarkdown} />
```
en :
```tsx
<JournalEditor date={selectedDate} />
```

Appliquer exactement le même changement dans `apps/web/src/app/journal/[date]/page.tsx` (même fonction `buildInitialMarkdown`, même appel `<JournalEditor date={selectedDate} initialMarkdown={initialMarkdown} />` à simplifier).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. Si erreur sur un import désormais inutilisé (`DAILY_JOURNAL`, `useMemo`), le retirer.

- [ ] **Step 6: Vérification manuelle**

Run: `pnpm dev`, ouvrir `/journal` dans le navigateur.
1. Taper du texte, attendre ~1.5s → "Sauvegardé" apparaît.
2. Recharger la page (F5) → le texte tapé est toujours là (preuve que ce n'était plus un placeholder).
3. Naviguer vers une autre date via le calendrier, taper autre chose, revenir à la date précédente → chaque date garde son propre contenu.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/useDailyEntity.ts apps/web/src/components/journal/JournalEditor.tsx apps/web/src/app/journal/page.tsx "apps/web/src/app/journal/[date]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(journal): persistance réelle des entrées quotidiennes

Le save de JournalEditor était un placeholder console.log et le contenu
n'était jamais rechargé — chaque visite repartait du gabarit vierge.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CdKzGivuUCBMXpDEjy8VDv
EOF
)"
```

---

### Task 2: Promotion de la route d'accueil

`/journal` est aujourd'hui gatée par un système de plugins opt-in (`usePluginEnabled("journal", false)`), avec une entrée `Settings → Plugins` dédiée. La rendre accueil par défaut rend ce toggle incohérent (il resterait affiché mais n'aurait plus d'effet) — ce Task retire donc le plugin "journal" complètement plutôt que de le contourner.

**Files:**
- Create: `apps/web/src/app/dev/writing-surface/page.tsx`
- Delete: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/lib/navigation/catalog.ts`
- Modify: `apps/web/src/hooks/usePluginEnabled.ts`
- Modify: `apps/web/src/components/shell/Sidebar.tsx`
- Modify: `apps/web/src/components/shell/mobile/MoreDrawer.tsx`

**Interfaces:**
- Consumes : rien de nouveau — uniquement du retrait/déplacement de code existant.
- Produces : rien de nouveau exposé à d'autres tâches.

- [ ] **Step 1: Déplacer l'ancien accueil vers une route de debug**

Créer `apps/web/src/app/dev/writing-surface/page.tsx` :

```tsx
"use client";

import { AppShell } from "@/components/shell";
import { WritingSurface } from "@/components/writing-surface";

/**
 * Banc de test éditeur sans vault — anciennement `/` (accueil). Déplacé ici
 * quand `/journal` a pris la place d'accueil ; toujours utile pour déboguer
 * l'éditeur en isolation (cf. mémoire projet « boucle debug éditeur »).
 */
export default function WritingSurfaceDevPage() {
  return (
    <AppShell>
      <WritingSurface />
    </AppShell>
  );
}
```

Supprimer `apps/web/src/app/page.tsx`.

- [ ] **Step 2: Router — accueil et 404 pointent vers le Journal, nouvelle route de debug**

Dans `apps/web/src/router.tsx`, remplacer :
```tsx
      // ── Home ──────────────────────────────────────────────────────────
      { index: true, lazy: lazyPage(() => import("./app/page")) },
```
par :
```tsx
      // ── Home (le Journal du jour — voir docs/superpowers/specs/2026-09-03-flux-journal-design.md) ──
      { index: true, lazy: lazyPage(() => import("./app/journal/page")) },
```

Remplacer :
```tsx
      // ── 404 fallback ──────────────────────────────────────────────────
      // Returns the home page on unknown URLs. Replace with a dedicated
      // not-found component if/when one is added.
      { path: "*", lazy: lazyPage(() => import("./app/page")) },
```
par :
```tsx
      // ── 404 fallback ──────────────────────────────────────────────────
      // Returns the home page on unknown URLs. Replace with a dedicated
      // not-found component if/when one is added.
      { path: "*", lazy: lazyPage(() => import("./app/journal/page")) },
```

Ajouter, dans la section « Misc top-level routes » (à côté de `command-demo`) :
```tsx
      { path: "dev/writing-surface", lazy: lazyPage(() => import("./app/dev/writing-surface/page")) },
```

- [ ] **Step 3: Retirer le plugin "journal" du catalogue et du système de gates**

Dans `apps/web/src/lib/navigation/catalog.ts` :
- Ligne 42, remplacer `export type NavGate = "journal" | "routines" | "mail";` par `export type NavGate = "routines" | "mail";`
- Ligne 80, supprimer entièrement la ligne `{ href: "/journal", labelKey: "nav.journal", icon: Calendar, group: "knowledge", gate: "journal" },`
- Si `Calendar` (import `@phosphor-icons/react`) n'est plus utilisé ailleurs dans ce fichier après ce retrait, retirer l'import.

Dans `apps/web/src/hooks/usePluginEnabled.ts` :
- Retirer l'objet `{ slug: "journal", defaultOn: false, name: "Journal", description: "..." }` du tableau `BUILT_IN_PLUGINS`.
- Retirer `journal: "/journal",` de `PLUGIN_HREF_BY_SLUG`.

Dans `apps/web/src/components/shell/Sidebar.tsx` :
- Retirer la ligne `const journalEnabled = usePluginEnabled("journal", false);`
- Dans l'objet `gateEnabled: Record<NavGate, boolean>`, retirer la clé `journal: journalEnabled,`
- Dans le tableau de dépendances de `isItemVisible` (`useCallback`), retirer `journalEnabled`.

Dans `apps/web/src/components/shell/mobile/MoreDrawer.tsx` :
- Mêmes retraits : la ligne `usePluginEnabled("journal", false)`, la clé `journal: journalEnabled` dans `gateEnabled`.

- [ ] **Step 4: Vérifier qu'aucun autre code ne dépend du plugin "journal"**

Run: `grep -rn '"journal"' apps/web/src --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "/app/journal/" | grep -v "components/journal"`
Expected: seules restent des occurrences non liées au gate plugin (ex. `commands/seed.ts` mots-clés de recherche, `recherche/page.tsx` / `FilterChips.tsx` valeurs de filtre `type:"journal"`, `QuickActionsStrip.tsx` action rapide) — aucune ne référence plus `usePluginEnabled`/`gate:"journal"`/`BUILT_IN_PLUGINS`. Si une occurrence inattendue apparaît, l'investiguer avant de continuer.

- [ ] **Step 5: Vérifier l'onglet Réglages → Plugins**

Ouvrir `apps/web/src/components/settings/tabs/PluginsTab.tsx` et confirmer que le rendu itère sur `BUILT_IN_PLUGINS` (`.map(...)`) plutôt que de coder chaque plugin en dur. Si c'est le cas, aucune modification n'est nécessaire ici — la ligne "Journal" disparaît automatiquement de l'écran Réglages avec le retrait fait au Step 3. Si le composant référence `"journal"` en dur, l'ajuster pour retirer cette référence.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Vérification manuelle**

Run: `pnpm dev`.
1. `/` affiche le Journal du jour (pas le WritingSurface).
2. `/une-route-inexistante` affiche aussi le Journal (404 fallback).
3. `/dev/writing-surface` affiche l'ancien banc de test éditeur.
4. Sidebar desktop et `MoreDrawer` mobile n'affichent plus d'entrée "Journal" séparée (elle est devenue "Accueil").
5. Réglages → Plugins n'affiche plus de ligne "Journal".
6. Bottom nav mobile : l'onglet "Accueil" (icône maison) ouvre bien le Journal.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/dev/writing-surface/page.tsx apps/web/src/router.tsx apps/web/src/lib/navigation/catalog.ts apps/web/src/hooks/usePluginEnabled.ts apps/web/src/components/shell/Sidebar.tsx apps/web/src/components/shell/mobile/MoreDrawer.tsx
git add -u apps/web/src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(nav): le Journal devient l'accueil par défaut

Retire le plugin opt-in "journal" (devenu incohérent une fois /journal
promu accueil) plutôt que de le contourner. L'ancien accueil
(WritingSurface, banc de test éditeur) reste accessible à /dev/writing-surface.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CdKzGivuUCBMXpDEjy8VDv
EOF
)"
```

---

### Task 3: Candidats de mention (contacts existants)

**Files:**
- Create: `apps/web/src/hooks/useMentionCandidates.ts`

**Interfaces:**
- Consumes : `trpc.entities.list.useQuery` (existant) ; `EntityRef` de `@supernote/ai` (existant — ⚠️ ne pas confondre avec le `EntityRef` distinct exporté par `@supernote/editor`, forme différente).
- Produces : `useMentionCandidates(): EntityRef[]` (forme `{id, name, aliases?, typeId}`) — consommé par `useJournalExtraction` (Task 5).

- [ ] **Step 1: Créer le hook**

```ts
// apps/web/src/hooks/useMentionCandidates.ts
"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import type { EntityRef } from "@supernote/ai";

const CANDIDATE_LIMIT = 500;

function fieldToName(fields: Record<string, unknown>): string {
  const raw = fields["name"];
  return typeof raw === "string" ? raw : "";
}

function fieldToAliases(fields: Record<string, unknown>): string[] {
  const raw = fields["aliases"];
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Contacts (personne + organisation) existants du vault, formatés pour
 * `extractEntityMentions` de `@supernote/ai`. Ne couvre QUE les entités déjà
 * connues — l'extracteur ne propose pas de créer une entité inconnue
 * (limite documentée dans la spec).
 */
export function useMentionCandidates(): EntityRef[] {
  const personnes = trpc.entities.list.useQuery(
    { typeId: "personne", limit: CANDIDATE_LIMIT },
    { staleTime: 30_000 },
  );
  const organisations = trpc.entities.list.useQuery(
    { typeId: "organisation", limit: CANDIDATE_LIMIT },
    { staleTime: 30_000 },
  );

  return useMemo(() => {
    const items = [...(personnes.data?.items ?? []), ...(organisations.data?.items ?? [])];
    const refs: EntityRef[] = [];
    for (const item of items) {
      const name = fieldToName(item.fields);
      if (!name) continue;
      refs.push({
        id: item.id,
        name,
        aliases: fieldToAliases(item.fields),
        typeId: item.typeId,
      });
    }
    return refs;
  }, [personnes.data, organisations.data]);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useMentionCandidates.ts
git commit -m "$(cat <<'EOF'
feat(journal): hook des contacts candidats à la liaison de mention

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CdKzGivuUCBMXpDEjy8VDv
EOF
)"
```

---

### Task 4: Orchestration de l'extraction (lib pure)

`@supernote/ai` fournit déjà `createActionExtractor()` (Ollama + repli heuristique), utilisé aujourd'hui uniquement par `lib/mail-ai.ts`. Ce Task le branche pour le Journal — aucune nouvelle logique d'extraction, seulement l'assemblage.

**Files:**
- Create: `apps/web/src/lib/ai/journal-extract.ts`

**Interfaces:**
- Consumes : `createActionExtractor`, `createOllamaClient` (`@supernote/ai`, existants) ; `getAiSettings` (`apps/web/src/lib/ai/settings.ts`, existant, retourne `{baseUrl, model}`).
- Produces : `runJournalExtraction(text: string, candidates: EntityRef[]): Promise<{mentions: MentionMatch[]; actions: ExtractedAction[]}>` — consommé par `useJournalExtraction` (Task 5).

- [ ] **Step 1: Créer le module**

```ts
// apps/web/src/lib/ai/journal-extract.ts
import { createActionExtractor, createOllamaClient } from "@supernote/ai";
import type { EntityRef, ExtractedAction, MentionMatch } from "@supernote/ai";
import { getAiSettings } from "./settings";

export interface JournalExtractionResult {
  mentions: MentionMatch[];
  actions: ExtractedAction[];
}

const EMPTY_RESULT: JournalExtractionResult = { mentions: [], actions: [] };

/**
 * Passe d'extraction sur le texte du jour. Dégrade silencieusement (résultat
 * vide) si l'IA locale n'est pas configurée du tout — `createActionExtractor`
 * gère déjà en interne le repli heuristique quand Ollama tourne mais ne
 * répond pas / n'a pas de résultat.
 */
export async function runJournalExtraction(
  text: string,
  candidates: EntityRef[],
): Promise<JournalExtractionResult> {
  if (!text.trim()) return EMPTY_RESULT;

  const { baseUrl, model } = getAiSettings();
  if (!baseUrl?.trim() || !model?.trim()) return EMPTY_RESULT;

  const ollama = createOllamaClient({ baseUrl, defaultModel: model });
  const extractor = createActionExtractor({ ollama });

  const [mentions, actions] = await Promise.all([
    candidates.length > 0 ? extractor.extractEntityMentions(text, candidates) : Promise.resolve([]),
    extractor.extractActions(text),
  ]);

  return { mentions, actions };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Vérification manuelle isolée**

Dans la console du navigateur (`pnpm dev`, n'importe quelle page), après avoir configuré un modèle Ollama dans Réglages → IA Ollama et vérifié `ollama serve` actif localement :
```js
const mod = await import("/src/lib/ai/journal-extract.ts");
await mod.runJournalExtraction("Je dois rappeler Julie d'ici vendredi", []);
```
Expected : un objet `{ mentions: [], actions: [{ text: "rappeler Julie", ... }] }` (ou repli heuristique équivalent si Ollama indisponible — la fonction ne doit jamais rejeter/throw).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/ai/journal-extract.ts
git commit -m "$(cat <<'EOF'
feat(ai): orchestration d'extraction pour le Journal

Branche l'extracteur @supernote/ai (déjà utilisé pour le mail) sur le
texte du journal — aucune nouvelle logique d'extraction, uniquement
l'assemblage et le repli silencieux si l'IA locale n'est pas configurée.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CdKzGivuUCBMXpDEjy8VDv
EOF
)"
```

---

### Task 5: Hook de suggestions + panneau d'acceptation

**Files:**
- Create: `apps/web/src/hooks/useJournalExtraction.ts`
- Create: `apps/web/src/components/journal/ExtractionSuggestions.tsx`
- Modify: `apps/web/src/components/journal/index.ts`

**Interfaces:**
- Consumes : `runJournalExtraction` (Task 4) ; `useMentionCandidates` (Task 3) ; `trpc.entities.create.useMutation` (existant) ; `MentionMatch`/`ExtractedAction` types de `@supernote/ai`.
- Produces : `useJournalExtraction(dailyEntityId: string | null): { suggestions: JournalSuggestion[]; trigger: (text: string) => void; dismissMention: (key: string) => void; acceptAction: (s: ActionSuggestion) => void }` et le composant `<ExtractionSuggestions>` — tous deux consommés par `JournalEditor` (Task 6). Types `JournalSuggestion`/`MentionSuggestion`/`ActionSuggestion` exportés du hook.

- [ ] **Step 1: Créer le hook**

```ts
// apps/web/src/hooks/useJournalExtraction.ts
"use client";

import { useCallback, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { runJournalExtraction } from "@/lib/ai/journal-extract";
import { useMentionCandidates } from "./useMentionCandidates";
import type { ExtractedAction, MentionMatch } from "@supernote/ai";

export interface MentionSuggestion {
  kind: "mention";
  key: string;
  match: MentionMatch;
}
export interface ActionSuggestion {
  kind: "action";
  key: string;
  action: ExtractedAction;
}
export type JournalSuggestion = MentionSuggestion | ActionSuggestion;

interface UseJournalExtractionResult {
  suggestions: JournalSuggestion[];
  /** À appeler depuis le tick debounce existant de l'éditeur (Task 6). */
  trigger: (text: string) => void;
  /** Retire une suggestion de mention SANS toucher au texte (accept géré à part, Task 6). */
  dismissMention: (key: string) => void;
  acceptAction: (suggestion: ActionSuggestion) => void;
}

export function useJournalExtraction(dailyEntityId: string | null): UseJournalExtractionResult {
  const candidates = useMentionCandidates();
  const [suggestions, setSuggestions] = useState<JournalSuggestion[]>([]);
  const runIdRef = useRef(0);
  const createTodo = trpc.entities.create.useMutation();

  const trigger = useCallback(
    (text: string) => {
      const runId = ++runIdRef.current;
      void runJournalExtraction(text, candidates).then((result) => {
        // Une frappe plus récente a déjà relancé une passe — ignorer ce résultat périmé.
        if (runId !== runIdRef.current) return;
        const next: JournalSuggestion[] = [
          ...result.mentions.map(
            (match): MentionSuggestion => ({
              kind: "mention",
              key: `mention:${match.entityId}:${match.startOffset}`,
              match,
            }),
          ),
          ...result.actions.map(
            (action, i): ActionSuggestion => ({
              kind: "action",
              key: `action:${i}:${action.text}`,
              action,
            }),
          ),
        ];
        setSuggestions(next);
      });
    },
    [candidates],
  );

  const dismissMention = useCallback((key: string) => {
    setSuggestions((prev) => prev.filter((s) => s.key !== key));
  }, []);

  const acceptAction = useCallback(
    (suggestion: ActionSuggestion) => {
      void createTodo.mutateAsync({
        typeId: "todo",
        fields: {
          text: suggestion.action.text,
          done: false,
          importance: suggestion.action.priority,
          ...(suggestion.action.deadline ? { dueDate: suggestion.action.deadline } : {}),
          ...(dailyEntityId ? { sourceNoteId: dailyEntityId } : {}),
        },
      });
      dismissMention(suggestion.key);
    },
    [createTodo, dailyEntityId, dismissMention],
  );

  return { suggestions, trigger, dismissMention, acceptAction };
}
```

Note : `suggestion.action.deadline` vient de l'extracteur (regex ou LLM) et n'est pas toujours un ISO propre (ex. "12/09", "vendredi"). Le champ `todo.dueDate` (kind `date`) l'affichera tel quel — normalisation non traitée dans ce plan (hors scope v1, cf. spec).

- [ ] **Step 2: Créer le composant de suggestions**

```tsx
// apps/web/src/components/journal/ExtractionSuggestions.tsx
"use client";

import { Chip } from "@heroui/react";
import { Button, Tooltip } from "@supernote/ui";
import { Check, X } from "@phosphor-icons/react";
import type { ActionSuggestion, JournalSuggestion, MentionSuggestion } from "@/hooks/useJournalExtraction";

interface ExtractionSuggestionsProps {
  suggestions: JournalSuggestion[];
  onAcceptMention: (suggestion: MentionSuggestion) => void;
  onAcceptAction: (suggestion: ActionSuggestion) => void;
  onReject: (key: string) => void;
}

/**
 * Rendu EN DEHORS du DOM de l'éditeur (sibling dans JournalEditor, jamais
 * enfant) — le subtree ProseMirror ne doit jamais recevoir de mutation DOM
 * externe (piège MutationObserver documenté sur ce projet).
 */
export function ExtractionSuggestions({
  suggestions,
  onAcceptMention,
  onAcceptAction,
  onReject,
}: ExtractionSuggestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-t px-4 py-3 md:px-10"
      style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
      aria-label="Suggestions d'extraction"
    >
      {suggestions.map((s) => (
        <Chip key={s.key} variant="flat" className="gap-2 py-1">
          <span className="text-xs">
            {s.kind === "mention" ? `${s.match.entityName} → lier ?` : `${s.action.text} → créer une tâche ?`}
          </span>
          <Tooltip content="Accepter">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Accepter la suggestion"
              onPress={() => (s.kind === "mention" ? onAcceptMention(s) : onAcceptAction(s))}
            >
              <Check size={14} />
            </Button>
          </Tooltip>
          <Tooltip content="Ignorer">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Ignorer la suggestion"
              onPress={() => onReject(s.key)}
            >
              <X size={14} />
            </Button>
          </Tooltip>
        </Chip>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Vérifier les props réelles de `Button`/`Chip` avant typecheck**

Lire `packages/ui/src/components/button/index.ts` (props `size`/`variant` acceptées) et un usage existant de `Chip` HeroUI dans le repo (`grep -rn "from \"@heroui/react\"" apps/web/src/components/bases | grep -i chip` par exemple). Ajuster les valeurs de `size`/`variant` du Step 2 si elles diffèrent de l'API réelle (ex. `variant="ghost"` pourrait être `variant="light"` selon la version).

- [ ] **Step 4: Exporter depuis le barrel du dossier**

Modifier `apps/web/src/components/journal/index.ts` :
```ts
export { JournalCalendar } from "./JournalCalendar";
export { JournalEditor } from "./JournalEditor";
export { JournalSidebar } from "./JournalSidebar";
export { ExtractionSuggestions } from "./ExtractionSuggestions";
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useJournalExtraction.ts apps/web/src/components/journal/ExtractionSuggestions.tsx apps/web/src/components/journal/index.ts
git commit -m "$(cat <<'EOF'
feat(journal): hook et panneau de suggestions d'extraction

Chips accept/reject pour les mentions de contacts existants et les
actions détectées — zéro création silencieuse.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CdKzGivuUCBMXpDEjy8VDv
EOF
)"
```

---

### Task 6: Intégration complète dans JournalEditor

Cœur technique du Task : `SupernoteEditorApi` n'expose que `insertAtCursor` (insertion au caret) et `restoreCaret(blockId)` — **aucune méthode ne remplace un span à un offset arbitraire**. Une mention acceptée est donc appliquée en réécrivant la chaîne markdown côté client puis en remontant l'éditeur avec le contenu mis à jour (clé bumpée) — pas en mutant le DOM de l'éditeur en place. Compromis assumé : le curseur peut sauter après acceptation d'une mention (pas après une action, qui ne touche pas l'éditeur).

**Files:**
- Modify: `apps/web/src/components/journal/JournalEditor.tsx`

**Interfaces:**
- Consumes : `useDailyEntity` (Task 1), `useJournalExtraction` + `ExtractionSuggestions` (Task 5).
- Produces : rien de nouveau — c'est la tâche d'intégration finale de la fonctionnalité.

- [ ] **Step 1: Remplacer `JournalEditor.tsx` par la version intégrée**

```tsx
// apps/web/src/components/journal/JournalEditor.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FloppyDisk } from "@phosphor-icons/react";
import type { SupernoteEditorProps } from "@supernote/editor";
import { useDailyEntity } from "@/hooks/useDailyEntity";
import { useJournalExtraction, type ActionSuggestion, type MentionSuggestion } from "@/hooks/useJournalExtraction";
import { ExtractionSuggestions } from "./ExtractionSuggestions";
import type { MentionMatch } from "@supernote/ai";

const SupernoteEditor = dynamic<SupernoteEditorProps>(
  () => import("@supernote/editor").then((m) => ({ default: m.SupernoteEditor })),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

interface JournalEditorProps {
  date: string; // "YYYY-MM-DD"
}

type SaveStatus = "idle" | "saving" | "saved";

export function JournalEditor({ date }: JournalEditorProps) {
  const { entityId, initialMarkdown, isLoading, persist } = useDailyEntity(date);
  const extraction = useJournalExtraction(entityId);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dernier markdown envoyé à l'extraction — sert de base à la réécriture
  // d'une mention acceptée (les offsets de MentionMatch ont été calculés
  // contre CE texte, pas nécessairement le texte affiché à l'instant T).
  const lastExtractedTextRef = useRef<string>(initialMarkdown);

  // Contenu poussé programmatiquement (après acceptation d'une mention) —
  // force un remount de <SupernoteEditor> via une clé bumpée. `null` tant
  // qu'aucune mention n'a été acceptée : on affiche alors `initialMarkdown`.
  const [override, setOverride] = useState<{ markdown: string; rev: number } | null>(null);

  const handleChange = useCallback(
    (markdown: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveStatus("saving");
      debounceRef.current = setTimeout(() => {
        persist(markdown);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
        lastExtractedTextRef.current = markdown;
        extraction.trigger(markdown);
      }, 1000);
    },
    [persist, extraction],
  );

  const handleSave = useCallback(
    (markdown: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      persist(markdown);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      lastExtractedTextRef.current = markdown;
      extraction.trigger(markdown);
    },
    [persist, extraction],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleAcceptMention = useCallback(
    (suggestion: MentionSuggestion) => {
      const match: MentionMatch = suggestion.match;
      const base = lastExtractedTextRef.current;
      const slice = base.slice(match.startOffset, match.endOffset);
      if (slice !== match.matchedText) {
        // Le texte a bougé depuis l'extraction (l'utilisateur a continué à
        // taper) — on abandonne plutôt que de réécrire au mauvais endroit.
        extraction.dismissMention(suggestion.key);
        return;
      }
      const rewritten =
        base.slice(0, match.startOffset) + `[[${match.entityName}]]` + base.slice(match.endOffset);
      lastExtractedTextRef.current = rewritten;
      setOverride((prev) => ({ markdown: rewritten, rev: (prev?.rev ?? 0) + 1 }));
      persist(rewritten);
      extraction.dismissMention(suggestion.key);
    },
    [persist, extraction],
  );

  const handleAcceptAction = useCallback(
    (suggestion: ActionSuggestion) => {
      extraction.acceptAction(suggestion);
    },
    [extraction],
  );

  const displayDate = new Date(date + "T12:00:00").toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (isLoading) {
    return (
      <div className="flex h-full flex-col overflow-hidden px-10 py-6">
        <EditorSkeleton />
      </div>
    );
  }

  const displayedMarkdown = override?.markdown ?? initialMarkdown;
  const editorKey = `${date}-${override?.rev ?? 0}`;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-10 py-6" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <h1 className="text-2xl font-bold capitalize" style={{ color: "var(--text-primary)" }}>
          {displayDate}
        </h1>
        {saveStatus !== "idle" && (
          <div className="mt-2 flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            <FloppyDisk size={11} />
            <span className="text-[10px]">
              {saveStatus === "saving" ? "Sauvegarde…" : "Sauvegardé"}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-10 py-6">
        <SupernoteEditor
          key={editorKey}
          initialMarkdown={displayedMarkdown}
          onChange={handleChange}
          onSave={handleSave}
          className="min-h-[60vh] w-full"
        />
      </div>

      <ExtractionSuggestions
        suggestions={extraction.suggestions}
        onAcceptMention={handleAcceptMention}
        onAcceptAction={handleAcceptAction}
        onReject={extraction.dismissMention}
      />
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="animate-pulse space-y-3 pt-2">
      {[100, 80, 90, 60].map((w, i) => (
        <div
          key={i}
          className="h-4 rounded"
          style={{ width: `${w}%`, backgroundColor: "var(--surface-2)" }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Vérification manuelle (nécessite Ollama configuré et lancé)**

Run: `pnpm dev`, ouvrir `/` (accueil = Journal).
1. Créer un contact "Test Julie" via `/contacts/nouveau`.
2. Revenir sur `/`, écrire « Vu Test Julie ce matin » dans le journal, attendre ~1-2s.
3. Une chip « Test Julie → lier ? » apparaît sous l'éditeur.
4. Cliquer le check → le texte devient `[[Test Julie]]` dans l'éditeur (rendu en lien par BlockNote), la chip disparaît.
5. Écrire « je dois rappeler Paul demain » → une chip « rappeler Paul → créer une tâche ? » apparaît ; l'accepter → vérifier sur `/todos` qu'une tâche "rappeler Paul" existe.
6. Couper Ollama (`Réglages → IA Ollama`, vider le modèle, ou arrêter `ollama serve`) → retaper du texte → aucune erreur visible, aucune chip (repli silencieux).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/journal/JournalEditor.tsx
git commit -m "$(cat <<'EOF'
feat(journal): intègre les suggestions d'extraction dans l'éditeur

Persistance + extraction partagent le même debounce. Une mention
acceptée réécrit le markdown et remonte l'éditeur (clé bumpée) plutôt
que de muter son DOM — SupernoteEditorApi ne permet pas de remplacer
un span à un offset arbitraire.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CdKzGivuUCBMXpDEjy8VDv
EOF
)"
```

---

### Task 7: Capture rapide unifiée

`/capture` (`apps/web/src/app/capture/page.tsx`) cible une `BrowserWindow` Electron absente du repo — routée mais liée nulle part, `window.close()` est un no-op dans un onglet. Remplacée par un raccourci global + overlay flottant qui écrit dans l'entrée du jour.

**Files:**
- Delete: `apps/web/src/app/capture/page.tsx`
- Modify: `apps/web/src/router.tsx` (retirer la route `capture`)
- Create: `apps/web/src/components/command/QuickCaptureOverlay.tsx`
- Modify: `apps/web/src/components/command/CommandSurface.tsx`

**Interfaces:**
- Consumes : `useDailyEntity` (Task 1) ; `useShortcut` (`@/lib/keyboard/hooks`, existant).
- Produces : rien de nouveau exposé.

- [ ] **Step 1: Supprimer la route morte**

Supprimer `apps/web/src/app/capture/page.tsx`.

Dans `apps/web/src/router.tsx`, supprimer la ligne :
```tsx
      { path: "capture", lazy: lazyPage(() => import("./app/capture/page")) },
```

- [ ] **Step 2: Créer l'overlay de capture**

```tsx
// apps/web/src/components/command/QuickCaptureOverlay.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TextArea } from "@heroui/react";
import { useDailyEntity } from "@/hooks/useDailyEntity";

function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface QuickCaptureOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Remplace l'ancienne popup `/capture` (Electron, morte depuis le pivot
 * SPA). Écrit directement dans l'entrée du jour au lieu d'un Inbox séparé —
 * cohérent avec le pari « flux » (tout part du journal).
 */
export function QuickCaptureOverlay({ isOpen, onClose }: QuickCaptureOverlayProps) {
  const today = todayYMD();
  const { initialMarkdown, isLoading, persist } = useDailyEntity(today);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraft("");
    setStatus("idle");
    const t = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [isOpen]);

  const submit = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || isLoading) {
      onClose();
      return;
    }
    setStatus("saving");
    const separator = initialMarkdown.trim().length > 0 ? "\n\n" : "";
    persist(`${initialMarkdown}${separator}${trimmed}`);
    setStatus("done");
    setTimeout(onClose, 400);
  }, [draft, initialMarkdown, isLoading, onClose, persist]);

  // Esc géré ICI, pas via useShortcut : le premier "esc" global enregistré
  // (palette.close dans CommandSurface) intercepte toujours la combinaison
  // en premier et ne relaie jamais aux suivants (ShortcutProvider,
  // "first match wins" — cf. commentaire dans CommandSurface.tsx). Même
  // pattern que l'ancienne popup /capture.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    },
    [onClose, submit],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        className="flex w-full flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ maxWidth: 560, backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Capture rapide — entrée du jour
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            <kbd className="font-mono">Esc</kbd> Annuler · <kbd className="font-mono">⌘ Entrée</kbd> Enregistrer
          </span>
        </div>
        <TextArea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Capture rapide…"
          rows={5}
          disabled={status !== "idle"}
          className="resize-none px-4 py-3 text-sm outline-none"
          aria-label="Contenu de la capture"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Vérifier le token z-index**

Run: `grep -n "\-\-z-" packages/ui/src/tokens.css`
Remplacer `z-50` (classe Tailwind arbitraire utilisée au Step 2) par le token réel trouvé (ex. `style={{ zIndex: "var(--z-modal)" }}` en plus de/à la place de la classe Tailwind) — cohérence avec le reste du design system plutôt qu'un literal.

- [ ] **Step 4: Brancher le raccourci et l'overlay dans `CommandSurface`**

Dans `apps/web/src/components/command/CommandSurface.tsx`, ajouter l'import :
```tsx
import { QuickCaptureOverlay } from "./QuickCaptureOverlay";
```

Ajouter l'état, à côté de `unifiedOpen` :
```tsx
const [captureOpen, setCaptureOpen] = useState(false);
```

Ajouter un nouveau `useShortcut`, à la suite du bloc `search.unified` (avant le commentaire "Cmd+N") :
```tsx
  // Cmd+Shift+N — capture rapide dans l'entrée du jour. Combo libre au
  // scope global (aucun conflit — cf. les combos déjà pris listés plus haut).
  useShortcut({
    id: "capture.open",
    keys: "mod+shift+n",
    scope: "global",
    description: "Capture rapide dans l'entrée du jour",
    handler: () => {
      setCaptureOpen(true);
      return true;
    },
  });
```

Ajouter le rendu, dans le retour JSX, à côté de `<UnifiedSearchModal ... />` :
```tsx
      <QuickCaptureOverlay isOpen={captureOpen} onClose={() => setCaptureOpen(false)} />
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Vérification manuelle**

Run: `pnpm dev`.
1. Depuis n'importe quelle page (pas seulement `/`), presser Cmd/Ctrl+Shift+N → l'overlay s'ouvre, focus dans le textarea.
2. Taper du texte, Cmd/Ctrl+Entrée → overlay se ferme.
3. Naviguer vers `/` (Journal du jour) → le texte capturé apparaît à la fin de l'entrée du jour.
4. Rouvrir l'overlay, taper du texte, Esc → overlay se ferme SANS rien enregistrer (vérifier que l'entrée du jour n'a pas changé).
5. Naviguer manuellement vers `/capture` dans la barre d'adresse → 404 fallback (Journal), pas d'erreur de chunk.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/command/QuickCaptureOverlay.tsx apps/web/src/components/command/CommandSurface.tsx apps/web/src/router.tsx
git add -u apps/web/src/app/capture/page.tsx
git commit -m "$(cat <<'EOF'
feat(command): capture rapide unifiée dans l'entrée du jour

Remplace /capture (popup Electron morte depuis le pivot SPA, jamais
liée nulle part) par un raccourci global + overlay qui écrit dans le
Journal au lieu d'un Inbox déconnecté.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CdKzGivuUCBMXpDEjy8VDv
EOF
)"
```

---

### Task 8: Vérification finale

**⚠️ Constat sur le harness e2e existant (découvert pendant ce plan, hors scope pour le corriger ici) :** les 7 specs de `tests/e2e/` (`01-bootstrap.spec.ts` à `07-finance-dashboard.spec.ts`) et `playwright.config.ts` ciblent exclusivement l'ancienne architecture Electron (`tryLaunchApp`, `window.__supernoteIPC`, un seul projet Playwright `"electron"`, pas de `webServer`). `isElectronAvailable()` fait un check statique (binaire + dist Electron) qui échoue systématiquement dans ce repo (SPA web, aucun dossier `electron/`) — en pratique, **`pnpm test:e2e` skip actuellement 100% de ses assertions**, silencieusement, sur toute la suite (pas seulement les tests visés par ce plan). Moderniser ce harness (nouveau projet Playwright en mode navigateur, `webServer` pointant sur le dev server, réécriture de `helpers.ts` et des 7 specs) est un chantier séparé, non couvert par la spec approuvée pour cette fonctionnalité — à proposer comme suite si l'utilisateur le souhaite. Ce Task s'appuie donc sur la vérification manuelle au navigateur, seule vérification qui ait un sens dans l'état actuel du repo.

**Files:** aucun changement de code — vérification uniquement.

- [ ] **Step 1: Typecheck complet**

Run: `pnpm typecheck`
Expected: PASS sur tout le monorepo (pas seulement les fichiers touchés par ce plan).

- [ ] **Step 2: Rebuild des packages consommés en dist si nécessaire**

Si `pnpm typecheck` échoue avec des erreurs qui semblent « fantômes » (types obsolètes de `@supernote/ai`, `@supernote/editor`, `@supernote/ui`) :
Run: `pnpm --filter @supernote/ai build && pnpm --filter @supernote/editor build && pnpm --filter @supernote/ui build`
Puis relancer `pnpm typecheck`.

- [ ] **Step 3: Parcours manuel bout-en-bout**

Run: `pnpm dev`. Dérouler dans l'ordre :
1. `/` affiche le Journal du jour, pas WritingSurface (Task 2).
2. Écrire un paragraphe, recharger la page → contenu conservé (Task 1).
3. Mentionner un contact existant en texte libre → chip → accepter → lien créé (Task 5/6).
4. Écrire une action ("je dois...") → chip → accepter → todo visible sur `/todos` (Task 5/6).
5. Rejeter une chip → aucune création (Task 5/6).
6. Cmd/Ctrl+Shift+N depuis `/notes` → overlay → texte → apparaît dans le Journal du jour (Task 7).
7. Mobile (`pnpm dev`, réduire la fenêtre sous 768px ou DevTools mode mobile) : bottom nav "Accueil" ouvre le Journal, FAB visible et fonctionnel, l'overlay de capture reste utilisable au toucher (pas de débordement horizontal, cible tactile ≥32px).
8. Couper Ollama → tout ce qui précède continue de fonctionner (juste sans chips IA) — pas d'erreur console, pas de toast d'erreur.

- [ ] **Step 4: Rapporter l'état à l'utilisateur**

Ce Step n'a pas de commande — c'est un rappel : signaler explicitement le constat du harness e2e (Step préambule ci-dessus) plutôt que de le laisser passer inaperçu, et confirmer chaque point du Step 3 comme vérifié ou en échec.

---

## Self-review (fait par l'auteur du plan)

**Couverture spec → tâches :**
- Décision 1 (promotion accueil) → Task 2. ✓
- Décision 2 (extraction avec confirmation) → Tasks 3, 4, 5, 6. ✓
- Décision 3 (capture unifiée) → Task 7. ✓
- Prérequis découvert en cours de route (persistance réelle absente) → Task 1, ajouté explicitement avec justification. ✓
- Tests e2e listés dans la spec → couverts par la vérification manuelle du Task 8 ; limite du harness signalée plutôt que masquée. ✓

**Cohérence des types entre tâches :** `EntityRef` (Task 3, `@supernote/ai`) → consommé identique en Task 4/5. `MentionMatch`/`ExtractedAction` (Task 4) → réutilisés tels quels en Task 5/6, aucun renommage de champ en cours de route. `useDailyEntity` (Task 1) : signature `{entityId, initialMarkdown, isLoading, persist}` utilisée à l'identique en Task 6 et Task 7 — pas de dérive.

**Placeholders :** aucun "TBD" laissé ; les deux points où l'exécutant doit lire une source avant d'écrire (props exactes de `Button`/`Chip` en Task 5 Step 3, token z-index en Task 7 Step 3) sont des lookups concrets avec commande `grep` fournie, pas des zones vagues.
