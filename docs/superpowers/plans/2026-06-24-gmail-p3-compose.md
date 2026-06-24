# Gmail — Phase 3 (Compose draft-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Créer un brouillon Gmail depuis l'app (jamais d'envoi direct) : « Emailer cette note » (titre→sujet, corps markdown→corps) et « Nouvel email » (brouillon vierge), puis ouvrir le brouillon dans Gmail.

**Architecture:** Tout client-side, décalqué sur `useCreateDriveDoc`. Nouveau scope **`gmail.compose`** (restricted) demandé par consentement incrémental au 1ᵉʳ brouillon (token caché par scope, coexiste avec readonly). `lib/gmail.ts` gagne `buildRawMessage` (RFC 2822) + `toBase64Url` (purs, testés) + `createDraft` (POST `/drafts`). Hook `useCreateDraft`. Surfaces : « Emailer cette note » (header note desktop + action header mobile), « Nouvel email » (`NewItemSheet`). Après création → `window.open(draftUrl)` + toast.

**Tech Stack:** Gmail API drafts, `@supernote/ui` (`useToast`, `Button`), HeroUI v3, vitest. Réutilise P1 (`requestAccessToken` per-scope, `decodeBody`).

**Prérequis :** P1+P2 sur `feat/gmail-p1`. On continue dessus.

**Note prérequis Google :** le scope `gmail.compose` doit être ajouté à l'écran de consentement OAuth (projet Google Cloud, mode testing). 1ᵉʳ « créer brouillon » → popup de consentement compose (séparé du readonly).

---

## File Structure

- Modify `apps/web/src/lib/gmail.ts` — `GMAIL_COMPOSE_SCOPE`, `toBase64Url`, `encodeHeaderWord`, `buildRawMessage`, `createDraft`.
- Modify `apps/web/src/lib/gmail.test.ts` — tests purs + createDraft (fetch mock).
- Create `apps/web/src/components/notes/useCreateDraft.ts` — hook (mirror `useCreateDriveDoc`).
- Modify `apps/web/src/components/notes/NewItemSheet.tsx` — row « Email » (`onNewDraft?`).
- Modify `apps/web/src/app/notes/page.tsx` — handler `handleNewDraft` (brouillon vierge).
- Modify `apps/web/src/app/notes/[id]/page.tsx` — action header mobile « Emailer cette note ».
- Modify `apps/web/src/components/notes/NoteEditor.tsx` — bouton desktop « Emailer » dans le header note.

---

## Task 1 : primitives compose (purs, TDD)

**Files:** Modify `apps/web/src/lib/gmail.ts`, `apps/web/src/lib/gmail.test.ts`

- [ ] **Step 1: Tests qui échouent** — append à `gmail.test.ts` :

```ts
import { toBase64Url, buildRawMessage, GMAIL_COMPOSE_SCOPE } from "./gmail";

describe("toBase64Url", () => {
  it("encode en base64url et round-trip avec decodeBody", () => {
    const enc = toBase64Url("Héllo 👋");
    expect(enc).not.toMatch(/[+/=]/); // url-safe, sans padding
    expect(decodeBody(enc)).toBe("Héllo 👋");
  });
});

describe("buildRawMessage", () => {
  it("inclut To, Subject, corps, charset UTF-8", () => {
    const raw = buildRawMessage({ to: "ada@calc.io", subject: "Bonjour", body: "Coucou" });
    expect(raw).toContain("To: ada@calc.io");
    expect(raw).toContain("Subject: Bonjour");
    expect(raw).toMatch(/charset="?UTF-8"?/i);
    expect(raw).toContain("Coucou");
  });
  it("encode (RFC2047) un sujet non-ASCII", () => {
    const raw = buildRawMessage({ subject: "Réunion café", body: "x" });
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?.+\?=/);
  });
  it("omet To si absent", () => {
    const raw = buildRawMessage({ subject: "s", body: "b" });
    expect(raw).not.toMatch(/^To:/m);
  });
});

describe("GMAIL_COMPOSE_SCOPE", () => {
  it("est le scope compose", () => {
    expect(GMAIL_COMPOSE_SCOPE).toBe("https://www.googleapis.com/auth/gmail.compose");
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter web test -- gmail` → FAIL.

- [ ] **Step 3: Implémenter dans `gmail.ts`** (append) :

```ts
export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

/** Bytes UTF-8 → base64 standard (binaire via btoa). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Chaîne UTF-8 → base64url sans padding (inverse de decodeBody). */
export function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Encode un en-tête non-ASCII en mot encodé RFC 2047 (=?UTF-8?B?…?=). */
function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(value)) return value;
  const b64 = bytesToBase64(new TextEncoder().encode(value));
  return `=?UTF-8?B?${b64}?=`;
}

/** Construit un message RFC 2822 (texte brut UTF-8) pour `drafts.create`. */
export function buildRawMessage(input: { to?: string; subject: string; body: string }): string {
  const lines: string[] = [];
  if (input.to) lines.push(`To: ${input.to}`);
  lines.push(`Subject: ${encodeHeaderWord(input.subject)}`);
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("");
  lines.push(input.body);
  return lines.join("\r\n");
}
```

> Vérifier que `btoa`/`TextEncoder` sont dispo (jsdom oui, navigateur oui — comme `atob` en P1).

- [ ] **Step 4: Vérifier le succès** — `pnpm --filter web test -- gmail` → PASS.
- [ ] **Step 5: Typecheck** — `pnpm --filter web typecheck` → clean.
- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/gmail.ts apps/web/src/lib/gmail.test.ts
git commit -m "feat(gmail): primitives compose (toBase64Url, buildRawMessage, scope compose)"
```

---

## Task 2 : `createDraft` (POST /drafts, scope compose)

**Files:** Modify `apps/web/src/lib/gmail.ts`, `apps/web/src/lib/gmail.test.ts`

- [ ] **Step 1: Test qui échoue** — append :

```ts
import { createDraft } from "./gmail";
import { requestAccessToken } from "./google-drive";

describe("createDraft", () => {
  it("POST /drafts avec un message raw base64url et renvoie draftId", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "draft_1", message: { id: "m1" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await createDraft("cid", { to: "a@b.io", subject: "Hi", body: "yo" });
    expect(out.draftId).toBe("draft_1");
    // requestAccessToken doit être appelé avec le scope compose
    expect(requestAccessToken).toHaveBeenCalledWith("cid", expect.objectContaining({ scope: "https://www.googleapis.com/auth/gmail.compose" }));
    // le body POST contient message.raw
    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toContain("/drafts");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("raw");
    vi.unstubAllGlobals();
  });
});
```

> Le mock `./google-drive` (déjà en tête de `gmail.test.ts`) doit exposer `requestAccessToken` en `vi.fn`. Vérifier qu'il l'expose toujours (il l'expose). Pour asserter `toHaveBeenCalledWith`, importer le mock typé ; sinon retirer cette assertion et garder les autres.

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter web test -- gmail` → FAIL.

- [ ] **Step 3: Implémenter dans `gmail.ts`** (append) :

```ts
export interface DraftResult {
  draftId: string;
}

/**
 * Crée un brouillon Gmail (jamais d'envoi). Scope `gmail.compose` demandé en
 * incrémental (consentement au 1ᵉʳ appel). Le message raw est un RFC 2822
 * encodé base64url. L'utilisateur relit/envoie depuis Gmail.
 */
export async function createDraft(
  clientId: string,
  input: { to?: string; subject: string; body: string },
): Promise<DraftResult> {
  const token = await requestAccessToken(clientId, { scope: GMAIL_COMPOSE_SCOPE, prompt: "" });
  const raw = toBase64Url(buildRawMessage(input));
  const res = await fetch(`${GMAIL_API_BASE}/drafts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail draft ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { id?: string };
  return { draftId: json.id ?? "" };
}

/** URL web d'un brouillon Gmail (à ouvrir après création). */
export function buildGmailDraftUrl(draftId: string): string {
  return `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draftId)}`;
}
```

> `GMAIL_API_BASE` est déjà défini en P1 (`https://gmail.googleapis.com/gmail/v1/users/me`). Réutiliser.

- [ ] **Step 4: Vérifier le succès** — `pnpm --filter web test -- gmail` → PASS.
- [ ] **Step 5: Typecheck** — clean.
- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/gmail.ts apps/web/src/lib/gmail.test.ts
git commit -m "feat(gmail): createDraft + buildGmailDraftUrl (brouillon Gmail)"
```

---

## Task 3 : hook `useCreateDraft`

**Files:** Create `apps/web/src/components/notes/useCreateDraft.ts`

Mirror `useCreateDriveDoc` (hooks.ts:470-506).

- [ ] **Step 1: Créer le hook**

```ts
import { useCallback } from "react";
import { useSettings } from "@/components/settings/SettingsContext";
import { createDraft, buildGmailDraftUrl } from "@/lib/gmail";

export interface CreateDraftOptions {
  to?: string;
  subject: string;
  body: string;
}

export interface CreateDraftResult {
  draftId: string;
  url: string;
}

/**
 * Crée un brouillon Gmail et renvoie son URL web. Réutilise le Client ID
 * Google (Drive) ; nécessite Gmail connecté. Scope compose demandé en
 * incrémental par createDraft. Décalque useCreateDriveDoc.
 */
export function useCreateDraft() {
  const { settings } = useSettings();
  const createDraftFn = useCallback(
    async (opts: CreateDraftOptions): Promise<CreateDraftResult> => {
      const clientId = settings.googleDrive?.clientId?.trim() ?? "";
      if (!clientId) {
        throw new Error("Google n'est pas configuré (Paramètres → Google Drive).");
      }
      if (!settings.gmail?.connectedEmail) {
        throw new Error("Gmail n'est pas connecté (Paramètres → Gmail).");
      }
      const { draftId } = await createDraft(clientId, opts);
      return { draftId, url: buildGmailDraftUrl(draftId) };
    },
    [settings.googleDrive?.clientId, settings.gmail?.connectedEmail],
  );
  return { createDraft: createDraftFn };
}
```

- [ ] **Step 2: Typecheck** — `pnpm --filter web typecheck` → clean.
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/notes/useCreateDraft.ts
git commit -m "feat(mail): hook useCreateDraft (brouillon Gmail)"
```

---

## Task 4 : « Emailer cette note » (desktop + mobile)

**Files:**
- Modify `apps/web/src/app/notes/[id]/page.tsx` (handler + action header mobile)
- Modify `apps/web/src/components/notes/NoteEditor.tsx` (bouton desktop)

Lire d'abord `notes/[id]/page.tsx` autour de `useMobileHeaderActions` (~ligne 521) et la façon dont la note (title/body) y est dispo + comment NoteEditor reçoit la note.

- [ ] **Step 1: Handler partagé** — dans le composant qui détient la note + `useToast` (probablement `notes/[id]/page.tsx`, sinon `NoteEditor`), ajouter :

```tsx
  const { createDraft } = useCreateDraft();
  const { toast } = useToast();
  const [emailing, setEmailing] = useState(false);

  const handleEmailNote = useCallback(async () => {
    setEmailing(true);
    try {
      const { url } = await createDraft({
        subject: note.title || "Sans titre",
        body: note.body ?? "",
      });
      if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
      toast({ title: "Brouillon Gmail créé", description: "Relisez et envoyez depuis Gmail." });
    } catch (err) {
      toast({ title: "Échec du brouillon", description: err instanceof Error ? err.message : String(err), variant: "danger" });
    } finally {
      setEmailing(false);
    }
  }, [createDraft, toast, note.title, note.body]);
```

> Adapter `note.title`/`note.body` aux vrais accès (objet note du composant). Importer `useCreateDraft`, `useToast` (`@supernote/ui`), `useState`/`useCallback`.

- [ ] **Step 2: Action header mobile** — ajouter à la liste `mobileActions` passée à `useMobileHeaderActions` :

```tsx
    { id: "email-note", icon: EnvelopeSimple, label: "Emailer", onPress: () => void handleEmailNote() },
```

(Importer `EnvelopeSimple` de `@phosphor-icons/react`.) Gate optionnel : n'ajouter l'action que si Gmail connecté (`useGmailConnected()`), comme la nav. Si non connecté, l'omettre.

- [ ] **Step 3: Bouton desktop** — dans le header de note de `NoteEditor.tsx` (zone titre/save), ajouter un `Button` HeroUI v3 (icône `EnvelopeSimple` en enfant, pas de `startContent`), visible si `useGmailConnected()`, `onPress={() => void handleEmailNote()}`, `isDisabled={emailing}`. Si le handler vit dans `[id]/page.tsx`, le passer en prop à `NoteEditor` (`onEmailNote?: () => void`) ; sinon définir le handler dans NoteEditor (il a `bodyRef`/`note`). Choisir l'emplacement le plus simple et rester chirurgical — lire le header de NoteEditor d'abord.

- [ ] **Step 4: Typecheck + tests** — `pnpm --filter web typecheck` clean ; `pnpm --filter web test` vert.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/notes/[id]/page.tsx apps/web/src/components/notes/NoteEditor.tsx
git commit -m "feat(mail): « Emailer cette note » → brouillon Gmail (desktop + mobile)"
```

---

## Task 5 : « Nouvel email » (brouillon vierge) dans NewItemSheet

**Files:**
- Modify `apps/web/src/components/notes/NewItemSheet.tsx`
- Modify `apps/web/src/app/notes/page.tsx`

- [ ] **Step 1: NewItemSheet — prop + row** — ajouter une prop optionnelle `onNewDraft?: () => void` et, si fournie, une row :

```tsx
        {onNewDraft && (
          <SheetRow icon={EnvelopeSimple} label="Email" onPress={() => pick(onNewDraft)} />
        )}
```

(Importer `EnvelopeSimple` de `@phosphor-icons/react`.) Mettre `onNewDraft` optionnel pour ne rien casser des appels existants.

- [ ] **Step 2: notes/page.tsx — handler** — ajouter (gate Gmail connecté via `useGmailConnected()`), calqué sur `handleNewDriveDoc` :

```tsx
  const { createDraft } = useCreateDraft();
  const gmailConnected = useGmailConnected();

  const handleNewDraft = useCallback(async () => {
    try {
      const { url } = await createDraft({ subject: "", body: "" });
      if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
      toast({ title: "Brouillon Gmail créé" });
    } catch (err) {
      toast({ title: "Échec du brouillon", description: err instanceof Error ? err.message : String(err), variant: "danger" });
    }
  }, [createDraft, toast]);
```

Et passer `onNewDraft={gmailConnected ? handleNewDraft : undefined}` à `<NewItemSheet>`.

- [ ] **Step 3: Typecheck + tests** — clean / vert.
- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/notes/NewItemSheet.tsx apps/web/src/app/notes/page.tsx
git commit -m "feat(mail): « Nouvel email » (brouillon vierge) dans le sheet Créer"
```

---

## Task 6 : vérification finale P3

- [ ] **Step 1: Typecheck global** — `pnpm typecheck` → clean.
- [ ] **Step 2: Suites** — `pnpm --filter web test` → vert (incl. nouveaux tests gmail compose).
- [ ] **Step 3: Smoke manuel** (Gmail connecté) :
  1. Note → « Emailer cette note » (desktop bouton / mobile action) → 1ᵉʳ appel = consentement compose → brouillon ouvert dans Gmail (sujet = titre, corps = markdown) + toast.
  2. FAB « Créer » → « Email » → brouillon vierge ouvert + toast.
  3. Gmail déconnecté → action/bouton absents (gate) ; si forcé → erreur toast claire.
  4. Vérifier qu'aucun envoi n'a lieu (brouillon seulement).
  5. Mobile : action header « Emailer » présente, pas de débordement.

---

## Self-Review (couverture vs spec P3)

- **createDraft (RFC822 + base64url + scope compose incrémental)** → Tasks 1-2 ✓
- **Draft-first, jamais d'envoi** → createDraft = drafts.create uniquement ✓
- **« Emailer cette note » (titre→sujet, corps)** → Task 4 ✓
- **« Nouvel email » vierge** → Task 5 ✓
- **window.open(draft) + toast** → Tasks 4-5 ✓
- **Mobile en même mouvement** (action header mobile + bouton desktop) → Task 4 ✓
- **Gate Gmail connecté** (réutilise `useGmailConnected`) → Tasks 4-5 ✓

**Hors P3 :** envoi direct (`gmail.send`), pièces jointes, wiring de l'action automation `create-mail-draft` (worker — nécessiterait un pont worker↔main pour l'OAuth ; futur), markdown→texte enrichi (on envoie le markdown brut comme corps). **P4 = capture email→entité.**
