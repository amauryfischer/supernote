# Engagements mail — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** l'IA locale détecte les promesses dans les fils mail et les propose en suggestions. Un clic en fait une todo datée et liée au fil (« Je dois ») ou arme une relance (« On me doit »).

**Architecture :** une entité système `mail_commitment` par fil, écrite par le worker (route `mail.setCommitments`), synchronisée, hors FTS. La logique pure (prompt, parsing, gardes, fusion) vit dans `lib/mail-commitments.ts`. Deux déclencheurs de détection : un runner de fond monté dans le shell, et l'ouverture d'un fil. L'UI tient en un bandeau dans `EmailThreadView` et une section dans `TodayPanel`.

**Tech Stack :** React 19, tRPC en browser-link vers un Web Worker SQLite, `@supernote/ipc` (zod, consommé via `dist/`), Ollama via `runLocalPrompt`, HeroUI v3 via `@supernote/ui`, Playwright.

**Spec :** `docs/superpowers/specs/2026-09-26-engagements-mail-design.md`

## Global Constraints

- Politique **zéro test unitaire** : pas de `*.test.ts`, pas de vitest. Vérification = `pnpm typecheck` + e2e Playwright.
- `@supernote/ipc` est consommé par son `dist/` : après modification, `pnpm build:packages`.
- UI : `@supernote/ui` / HeroUI v3, icônes `@phosphor-icons/react`, boutons icône + `Tooltip` + `aria-label`. Pas de toast : retour porté par le bouton via `useActionFeedback` + `FeedbackIcon` (`lib/action-feedback.tsx`).
- Mobile dans le même lot : hit-targets ≥ 32 px, aucun débordement horizontal à 390 px.
- **Jamais d'IA sur mobile** : toute passe est gardée par `isAiRuntimeAllowed() && isAiConfigured() && commitmentsEnabled()`.
- Rien n'est créé sans clic : l'IA écrit seulement des suggestions `status: "suggested"`.
- Commentaires : seulement le pourquoi non déductible, en français, une ligne.
- Commits conventionnels en français. **Ne pas committer sans demande explicite** (CLAUDE.md projet) : les étapes « Commit » sont à regrouper et à exécuter seulement sur accord.

## Review Focus

1. **Citation paraphrasée par le modèle** : une `quote` qui ne figure pas mot pour mot dans le fil doit être rejetée, jamais affichée. Couvert par l'e2e (tâche 6).
2. **Fil réanalysé après un nouveau message** : une suggestion déjà ignorée ou acceptée ne doit pas réapparaître en `suggested`. Tient à la `key` = `djb2(messageId|quote normalisée)` et à `mergeCommitments` (tâche 2).
3. **Mobile** : le bandeau et la section s'affichent à 390 px sans débordement, et aucun appel Ollama ne part (garde `isAiRuntimeAllowed`). Couvert par l'e2e mobile (tâche 6).
4. **Échéance antérieure à la date d'envoi** (hallucination classique du 4b) : elle est ramenée à `null`, puis au repli `detectDateTime` (tâche 2).
5. **Ollama éteint pendant une passe** : pas de boucle ni d'erreur visible. Cooldown de 60 s, et l'ouverture d'un fil n'affiche rien plutôt qu'une erreur (tâches 3 et 4).

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `apps/web/src/lib/vault-worker/seed-default-types.ts` | + type `mail_commitment` |
| `apps/web/src/lib/vault-worker/worker-router.ts` | `upsertSystemEntity` générique, route `mail.setCommitments`, exclusion FTS à la synchro |
| `packages/ipc/src/schemas/mail.ts`, `packages/ipc/src/router/mail.router.ts` | contrat `mail.setCommitments` |
| `apps/web/src/lib/mail-ai.ts` | `runLocalPrompt` accepte `format: "json"` |
| `apps/web/src/lib/todos/extractChecklists.ts` | export de `djb2` |
| `apps/web/src/lib/mail-commitments.ts` (nouveau) | types, prompt, parsing, gardes, fusion, lecture/écriture, actions |
| `apps/web/src/components/mail/useMailCommitments.ts` (nouveau) | hook de lecture + analyse à l'ouverture d'un fil |
| `apps/web/src/components/mail/CommitmentsRunner.tsx` (nouveau) | passe de fond |
| `apps/web/src/RootLayout.tsx` | montage du runner |
| `apps/web/src/components/mail/CommitmentsBanner.tsx` (nouveau) | bandeau du fil |
| `apps/web/src/components/mail/EmailThreadView.tsx` | insertion du bandeau |
| `apps/web/src/components/mail/CommitmentsTodaySection.tsx` (nouveau) | section du panneau Aujourd'hui |
| `apps/web/src/components/agenda/TodayPanel.tsx` | insertion de la section |
| `tests/e2e/helpers.ts`, `tests/e2e/10-mail-commitments.spec.ts` (nouveau) | flag IA + e2e |

---

### Tâche 1 : stockage `mail_commitment` (worker + IPC)

**Fichiers :**
- Modifier : `apps/web/src/lib/vault-worker/seed-default-types.ts` (après `emailAiCacheFields`, l. ~285, et dans `DEFAULT_ENTITY_TYPES`, l. ~340)
- Modifier : `apps/web/src/lib/vault-worker/worker-router.ts` (l. ~4902, ~5017-5055, ~4367, table des routes l. ~5530)
- Modifier : `packages/ipc/src/schemas/mail.ts` (après `SetAiSummaryOutput`, l. ~271), `packages/ipc/src/router/mail.router.ts` (après `setAiSummary`, l. ~136)

**Interfaces :**
- Produit : type d'entité `"mail_commitment"`. Champs stockés sous les clés `mc_thread_id`, `mc_account_email`, `mc_subject`, `mc_items` (JSON string), `mc_fp`, `mc_at`.
- Produit : `trpcVanillaClient.mail.setCommitments.mutate({ accountId: string; threadId: string; subject: string; items: string; fingerprint: string }) → { ok: boolean }`.

- [ ] **Étape 1 : déclarer le type dans le seed**

Dans `seed-default-types.ts`, sous `emailAiCacheFields` :

```ts
export const MAIL_COMMITMENT_TYPE_ID = "mail_commitment";

const mailCommitmentFields: SeedField[] = [
  { id: "mc_thread_id", name: "threadId", label: "Gmail thread ID", kind: "text", required: true },
  { id: "mc_account_email", name: "accountEmail", label: "Compte Gmail", kind: "email" },
  { id: "mc_subject", name: "subject", label: "Objet", kind: "text" },
  { id: "mc_items", name: "items", label: "Engagements (JSON)", kind: "longtext" },
  { id: "mc_fp", name: "fingerprint", label: "Empreinte du fil", kind: "text" },
  { id: "mc_at", name: "analyzedAt", label: "Analysé le", kind: "number" },
];
```

Dans `DEFAULT_ENTITY_TYPES`, juste après l'entrée `EMAIL_AI_CACHE_TYPE_ID` :

```ts
  { id: MAIL_COMMITMENT_TYPE_ID, name: "mail_commitment", plural: "mail_commitment", icon: "Handshake", color: "#6366F1", fields: mailCommitmentFields, defaultPath: "@system/mail-commitments", fileNamePattern: "{threadId}" },
```

`seedDefaults` fait un `INSERT OR IGNORE` : les coffres existants reçoivent le type au prochain démarrage du worker.

- [ ] **Étape 2 : rendre `upsertEmailAiCacheEntity` générique**

Dans `worker-router.ts`, importer `MAIL_COMMITMENT_TYPE_ID` avec `EMAIL_AI_CACHE_TYPE_ID` (l. 53). Sous `emailAiCacheEntityId` (l. ~4902) :

```ts
  const mailCommitmentEntityId = (accountId: string, threadId: string): string =>
    `mc_${accountId.replace(/[^a-zA-Z0-9]/g, "_")}_${threadId}`;
```

Remplacer la fonction `upsertEmailAiCacheEntity` (l. ~5017-5055) par une version générique et un adaptateur. Le corps est identique à l'existant ; seuls `EMAIL_AI_CACHE_TYPE_ID`, `entityId`, le chemin et les champs de base deviennent des paramètres :

```ts
  const upsertSystemEntity = (
    target: { typeId: string; entityId: string; filePath: string; base: Record<string, unknown> },
    patch: Record<string, unknown>,
  ): void => {
    const { typeId, entityId, filePath, base } = target;
    const existing = row(db.exec(`SELECT id, fields FROM entity WHERE id = ?`, [entityId]));
    const ts = now();
    if (existing) {
      const oldFields: Record<string, unknown> = (() => {
        try { return JSON.parse((existing["fields"] as string) || "{}"); } catch { return {}; }
      })();
      // Chaque synchro republie toute la boîte : sans ce filtre, chaque tick
      // enverrait une op par fil et par appareil.
      if (Object.entries(patch).every(([k, v]) => oldFields[k] === v)) return;
      const merged = { ...oldFields, ...patch };
      db.run(
        `UPDATE entity SET fields = ?, updatedAt = ? WHERE id = ?`,
        [JSON.stringify(merged), ts, entityId],
      );
      const full = { id: entityId, typeId, fields: merged, updatedAt: ts };
      try { hooks.onEntityUpdated?.(full, { ...full, fields: oldFields }); } catch (e) { console.warn(`[hook] onEntityUpdated (${typeId})`, e); }
    } else {
      const fields: Record<string, unknown> = { ...base, ...patch };
      db.run(
        `INSERT OR IGNORE INTO entity
           (id, vaultId, typeId, filePath, fields, body, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
        [entityId, vaultId, typeId, filePath, JSON.stringify(fields), ts, ts],
      );
      const full = { id: entityId, typeId, typeName: typeId, fields, filePath, body: "", createdAt: ts, updatedAt: ts };
      try { hooks.onEntityCreated?.(full); } catch (e) { console.warn(`[hook] onEntityCreated (${typeId})`, e); }
    }
  };

  const upsertEmailAiCacheEntity = (
    accountId: string,
    threadId: string,
    patch: Record<string, unknown>,
  ): void =>
    upsertSystemEntity(
      {
        typeId: EMAIL_AI_CACHE_TYPE_ID,
        entityId: emailAiCacheEntityId(accountId, threadId),
        filePath: `@system/email-ai/${threadId}`,
        base: { eac_thread_id: threadId, eac_account_email: accountId },
      },
      patch,
    );
```

- [ ] **Étape 3 : route `mail.setCommitments`**

Sous `mailSetAiSummary` :

```ts
  // Pas de dénormalisation dans mail_thread : un fil envoyé n'est pas dans le
  // miroir inbox, et email_ai_cache le ferait apparaître en boîte ailleurs.
  const mailSetCommitments = async (input: unknown): Promise<unknown> => {
    const { accountId, threadId, subject, items, fingerprint } = input as {
      accountId: string; threadId: string; subject: string; items: string; fingerprint: string;
    };
    if (!accountId || !threadId) return { ok: false };
    upsertSystemEntity(
      {
        typeId: MAIL_COMMITMENT_TYPE_ID,
        entityId: mailCommitmentEntityId(accountId, threadId),
        filePath: `@system/mail-commitments/${threadId}`,
        base: { mc_thread_id: threadId, mc_account_email: accountId },
      },
      { mc_subject: subject, mc_items: items, mc_fp: fingerprint, mc_at: Date.now() },
    );
    return { ok: true };
  };
```

⚠️ `mc_at` change à chaque appel, donc le filtre « rien n'a changé » ne court-circuite jamais. C'est voulu : la route n'est appelée qu'après une analyse réelle ou une action utilisateur.

Dans la table des routes (l. ~5530), ajouter `"mail.setCommitments": mailSetCommitments,`.

- [ ] **Étape 4 : exclure le type de la FTS à la synchro**

À l'application d'une op distante (l. ~4367), remplacer :

```ts
        if (payload.typeId === EMAIL_AI_CACHE_TYPE_ID) {
          ftsRemove(db, op.entityId);
```

par :

```ts
        if (payload.typeId === EMAIL_AI_CACHE_TYPE_ID || payload.typeId === MAIL_COMMITMENT_TYPE_ID) {
          ftsRemove(db, op.entityId);
```

Laisser intact le bloc de dénormalisation `if (payload.typeId === EMAIL_AI_CACHE_TYPE_ID)` qui suit : `mail_commitment` ne doit **pas** y entrer.

- [ ] **Étape 5 : contrat IPC**

`packages/ipc/src/schemas/mail.ts`, après `SetAiSummaryOutput` :

```ts
// ── mail.setCommitments ────────────────────────────────────────────────────
// Engagements détectés dans un fil : entité mail_commitment, jamais le miroir.

export const SetCommitmentsInput = z.object({
  accountId: z.string(),
  threadId: z.string(),
  subject: z.string(),
  items: z.string(),
  fingerprint: z.string(),
});
export type SetCommitmentsInput = z.infer<typeof SetCommitmentsInput>;

export const SetCommitmentsOutput = z.object({ ok: z.boolean() });
export type SetCommitmentsOutput = z.infer<typeof SetCommitmentsOutput>;
```

`packages/ipc/src/router/mail.router.ts` : importer `SetCommitmentsInput` et `SetCommitmentsOutput` au même endroit que `SetAiSummaryInput`, puis ajouter après `setAiSummary` :

```ts
  /** Store the commitments detected in a thread (mail_commitment entity, synced). */
  setCommitments: publicProcedure
    .input(SetCommitmentsInput)
    .output(SetCommitmentsOutput)
    .mutation(() => {
      throw notImplemented("mail.setCommitments");
    }),
```

Vérifier que `schemas/mail.ts` est bien réexporté par l'index du paquet : `grep -n "mail" packages/ipc/src/index.ts`.

- [ ] **Étape 6 : build et typecheck**

Lancer : `pnpm build:packages && pnpm typecheck`
Attendu : 0 erreur.

- [ ] **Étape 7 : commit (sur accord)**

```bash
git add apps/web/src/lib/vault-worker/seed-default-types.ts apps/web/src/lib/vault-worker/worker-router.ts packages/ipc/src
git commit -m "feat(mail): entité mail_commitment et route mail.setCommitments"
```

---

### Tâche 2 : logique pure `lib/mail-commitments.ts`

**Fichiers :**
- Créer : `apps/web/src/lib/mail-commitments.ts`
- Modifier : `apps/web/src/lib/mail-ai.ts:487` (`runLocalPrompt`)
- Modifier : `apps/web/src/lib/todos/extractChecklists.ts:81` (export de `djb2`)

**Interfaces :**
- Consomme : `mail.setCommitments` (tâche 1), `runLocalPrompt`, `isSelfAddress` (`lib/mail-ai.ts`), `detectDateTime` (`lib/email-to-event.ts`), `addFollowup`, `inDaysAt9` (`lib/mail-followup.ts`), `TODO_TYPE_ID` (`hooks/useTodoSync`), `EmailThread` (`lib/gmail`).
- Produit :
  - `type CommitmentDirection = "moi" | "eux"`
  - `type CommitmentStatus = "suggested" | "accepted" | "dismissed"`
  - `interface Commitment { key; direction; who; whoEmail; text; due: string | null; quote; messageId; status; todoId? }`
  - `interface ThreadCommitments { accountId; threadId; subject; fingerprint; items: Commitment[] }`
  - `MAIL_COMMITMENT_TYPE_ID`, `COMMITMENTS_ENABLED_KEY`, `MAIL_COMMITMENTS_EVENT`
  - `commitmentsEnabled(): boolean`
  - `threadFingerprint(snippet: string): string`
  - `analyzeThread(thread: EmailThread, selfEmails: readonly string[]): Promise<Omit<Commitment, "status" | "todoId">[]>`
  - `mergeCommitments(previous: Commitment[], fresh: Omit<Commitment, "status" | "todoId">[]): Commitment[]`
  - `fromEntity(e: { fields?: Record<string, unknown> }): ThreadCommitments | null`
  - `saveThreadCommitments(tc: ThreadCommitments): Promise<void>`
  - `acceptCommitment(tc: ThreadCommitments, key: string, messageCount: number): Promise<void>`
  - `dismissCommitment(tc: ThreadCommitments, key: string): Promise<void>`
  - `followUpDraft(c: Commitment): string`
  - `isStale(tc: ThreadCommitments | undefined, fingerprint: string): boolean`

- [ ] **Étape 1 : `runLocalPrompt` accepte le format JSON**

Dans `lib/mail-ai.ts`, remplacer :

```ts
export async function runLocalPrompt(prompt: string, temperature = 0.1): Promise<string> {
  const client = buildClient();
  try {
    const text = await client.generate({ prompt, temperature });
```

par :

```ts
export async function runLocalPrompt(
  prompt: string,
  temperature = 0.1,
  format?: "json",
): Promise<string> {
  const client = buildClient();
  try {
    const text = await client.generate({ prompt, temperature, ...(format ? { format } : {}) });
```

- [ ] **Étape 2 : exporter `djb2`**

`lib/todos/extractChecklists.ts:81` : `function djb2(` → `export function djb2(`.

- [ ] **Étape 3 : écrire `lib/mail-commitments.ts`**

```ts
import { trpcVanillaClient } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";
import type { EmailMessage, EmailThread } from "@/lib/gmail";
import { isSelfAddress, runLocalPrompt } from "@/lib/mail-ai";
import { detectDateTime } from "@/lib/email-to-event";
import { addFollowup, inDaysAt9 } from "@/lib/mail-followup";
import { djb2 } from "@/lib/todos/extractChecklists";

/** Doit rester égal à `MAIL_COMMITMENT_TYPE_ID` du seed worker (non importable côté client). */
export const MAIL_COMMITMENT_TYPE_ID = "mail_commitment";
export const COMMITMENTS_ENABLED_KEY = "supernote.ai.commitments";
export const MAIL_COMMITMENTS_EVENT = "supernote:mail-commitments";

export type CommitmentDirection = "moi" | "eux";
export type CommitmentStatus = "suggested" | "accepted" | "dismissed";

export interface Commitment {
  key: string;
  direction: CommitmentDirection;
  who: string;
  whoEmail: string;
  text: string;
  due: string | null;
  quote: string;
  messageId: string;
  status: CommitmentStatus;
  todoId?: string;
}

export type DetectedCommitment = Omit<Commitment, "status" | "todoId">;

export interface ThreadCommitments {
  accountId: string;
  threadId: string;
  subject: string;
  fingerprint: string;
  items: Commitment[];
}

const MAX_MESSAGES = 8;
const MAX_BODY_CHARS = 1_500;
const MIN_QUOTE_CHARS = 8;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

export function commitmentsEnabled(): boolean {
  try {
    return window.localStorage.getItem(COMMITMENTS_ENABLED_KEY) !== "0";
  } catch {
    return false;
  }
}

/** Même calcul côté runner (snippet de threads.list) et côté fil ouvert (snippet du dernier message). */
export function threadFingerprint(snippet: string): string {
  return djb2(norm(snippet));
}

export function isStale(tc: ThreadCommitments | undefined, fingerprint: string): boolean {
  return !tc || tc.fingerprint !== fingerprint;
}

function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function recentMessages(thread: EmailThread): EmailMessage[] {
  return thread.messages.slice(-MAX_MESSAGES);
}

function buildPrompt(thread: EmailThread, selfEmails: readonly string[]): string {
  const blocks = recentMessages(thread).map((m, i) => {
    const from = isSelfAddress(m.from.email, selfEmails) ? "Moi" : `${m.from.name || m.from.email} <${m.from.email}>`;
    const to = m.to.map((a) => a.name || a.email).join(", ");
    return [
      `[message ${i + 1}]`,
      `De : ${from}`,
      `À : ${to}`,
      `Date d'envoi : ${m.date ? m.date.slice(0, 10) : "inconnue"}`,
      "",
      (m.bodyText || m.snippet).slice(0, MAX_BODY_CHARS),
    ].join("\n");
  });
  return [
    "Tu repères les ENGAGEMENTS dans un fil d'emails, en français.",
    "Un engagement : une personne promet de faire une action précise dans le futur (« je vous envoie le devis vendredi », « on vous rappelle lundi »).",
    "Ce ne sont PAS des engagements : une demande faite à l'autre, une formule de politesse (« je reviens vers vous », « n'hésitez pas »), une action déjà faite.",
    'Réponds UNIQUEMENT avec un objet JSON {"engagements": [...]} dont chaque élément est {"message": n, "direction": "moi" | "eux", "text": "...", "due": "AAAA-MM-JJ" | null, "quote": "..."}.',
    "- message : numéro du message qui contient la promesse.",
    '- direction : "moi" si c\'est Moi qui promets, "eux" si c\'est un correspondant.',
    "- text : l'action, courte, à l'infinitif (« Envoyer le devis signé »).",
    "- due : échéance résolue par rapport à la date d'envoi de CE message (« vendredi » = le vendredi qui suit cette date). null si aucune échéance.",
    "- quote : la phrase du message qui contient la promesse, copiée mot pour mot.",
    'Aucun engagement : {"engagements": []}.',
    "",
    "Fil :",
    blocks.join("\n\n"),
  ].join("\n");
}

interface RawCommitment {
  message?: unknown;
  text?: unknown;
  due?: unknown;
  quote?: unknown;
}

function parseRaw(raw: string): RawCommitment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    parsed = (parsed as Record<string, unknown>)["engagements"];
  }
  return Array.isArray(parsed)
    ? parsed.filter((x): x is RawCommitment => typeof x === "object" && x !== null)
    : [];
}

function validate(raw: RawCommitment[], thread: EmailThread, selfEmails: readonly string[]): DetectedCommitment[] {
  const msgs = recentMessages(thread);
  const out: DetectedCommitment[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const text = typeof r.text === "string" ? r.text.trim() : "";
    const quote = typeof r.quote === "string" ? r.quote.trim() : "";
    if (!text || quote.length < MIN_QUOTE_CHARS) continue;

    // Anti-hallucination : la citation doit exister telle quelle ; le numéro de message du 4b est peu fiable.
    const contains = (m: EmailMessage) => norm(m.bodyText || m.snippet).includes(norm(quote));
    const hinted = typeof r.message === "number" ? msgs[r.message - 1] : undefined;
    const msg = hinted && contains(hinted) ? hinted : msgs.find(contains);
    if (!msg) continue;

    // Le sens vient de l'expéditeur réel, pas du modèle.
    const mine = isSelfAddress(msg.from.email, selfEmails);
    const counterpart = mine ? (msg.to[0] ?? { name: "", email: "" }) : msg.from;

    const sent = msg.date ? new Date(msg.date) : new Date();
    let due = typeof r.due === "string" && ISO_DAY.test(r.due) && !Number.isNaN(Date.parse(r.due)) ? r.due : null;
    if (due && due < isoDay(sent)) due = null;
    if (!due) {
      const detected = detectDateTime(quote, sent);
      if (detected) due = isoDay(detected);
    }

    const key = djb2(`${msg.id}|${norm(quote)}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      direction: mine ? "moi" : "eux",
      who: counterpart.name || counterpart.email,
      whoEmail: counterpart.email,
      text,
      due,
      quote,
      messageId: msg.id,
    });
  }
  return out;
}

export async function analyzeThread(thread: EmailThread, selfEmails: readonly string[]): Promise<DetectedCommitment[]> {
  if (thread.messages.length === 0) return [];
  const raw = await runLocalPrompt(buildPrompt(thread, selfEmails), 0.1, "json");
  return validate(parseRaw(raw), thread, selfEmails);
}

/** Une décision de l'utilisateur survit aux réanalyses ; une suggestion non traitée suit la dernière passe. */
export function mergeCommitments(previous: Commitment[], fresh: DetectedCommitment[]): Commitment[] {
  const byKey = new Map(previous.map((c) => [c.key, c]));
  const merged: Commitment[] = fresh.map((f) => {
    const old = byKey.get(f.key);
    return old && old.status !== "suggested" ? old : { ...f, status: "suggested" };
  });
  const freshKeys = new Set(fresh.map((f) => f.key));
  for (const old of previous) {
    if (!freshKeys.has(old.key) && old.status !== "suggested") merged.push(old);
  }
  return merged;
}

function isCommitment(v: unknown): v is Commitment {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["key"] === "string" &&
    (o["direction"] === "moi" || o["direction"] === "eux") &&
    typeof o["text"] === "string" &&
    (o["status"] === "suggested" || o["status"] === "accepted" || o["status"] === "dismissed")
  );
}

export function fromEntity(e: { fields?: Record<string, unknown> }): ThreadCommitments | null {
  const f = e.fields ?? {};
  const threadId = f["mc_thread_id"];
  const accountId = f["mc_account_email"];
  if (typeof threadId !== "string" || typeof accountId !== "string") return null;
  let items: Commitment[] = [];
  try {
    const parsed: unknown = JSON.parse(typeof f["mc_items"] === "string" ? f["mc_items"] : "[]");
    if (Array.isArray(parsed)) items = parsed.filter(isCommitment);
  } catch {
    items = [];
  }
  return {
    accountId,
    threadId,
    subject: typeof f["mc_subject"] === "string" ? f["mc_subject"] : "",
    fingerprint: typeof f["mc_fp"] === "string" ? f["mc_fp"] : "",
    items,
  };
}

export async function saveThreadCommitments(tc: ThreadCommitments): Promise<void> {
  await trpcVanillaClient.mail.setCommitments.mutate({
    accountId: tc.accountId,
    threadId: tc.threadId,
    subject: tc.subject,
    items: JSON.stringify(tc.items),
    fingerprint: tc.fingerprint,
  });
  window.dispatchEvent(new CustomEvent(MAIL_COMMITMENTS_EVENT));
}

function withItem(tc: ThreadCommitments, key: string, patch: Partial<Commitment>): ThreadCommitments {
  return { ...tc, items: tc.items.map((c) => (c.key === key ? { ...c, ...patch } : c)) };
}

function at9(day: string): string {
  return new Date(`${day}T09:00:00`).toISOString();
}

/**
 * « Je dois » → todo datée liée au fil ; « On me doit » → relance le lendemain de l'échéance.
 * `messageCount` = taille actuelle du fil : la relance s'efface si quelqu'un répond d'ici là.
 */
export async function acceptCommitment(tc: ThreadCommitments, key: string, messageCount: number): Promise<void> {
  const c = tc.items.find((x) => x.key === key);
  if (!c || c.status !== "suggested") return;
  if (c.direction === "moi") {
    const created = await trpcVanillaClient.entities.create.mutate({
      typeId: TODO_TYPE_ID,
      fields: {
        text: c.text,
        done: false,
        priority: 5,
        importance: "medium",
        urgent: false,
        ...(c.due ? { dueDate: c.due, reminderAt: at9(c.due), reminderText: c.text } : {}),
        mailThreadId: tc.threadId,
        mailFromName: c.who,
        mailFromEmail: c.whoEmail,
        mailSnippet: c.quote,
      },
    });
    await saveThreadCommitments(withItem(tc, key, { status: "accepted", todoId: created.id }));
    return;
  }
  const dueAt = c.due ? new Date(`${c.due}T09:00:00`).getTime() + 86_400_000 : inDaysAt9(3);
  addFollowup({ threadId: tc.threadId, subject: tc.subject, messageCount, dueAt });
  await saveThreadCommitments(withItem(tc, key, { status: "accepted" }));
}

export async function dismissCommitment(tc: ThreadCommitments, key: string): Promise<void> {
  await saveThreadCommitments(withItem(tc, key, { status: "dismissed" }));
}

export function followUpDraft(c: Commitment): string {
  const first = c.who.split(/\s+/)[0] ?? "";
  return `Bonjour ${first},\n\nJe me permets de revenir vers vous au sujet de : ${c.text.charAt(0).toLowerCase()}${c.text.slice(1)}.\n\nBien à vous`;
}
```

Point à vérifier pendant l'écriture :
- `entities.create` renvoie bien un objet avec `id` : `grep -n "CreateEntityOutput\|create:" -A4 packages/ipc/src/router/entities.router.ts`. Si la sortie est `{ entity: … }`, adapter `created.id` en conséquence.

- [ ] **Étape 4 : typecheck**

Lancer : `pnpm typecheck`
Attendu : 0 erreur.

- [ ] **Étape 5 : commit (sur accord)**

```bash
git add apps/web/src/lib/mail-commitments.ts apps/web/src/lib/mail-ai.ts apps/web/src/lib/todos/extractChecklists.ts
git commit -m "feat(mail): détection des engagements dans un fil (prompt, gardes, fusion)"
```

---

### Tâche 3 : lecture, analyse à l'ouverture et runner de fond

**Fichiers :**
- Créer : `apps/web/src/components/mail/useMailCommitments.ts`
- Créer : `apps/web/src/components/mail/CommitmentsRunner.tsx`
- Modifier : `apps/web/src/RootLayout.tsx:74`

**Interfaces :**
- Consomme : tâche 2 en entier ; `trpc` (`@/lib/trpc/client`) ; `searchThreadsPage`, `getThread` (`@/lib/gmail`) ; `isAiConfigured` ; `isAiRuntimeAllowed` (`@/lib/ai/ai-runtime`) ; `MAIL_SYNCED_EVENT` (`@/lib/mail-mirror`) ; `useSettings`.
- Produit :
  - `useMailCommitments(): { all: ThreadCommitments[]; byThread: Map<string, ThreadCommitments>; refresh: () => void }`
  - `useThreadCommitments(thread: EmailThread | null, accountId: string, selfEmails: readonly string[]): ThreadCommitments | undefined`, qui déclenche l'analyse si le fil est périmé
  - `<CommitmentsRunner />`

- [ ] **Étape 1 : `useMailCommitments.ts`**

```ts
import { useCallback, useEffect, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc/client";
import type { EmailThread } from "@/lib/gmail";
import { isAiConfigured } from "@/lib/mail-ai";
import { isAiRuntimeAllowed } from "@/lib/ai/ai-runtime";
import {
  MAIL_COMMITMENTS_EVENT,
  MAIL_COMMITMENT_TYPE_ID,
  analyzeThread,
  commitmentsEnabled,
  fromEntity,
  isStale,
  mergeCommitments,
  saveThreadCommitments,
  threadFingerprint,
  type ThreadCommitments,
} from "@/lib/mail-commitments";

export function useMailCommitments() {
  // Les écritures d'un autre appareil n'invalident pas les requêtes : le poll local est gratuit (worker).
  const query = trpc.entities.list.useQuery(
    { typeId: MAIL_COMMITMENT_TYPE_ID, limit: 1000 },
    { refetchInterval: 60_000 },
  );
  const { refetch } = query;
  useEffect(() => {
    const on = () => void refetch();
    window.addEventListener(MAIL_COMMITMENTS_EVENT, on);
    return () => window.removeEventListener(MAIL_COMMITMENTS_EVENT, on);
  }, [refetch]);

  const all = useMemo(
    () => (query.data?.items ?? []).map(fromEntity).filter((x): x is ThreadCommitments => x !== null),
    [query.data],
  );
  const byThread = useMemo(() => new Map(all.map((tc) => [tc.threadId, tc])), [all]);
  const refresh = useCallback(() => void refetch(), [refetch]);
  return { all, byThread, refresh };
}

export function useThreadCommitments(
  thread: EmailThread | null,
  accountId: string,
  selfEmails: readonly string[],
): ThreadCommitments | undefined {
  const { byThread } = useMailCommitments();
  const current = thread ? byThread.get(thread.id) : undefined;
  const inFlight = useRef<string | null>(null);
  const last = thread?.messages[thread.messages.length - 1];
  const fp = last ? threadFingerprint(last.snippet) : "";

  useEffect(() => {
    if (!thread || !last || !accountId) return;
    if (!isAiRuntimeAllowed() || !isAiConfigured() || !commitmentsEnabled()) return;
    if (!isStale(current, fp) || inFlight.current === `${thread.id}:${fp}`) return;
    inFlight.current = `${thread.id}:${fp}`;
    void analyzeThread(thread, selfEmails)
      .then((fresh) =>
        saveThreadCommitments({
          accountId,
          threadId: thread.id,
          subject: thread.messages[0]?.subject ?? "",
          fingerprint: fp,
          items: mergeCommitments(current?.items ?? [], fresh),
        }),
      )
      .catch(() => {
        // Ollama injoignable : rien à afficher ; le runner retentera après son cooldown.
      });
  }, [thread, last, accountId, selfEmails, current, fp]);

  return current;
}
```

La vérification `data?.items` suppose que `entities.list` renvoie `{ items }`, comme dans `app/todos/page.tsx:411`.

- [ ] **Étape 2 : `CommitmentsRunner.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useSettings } from "@/components/settings/SettingsContext";
import { getThread, searchThreadsPage } from "@/lib/gmail";
import { isAiConfigured } from "@/lib/mail-ai";
import { isAiRuntimeAllowed } from "@/lib/ai/ai-runtime";
import { MAIL_SYNCED_EVENT } from "@/lib/mail-mirror";
import {
  analyzeThread,
  commitmentsEnabled,
  isStale,
  mergeCommitments,
  saveThreadCommitments,
  threadFingerprint,
} from "@/lib/mail-commitments";
import { useMailCommitments } from "./useMailCommitments";

const QUERY = "newer_than:14d (in:inbox OR in:sent) -in:chats";
const BATCH = 4;
const IDLE_MS = 60_000;
const COOLDOWN_MS = 60_000;

/** Passe de fond : fils récents reçus ET envoyés, analysés au repos, sur PC seulement. */
export function CommitmentsRunner() {
  const { settings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();
  const accountId = settings.gmail.connectedEmail;
  const { byThread } = useMailCommitments();
  const byThreadRef = useRef(byThread);
  byThreadRef.current = byThread;
  const selfRef = useRef<string[]>([]);
  selfRef.current = [accountId, ...settings.gmail.aliases];

  useEffect(() => {
    if (!clientId || !accountId) return undefined;
    let running = false;
    let cooldownUntil = 0;
    let lastInput = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pass = async () => {
      if (running || document.hidden || Date.now() < cooldownUntil) return;
      if (!isAiRuntimeAllowed() || !isAiConfigured() || !commitmentsEnabled()) return;
      running = true;
      try {
        const page = await searchThreadsPage(clientId, QUERY, { maxResults: 30 });
        const stale = page.items
          .filter((t) => isStale(byThreadRef.current.get(t.id), threadFingerprint(t.snippet)))
          .slice(0, BATCH);
        for (const t of stale) {
          if (Date.now() - lastInput < 2_000) break;
          const thread = await getThread(clientId, t.id);
          const prev = byThreadRef.current.get(t.id);
          const fresh = await analyzeThread(thread, selfRef.current);
          await saveThreadCommitments({
            accountId,
            threadId: t.id,
            subject: thread.messages[0]?.subject ?? "",
            fingerprint: threadFingerprint(t.snippet),
            items: mergeCommitments(prev?.items ?? [], fresh),
          });
        }
      } catch {
        // Ollama éteint ou quota Gmail : on se tait une minute (le coupe-circuit Gmail fait le reste).
        cooldownUntil = Date.now() + COOLDOWN_MS;
      } finally {
        running = false;
      }
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void pass(), IDLE_MS);
    };
    const onInput = () => {
      lastInput = Date.now();
      schedule();
    };

    window.addEventListener(MAIL_SYNCED_EVENT, schedule);
    window.addEventListener("keydown", onInput, { passive: true });
    window.addEventListener("pointerdown", onInput, { passive: true });
    schedule();
    return () => {
      clearTimeout(timer);
      window.removeEventListener(MAIL_SYNCED_EVENT, schedule);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("pointerdown", onInput);
    };
  }, [clientId, accountId]);

  return null;
}
```

Le runner stocke `threadFingerprint(t.snippet)`, c'est-à-dire le snippet de `threads.list`, et le fil ouvert stocke le snippet de son dernier message. Tous deux sont décodés par `decodeSnippet`. Si les deux diffèrent sur un fil réel, chaque chemin réanalyse une fois de trop, sans autre conséquence : c'est acceptable, et ce ne doit pas bloquer.

- [ ] **Étape 3 : monter le runner**

`RootLayout.tsx`, importer `CommitmentsRunner` à côté de `MailFollowupRunner` (l. 34), et le monter sous `<MailFollowupRunner />` (l. 74) :

```tsx
                {/* Engagements : la détection tourne au repos, hors de /mail aussi. */}
                <CommitmentsRunner />
```

- [ ] **Étape 4 : typecheck**

Lancer : `pnpm typecheck`
Attendu : 0 erreur.

- [ ] **Étape 5 : commit (sur accord)**

```bash
git add apps/web/src/components/mail/useMailCommitments.ts apps/web/src/components/mail/CommitmentsRunner.tsx apps/web/src/RootLayout.tsx
git commit -m "feat(mail): passe de détection des engagements au repos et à l'ouverture d'un fil"
```

---

### Tâche 4 : bandeau dans le fil

**Fichiers :**
- Créer : `apps/web/src/components/mail/CommitmentsBanner.tsx`
- Modifier : `apps/web/src/components/mail/EmailThreadView.tsx` (juste avant `{thread.messages.map((m) => (`, l. ~1337)

**Interfaces :**
- Consomme : `useThreadCommitments` (tâche 3) ; `acceptCommitment(tc, key, messageCount)`, `dismissCommitment`, `followUpDraft` (tâche 2) ; `useActionFeedback`, `FeedbackIcon`.
- Produit : `<CommitmentsBanner thread={EmailThread} accountId={string} selfEmails={readonly string[]} onDraft={(text: string) => void} />`

- [ ] **Étape 1 : écrire `CommitmentsBanner.tsx`**

```tsx
"use client";

import { ArrowBendUpLeft, CheckSquare, Clock, X } from "@phosphor-icons/react";
import { Button, Tooltip } from "@supernote/ui";
import type { EmailThread } from "@/lib/gmail";
import { FeedbackIcon, useActionFeedback } from "@/lib/action-feedback";
import {
  acceptCommitment,
  dismissCommitment,
  followUpDraft,
  type Commitment,
  type ThreadCommitments,
} from "@/lib/mail-commitments";
import { useThreadCommitments } from "./useMailCommitments";

function dueLabel(due: string | null): string {
  if (!due) return "sans date";
  return new Date(`${due}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

function isOverdue(due: string | null): boolean {
  if (!due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${due}T00:00:00`).getTime() < today.getTime();
}

function Row({
  c,
  tc,
  messageCount,
  onDraft,
}: {
  c: Commitment;
  tc: ThreadCommitments;
  messageCount: number;
  onDraft: (text: string) => void;
}) {
  const acceptFb = useActionFeedback();
  const dismissFb = useActionFeedback();
  const mine = c.direction === "moi";
  const acceptLabel = mine ? "Créer la todo" : "Suivre : relance à l'échéance";
  const pending = c.status === "suggested";

  return (
    <li className="flex min-h-10 items-center gap-2 py-1">
      <span className="sn-eyebrow sn-eyebrow--compact shrink-0">{mine ? "Je dois" : "On me doit"}</span>
      <span className="min-w-0 flex-1 text-sm" style={{ color: "var(--text-primary)" }}>
        <span className="line-clamp-2">{c.text}</span>
        <span
          className="block text-xs tabular-nums"
          style={{ color: isOverdue(c.due) ? "var(--danger, #c0392b)" : "var(--text-muted)" }}
        >
          {c.who ? `${c.who} · ` : ""}
          {dueLabel(c.due)}
        </span>
      </span>
      {pending ? (
        <>
          <Tooltip content={acceptLabel}>
            <Button
              variant="ghost"
              size="icon"
              isIconOnly
              aria-label={acceptLabel}
              className="min-h-8 min-w-8"
              onPress={() => void acceptFb.run(() => acceptCommitment(tc, c.key, messageCount))}
            >
              <FeedbackIcon state={acceptFb.state} idle={mine ? <CheckSquare size={16} aria-hidden /> : <Clock size={16} aria-hidden />} />
            </Button>
          </Tooltip>
          <Tooltip content="Ignorer">
            <Button
              variant="ghost"
              size="icon"
              isIconOnly
              aria-label="Ignorer l'engagement"
              className="min-h-8 min-w-8"
              onPress={() => void dismissFb.run(() => dismissCommitment(tc, c.key))}
            >
              <FeedbackIcon state={dismissFb.state} idle={<X size={16} aria-hidden />} />
            </Button>
          </Tooltip>
        </>
      ) : (
        !mine &&
        isOverdue(c.due) && (
          <Tooltip content="Relancer">
            <Button
              variant="ghost"
              size="icon"
              isIconOnly
              aria-label="Relancer"
              className="min-h-8 min-w-8"
              onPress={() => onDraft(followUpDraft(c))}
            >
              <ArrowBendUpLeft size={16} aria-hidden />
            </Button>
          </Tooltip>
        )
      )}
    </li>
  );
}

/** Engagements repérés dans le fil : suggestions à valider, relances dues. */
export function CommitmentsBanner({
  thread,
  accountId,
  selfEmails,
  onDraft,
}: {
  thread: EmailThread;
  accountId: string;
  selfEmails: readonly string[];
  onDraft: (text: string) => void;
}) {
  const tc = useThreadCommitments(thread, accountId, selfEmails);
  const visible = (tc?.items ?? []).filter(
    (c) => c.status === "suggested" || (c.status === "accepted" && c.direction === "eux" && isOverdue(c.due)),
  );
  if (!tc || visible.length === 0) return null;
  return (
    <section
      aria-label="Engagements"
      className="mb-3 rounded-lg border px-3 py-1"
      style={{ borderColor: "var(--border-subtle)", background: "var(--surface-1)" }}
    >
      <ul className="flex flex-col divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {visible.map((c) => (
          <Row key={c.key} c={c} tc={tc} messageCount={thread.messages.length} onDraft={onDraft} />
        ))}
      </ul>
    </section>
  );
}
```

Avant d'écrire, vérifier que `CheckSquare`, `Clock`, `ArrowBendUpLeft` et `X` existent dans `@phosphor-icons/react` (`grep -rn "ArrowBendUpLeft" apps/web/src | head -1`). Sinon, prendre l'équivalent déjà utilisé dans `components/mail`. Vérifier aussi la signature de `FeedbackIcon` (`lib/action-feedback.tsx:74`) : props `state`, `idle` (ReactNode), `size`.

- [ ] **Étape 2 : insérer le bandeau dans `EmailThreadView`**

Importer `CommitmentsBanner`. Juste avant `{thread.messages.map((m) => (` (l. ~1337) :

```tsx
      <CommitmentsBanner
        thread={thread}
        accountId={selfEmail ?? ""}
        selfEmails={aiThread.selfEmails ?? []}
        onDraft={(text) => {
          setReplyBody(text);
          requestAnimationFrame(() => replyTaRef.current?.focus());
        }}
      />
```

`setReplyBody` et `replyTaRef` sont ceux qu'utilise `quickRepliesConfig.onPick` (l. 493). `aiThread.selfEmails` est mémoïsé (l. 448), donc stable pour les dépendances de l'effet.

- [ ] **Étape 3 : typecheck**

Lancer : `pnpm typecheck`
Attendu : 0 erreur.

- [ ] **Étape 4 : commit (sur accord)**

```bash
git add apps/web/src/components/mail/CommitmentsBanner.tsx apps/web/src/components/mail/EmailThreadView.tsx
git commit -m "feat(mail): bandeau d'engagements dans le fil"
```

---

### Tâche 5 : section « Engagements » du panneau Aujourd'hui

**Fichiers :**
- Créer : `apps/web/src/components/mail/CommitmentsTodaySection.tsx`
- Modifier : `apps/web/src/components/agenda/TodayPanel.tsx` (fin du conteneur principal, **hors** du ternaire `!connected`, l. ~195)

**Interfaces :**
- Consomme : `useMailCommitments` (tâche 3) ; `useSettings`.
- Produit : `<CommitmentsTodaySection />` (sans props).

- [ ] **Étape 1 : écrire `CommitmentsTodaySection.tsx`**

```tsx
"use client";

import { useNavigate } from "react-router-dom";
import { useSettings } from "@/components/settings/SettingsContext";
import type { Commitment, ThreadCommitments } from "@/lib/mail-commitments";
import { useMailCommitments } from "./useMailCommitments";

const HORIZON_DAYS = 2;

interface Line {
  c: Commitment;
  tc: ThreadCommitments;
}

function horizon(): string {
  const d = new Date();
  d.setDate(d.getDate() + HORIZON_DAYS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function relevant(c: Commitment, limit: string): boolean {
  if (c.status === "dismissed") return false;
  if (c.status === "suggested") return true;
  return c.due !== null && c.due <= limit;
}

/** Engagements du moment : suggestions en attente et échéances proches, groupés par sens. */
export function CommitmentsTodaySection() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { all } = useMailCommitments();
  const limit = horizon();
  const today = new Date().toISOString().slice(0, 10);
  const lines: Line[] = all
    .filter((tc) => tc.accountId === settings.gmail.connectedEmail)
    .flatMap((tc) => tc.items.filter((c) => relevant(c, limit)).map((c) => ({ c, tc })))
    .sort((a, b) => (a.c.due ?? "9999").localeCompare(b.c.due ?? "9999"));
  if (lines.length === 0) return null;

  const group = (dir: Commitment["direction"], title: string) => {
    const rows = lines.filter((l) => l.c.direction === dir);
    if (rows.length === 0) return null;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="sn-eyebrow sn-eyebrow--compact px-1">{title}</span>
        {rows.map(({ c, tc }) => (
          <button
            key={`${tc.threadId}:${c.key}`}
            type="button"
            onClick={() => navigate(`/mail?thread=${encodeURIComponent(tc.threadId)}`)}
            className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left outline-none transition-colors hover:bg-[var(--nav-hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text-primary)" }}>
              {c.text}
            </span>
            <span
              className="shrink-0 text-[11px] tabular-nums"
              style={{ color: c.due && c.due < today ? "var(--danger, #c0392b)" : "var(--text-muted)" }}
            >
              {c.status === "suggested" ? "à valider" : c.due}
            </span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2 border-t px-3 py-3" style={{ borderColor: "var(--border-subtle)" }}>
      {group("moi", "Je dois")}
      {group("eux", "On me doit")}
    </div>
  );
}
```

`<button>` natif : c'est l'exception déjà utilisée pour les lignes cliquables de `TodayPanel` (mêmes classes), qui en garde la cohérence visuelle. L'`acceptCommitment` n'est pas exposé ici : on valide dans le fil, qui donne le contexte. La section ouvre le fil.

- [ ] **Étape 2 : insérer dans `TodayPanel`**

Importer `CommitmentsTodaySection` depuis `@/components/mail/CommitmentsTodaySection`. Juste avant la fermeture du `<div className="flex h-full flex-col overflow-y-auto">` (après le bloc `{!connected ? … : …}`) :

```tsx
      <CommitmentsTodaySection />
```

Placée hors du ternaire, la section s'affiche même sans Google Agenda connecté. Sur mobile, `TodayPanel` est rendu dans la `MobileSheet` (`app/mail/page.tsx:2764`) : aucun code mobile supplémentaire.

- [ ] **Étape 3 : typecheck**

Lancer : `pnpm typecheck`
Attendu : 0 erreur.

- [ ] **Étape 4 : commit (sur accord)**

```bash
git add apps/web/src/components/mail/CommitmentsTodaySection.tsx apps/web/src/components/agenda/TodayPanel.tsx
git commit -m "feat(mail): engagements du moment dans le panneau Aujourd'hui"
```

---

### Tâche 6 : e2e

**Fichiers :**
- Modifier : `tests/e2e/helpers.ts:22` (`AI_FLAGS`)
- Créer : `tests/e2e/10-mail-commitments.spec.ts`

**Interfaces :**
- Consomme : `bootCloud`, `MESSAGE` (`tests/e2e/helpers.ts`) ; l'UI des tâches 4 et 5.

- [ ] **Étape 1 : couper la détection dans les autres e2e**

`helpers.ts:22`, ajouter `"supernote.ai.commitments"` à `AI_FLAGS`. Sans ce flag, chaque e2e connecté à Gmail enverrait des requêtes à `127.0.0.1:11434`.

- [ ] **Étape 2 : écrire le spec**

```ts
import { test, expect, type Page } from "@playwright/test";
import { bootCloud, MESSAGE } from "./helpers";

const BODY =
  "Bonjour,\n\nMerci pour l'échange. Je vous envoie le devis signé vendredi 2 octobre.\n\nAlice";

function message(id: string, body: string) {
  return {
    ...MESSAGE,
    id,
    payload: {
      ...MESSAGE.payload,
      headers: MESSAGE.payload.headers.map((h) => (h.name === "Subject" ? { ...h, value: "Devis Acme" } : h)),
      body: { size: body.length, data: Buffer.from(body, "utf8").toString("base64url") },
    },
    snippet: "Je vous envoie le devis signé vendredi",
  };
}

async function withPromiseInbox(page: Page, engagements: unknown[]): Promise<void> {
  await bootCloud(page, { googleAccount: "moi@exemple.fr" });
  // bootCloud coupe les flags IA : on réactive celui-ci et on configure Ollama.
  await page.addInitScript(() => {
    localStorage.setItem("supernote.ai.commitments", "1");
    const s = JSON.parse(localStorage.getItem("supernote.settings") ?? "{}");
    s.ia = { ...(s.ia ?? {}), ollamaModel: "qwen3.5:4b" };
    localStorage.setItem("supernote.settings", JSON.stringify(s));
  });
  const msg = message("m1", BODY);
  await page.route("https://gmail.googleapis.com/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/gmail/v1/users/me", "");
    if (path === "/threads") return route.fulfill({ json: { threads: [{ id: "t1", snippet: msg.snippet }] } });
    if (path.startsWith("/threads/")) return route.fulfill({ json: { id: "t1", historyId: "10", messages: [msg] } });
    if (path.startsWith("/messages/")) return route.fulfill({ json: msg });
    if (path === "/profile") return route.fulfill({ json: { emailAddress: "moi@exemple.fr", historyId: "10" } });
    if (path.startsWith("/labels/")) return route.fulfill({ json: { id: "INBOX", threadsTotal: 1, threadsUnread: 1 } });
    if (path === "/labels") return route.fulfill({ json: { labels: [] } });
    return route.fulfill({ json: {} });
  });
  await page.route("https://www.googleapis.com/**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("http://127.0.0.1:11434/**", (route) =>
    route.fulfill({ json: { response: JSON.stringify({ engagements }), done: true } }),
  );
}

test.describe("10 — engagements mail", () => {
  test("une promesse reçue devient une relance ; une citation inventée est rejetée", async ({ page }) => {
    await withPromiseInbox(page, [
      { message: 1, direction: "eux", text: "Envoyer le devis signé", due: "2026-10-02", quote: "Je vous envoie le devis signé vendredi 2 octobre." },
      { message: 1, direction: "eux", text: "Appeler demain", due: null, quote: "Je vous appelle demain sans faute." },
    ]);
    await page.goto("/mail");
    await page.getByText("Devis Acme").first().click();

    const banner = page.getByRole("region", { name: "Engagements" });
    await expect(banner).toContainText("Envoyer le devis signé", { timeout: 20_000 });
    await expect(banner).toContainText("On me doit");
    await expect(banner).not.toContainText("Appeler demain");

    await banner.getByRole("button", { name: "Suivre : relance à l'échéance" }).click();
    await expect(banner).toBeHidden();
    const followups = await page.evaluate(() => localStorage.getItem("supernote.mail.followups") ?? "");
    expect(followups).toContain("t1");
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("aucun appel IA sur mobile", async ({ page }) => {
      const calls: string[] = [];
      await withPromiseInbox(page, []);
      page.on("request", (r) => {
        if (r.url().startsWith("http://127.0.0.1:11434")) calls.push(r.url());
      });
      await page.goto("/mail");
      await page.getByText("Devis Acme").first().click();
      await page.waitForTimeout(2_000);
      expect(calls).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
});
```

Le scénario « Je dois → todo » demande un message **de** `moi@exemple.fr`. Le garder pour le contrôle manuel ; l'e2e couvre déjà le sens recalculé, puisque le modèle mocké dit `eux` sur un message d'Alice. Si l'analyse à l'ouverture ne se déclenche pas parce que `isAiConfigured()` lit un autre champ que `settings.ia.ollamaModel`, lire `lib/ai/settings.ts` (`getAiSettings`) et renseigner la bonne clé dans l'`addInitScript`.

- [ ] **Étape 3 : lancer l'e2e**

Lancer : `pnpm test:e2e -- tests/e2e/10-mail-commitments.spec.ts`
Attendu : 2 tests PASS.

- [ ] **Étape 4 : non-régression**

Lancer : `pnpm typecheck && pnpm test:e2e -- tests/e2e/06-mail.spec.ts tests/e2e/09-mail-shared-mirror.spec.ts`
Attendu : tout PASS. Le miroir partagé ne doit pas voir apparaître de fil fantôme.

- [ ] **Étape 5 : commit (sur accord)**

```bash
git add tests/e2e/helpers.ts tests/e2e/10-mail-commitments.spec.ts
git commit -m "test(e2e): engagements mail — suggestion, rejet de citation inventée, mobile sans IA"
```

---

### Tâche 7 : contrôle réel (manuel, lecture seule)

- [ ] `pnpm dev` sur le PC, avec Ollama lancé (`qwen3.5:4b`), Gmail connecté.
- [ ] Ouvrir 10 fils récents dont au moins 3 contiennent une promesse (dont 1 envoyée par moi). Relever les vrais positifs, les faux positifs, les manqués et les dates fausses.
- [ ] Accepter un « Je dois » : la todo apparaît dans `/todos`, datée, avec « ouvrir l'email », et « Planifier » la place dans l'agenda.
- [ ] Reporter les chiffres à l'utilisateur. Le prompt ne bouge que si les faux positifs dépassent 2 sur 10.
