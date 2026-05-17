# Correctifs UX — Foundation (Patterns A/B/C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire les 3 utilitaires partagés (`useConfirm`, `withMutationFeedback`, `validators/`) qui débloquent les correctifs UX HIGH P0-P4.

**Architecture:** Tout vit dans `apps/web/src/lib/`. `useConfirm` = provider global + hook retournant `Promise<boolean>` autour du `Modal` HeroUI v3 de `@supernote/ui`. `withMutationFeedback` = helper qui décore options tRPC `useMutation` pour ajouter `onSuccess`/`onError` toasts via `useToast` existant de `@supernote/ui`. `validators/` = fonctions pures retournant `{ valid: boolean; message?: string }`, FR i18n.

**Tech Stack:** React 19, TypeScript strict, HeroUI v3 (`@heroui/react`), `@supernote/ui` (Modal + ToastProvider + useToast existants), tRPC v11, vitest (env node pour validators).

---

## Spec couvert

- Spec : `docs/superpowers/specs/2026-05-15-correctifs-ux-high-design.md` section **Patterns cross-cutting (A/B/C)**.
- Plans aval consomment ces utilitaires : journal save (#1), validation contacts/todos (#3, #4), confirmations destructives (#6, #7, #9).

## Pré-requis du codebase

- `ToastProvider` + `useToast()` exportés par `@supernote/ui` (`packages/ui/src/components/toast/Toast.tsx`).
- `ToastProvider` déjà monté dans `apps/web/src/RootLayout.tsx:30`.
- `Modal` HeroUI v3 wrapper exporté par `@supernote/ui` (`packages/ui/src/components/modal/Modal.tsx`).
- Pattern `useToast()` déjà consommé par `apps/web/src/app/notes/page.tsx:71`, `apps/web/src/components/bases/DataGrid.tsx:86`, `apps/web/src/app/archive/page.tsx:30` → API stable.
- tRPC client exposé via `@/lib/trpc` (à confirmer dans le code). `useMutation` retourne `UseMutationResult` standard.
- Vitest config `apps/web/vitest.config.ts` : env `node`. OK pour fonctions pures (validators). Hooks/composants React testés via vitest avec `jsdom` ou via tests d'intégration manuels — ici on limite les tests de hooks aux assertions de comportement essentielles.

## File Structure

### Nouveaux fichiers

| Path | Responsabilité |
| --- | --- |
| `apps/web/src/lib/confirm/ConfirmProvider.tsx` | Provider qui monte le `Modal` global et expose un context `confirm()` |
| `apps/web/src/lib/confirm/useConfirm.ts` | Hook consumer : `const confirm = useConfirm(); await confirm({...})` |
| `apps/web/src/lib/confirm/index.ts` | Barrel `export { ConfirmProvider, useConfirm }` |
| `apps/web/src/lib/trpc/with-mutation-feedback.ts` | Helper `withMutationFeedback(opts)` retournant `{ onSuccess, onError }` |
| `apps/web/src/lib/trpc/with-mutation-feedback.test.ts` | Tests unitaires (env node, mocks `toast`) |
| `apps/web/src/lib/validation/email.ts` | `validateEmail(value: string): ValidationResult` |
| `apps/web/src/lib/validation/email.test.ts` | Tests |
| `apps/web/src/lib/validation/phone.ts` | `validatePhone(value: string): ValidationResult` |
| `apps/web/src/lib/validation/phone.test.ts` | Tests |
| `apps/web/src/lib/validation/non-empty.ts` | `validateNonEmpty(value: string): ValidationResult` |
| `apps/web/src/lib/validation/non-empty.test.ts` | Tests |
| `apps/web/src/lib/validation/types.ts` | `export type ValidationResult = { valid: true } \| { valid: false; message: string }` |
| `apps/web/src/lib/validation/index.ts` | Barrel |

### Fichiers modifiés

| Path | Modification |
| --- | --- |
| `apps/web/src/RootLayout.tsx` | Wrap children avec `<ConfirmProvider>` à l'intérieur de `<ToastProvider>` |

## Conventions

- Tests vitest, fichiers `*.test.ts(x)` à côté du source.
- Pas d'`any`. `ValidationResult` discriminé. Erreurs i18n FR.
- Pas de `<button>` HTML nu — `<Button>` HeroUI v3 dans le rendu modal.
- Conventional commits français : `feat(ui): ...`, `feat(lib): ...`, `test(...): ...`.

---

## Task 1 : Type partagé `ValidationResult`

**Files:**
- Create: `apps/web/src/lib/validation/types.ts`

- [ ] **Step 1 : Créer le fichier de types**

```ts
// apps/web/src/lib/validation/types.ts
export type ValidationResult =
  | { valid: true }
  | { valid: false; message: string };

export type Validator = (value: string) => ValidationResult;
```

- [ ] **Step 2 : Verifier typecheck**

Run: `pnpm --filter @supernote/web typecheck`
Expected: PASS (aucun import nouveau à ce stade).

- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/lib/validation/types.ts
git commit -m "feat(validation): type ValidationResult partagé"
```

---

## Task 2 : `validateNonEmpty`

**Files:**
- Create: `apps/web/src/lib/validation/non-empty.ts`
- Create: `apps/web/src/lib/validation/non-empty.test.ts`

- [ ] **Step 1 : Écrire le test (failing)**

```ts
// apps/web/src/lib/validation/non-empty.test.ts
import { describe, expect, it } from "vitest";
import { validateNonEmpty } from "./non-empty";

describe("validateNonEmpty", () => {
  it("renvoie valid pour une chaîne non vide", () => {
    expect(validateNonEmpty("hello")).toEqual({ valid: true });
  });

  it("renvoie invalid pour chaîne vide", () => {
    expect(validateNonEmpty("")).toEqual({ valid: false, message: "Ce champ est requis" });
  });

  it("renvoie invalid pour chaîne uniquement espaces", () => {
    expect(validateNonEmpty("   ")).toEqual({ valid: false, message: "Ce champ est requis" });
  });

  it("renvoie invalid pour chaîne uniquement tabulations/sauts", () => {
    expect(validateNonEmpty("\t\n  ")).toEqual({ valid: false, message: "Ce champ est requis" });
  });
});
```

- [ ] **Step 2 : Lancer test → échec attendu**

Run: `pnpm --filter @supernote/web test src/lib/validation/non-empty.test.ts`
Expected: FAIL ("Cannot find module './non-empty'").

- [ ] **Step 3 : Implémenter**

```ts
// apps/web/src/lib/validation/non-empty.ts
import type { ValidationResult } from "./types";

export function validateNonEmpty(value: string): ValidationResult {
  if (value.trim().length === 0) {
    return { valid: false, message: "Ce champ est requis" };
  }
  return { valid: true };
}
```

- [ ] **Step 4 : Lancer test → pass**

Run: `pnpm --filter @supernote/web test src/lib/validation/non-empty.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/lib/validation/non-empty.ts apps/web/src/lib/validation/non-empty.test.ts
git commit -m "feat(validation): validateNonEmpty avec tests"
```

---

## Task 3 : `validateEmail`

**Files:**
- Create: `apps/web/src/lib/validation/email.ts`
- Create: `apps/web/src/lib/validation/email.test.ts`

- [ ] **Step 1 : Écrire le test (failing)**

```ts
// apps/web/src/lib/validation/email.test.ts
import { describe, expect, it } from "vitest";
import { validateEmail } from "./email";

describe("validateEmail", () => {
  it.each([
    "alice@example.com",
    "user.name+tag@sub.domain.co",
    "a@b.cd",
  ])("accepte %s", (input) => {
    expect(validateEmail(input)).toEqual({ valid: true });
  });

  it.each([
    "x@y",
    "no-at-sign.com",
    "double@@example.com",
    "missing-tld@example",
    "spaces in@example.com",
    "",
  ])("rejette %s", (input) => {
    const r = validateEmail(input);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.message).toBe("Email invalide");
  });

  it("trim les espaces avant validation", () => {
    expect(validateEmail("  alice@example.com  ")).toEqual({ valid: true });
  });
});
```

- [ ] **Step 2 : Lancer test → échec**

Run: `pnpm --filter @supernote/web test src/lib/validation/email.test.ts`
Expected: FAIL ("Cannot find module './email'").

- [ ] **Step 3 : Implémenter**

```ts
// apps/web/src/lib/validation/email.ts
import type { ValidationResult } from "./types";

// RFC 5322 simplifié : local-part raisonnable + domaine avec au moins un point + TLD ≥ 2 lettres.
// Suffisant pour bloquer les saisies poubelle sans fausses-négatives sur emails légitimes.
const EMAIL_RE =
  /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

export function validateEmail(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!EMAIL_RE.test(trimmed)) {
    return { valid: false, message: "Email invalide" };
  }
  return { valid: true };
}
```

- [ ] **Step 4 : Lancer test → pass**

Run: `pnpm --filter @supernote/web test src/lib/validation/email.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/lib/validation/email.ts apps/web/src/lib/validation/email.test.ts
git commit -m "feat(validation): validateEmail avec tests"
```

---

## Task 4 : `validatePhone`

**Files:**
- Create: `apps/web/src/lib/validation/phone.ts`
- Create: `apps/web/src/lib/validation/phone.test.ts`

- [ ] **Step 1 : Écrire le test (failing)**

```ts
// apps/web/src/lib/validation/phone.test.ts
import { describe, expect, it } from "vitest";
import { validatePhone } from "./phone";

describe("validatePhone", () => {
  it.each([
    "0612345678",
    "06 12 34 56 78",
    "+33 6 12 34 56 78",
    "+1 (415) 555-0132",
    "06-12-34-56-78",
  ])("accepte %s", (input) => {
    expect(validatePhone(input)).toEqual({ valid: true });
  });

  it.each([
    "abc",
    "12",          // trop court
    "0a12345678",  // mélange lettres
    "",
    "  ",
  ])("rejette %s", (input) => {
    const r = validatePhone(input);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.message).toBe("Numéro invalide");
  });

  it("accepte avec espaces autour", () => {
    expect(validatePhone("  0612345678  ")).toEqual({ valid: true });
  });
});
```

- [ ] **Step 2 : Lancer test → échec**

Run: `pnpm --filter @supernote/web test src/lib/validation/phone.test.ts`
Expected: FAIL.

- [ ] **Step 3 : Implémenter**

```ts
// apps/web/src/lib/validation/phone.ts
import type { ValidationResult } from "./types";

// Accepte :
//  - chiffres seulement, parfois préfixés `+`, séparateurs autorisés : espaces, `.`, `-`, `(`, `)`
//  - longueur de chiffres utiles entre 6 et 15 (E.164 max)
const PHONE_RE = /^[+]?[0-9\s().\-]{6,25}$/;

export function validatePhone(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!PHONE_RE.test(trimmed)) {
    return { valid: false, message: "Numéro invalide" };
  }
  // Compter les chiffres utiles
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) {
    return { valid: false, message: "Numéro invalide" };
  }
  return { valid: true };
}
```

- [ ] **Step 4 : Lancer test → pass**

Run: `pnpm --filter @supernote/web test src/lib/validation/phone.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/lib/validation/phone.ts apps/web/src/lib/validation/phone.test.ts
git commit -m "feat(validation): validatePhone avec tests"
```

---

## Task 5 : Barrel `validation/index.ts`

**Files:**
- Create: `apps/web/src/lib/validation/index.ts`

- [ ] **Step 1 : Créer le barrel**

```ts
// apps/web/src/lib/validation/index.ts
export type { ValidationResult, Validator } from "./types";
export { validateEmail } from "./email";
export { validatePhone } from "./phone";
export { validateNonEmpty } from "./non-empty";
```

- [ ] **Step 2 : Vérifier typecheck**

Run: `pnpm --filter @supernote/web typecheck`
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/lib/validation/index.ts
git commit -m "feat(validation): barrel index"
```

---

## Task 6 : `ConfirmProvider` + `useConfirm` — squelette + types

**Files:**
- Create: `apps/web/src/lib/confirm/useConfirm.ts`
- Create: `apps/web/src/lib/confirm/ConfirmProvider.tsx`
- Create: `apps/web/src/lib/confirm/index.ts`

- [ ] **Step 1 : Définir types + hook (sans provider encore)**

```ts
// apps/web/src/lib/confirm/useConfirm.ts
import * as React from "react";

export interface ConfirmOptions {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
}

export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm doit être utilisé à l'intérieur de <ConfirmProvider>");
  }
  return ctx;
}
```

- [ ] **Step 2 : Créer le provider**

```tsx
// apps/web/src/lib/confirm/ConfirmProvider.tsx
import * as React from "react";
import { Modal } from "@supernote/ui";
import { Button } from "@heroui/react";
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from "./useConfirm";

interface PendingConfirm {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);

  const confirm = React.useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setPending({ opts, resolve });
    });
  }, []);

  const close = React.useCallback(
    (result: boolean) => {
      if (!pending) return;
      pending.resolve(result);
      setPending(null);
    },
    [pending],
  );

  const opts = pending?.opts;
  const variant = opts?.variant ?? "default";
  const confirmLabel = opts?.confirmLabel ?? "Confirmer";
  const cancelLabel = opts?.cancelLabel ?? "Annuler";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        isOpen={pending !== null}
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
        title={opts?.title ?? ""}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onPress={() => close(false)}>
              {cancelLabel}
            </Button>
            <Button
              color={variant === "danger" ? "danger" : "primary"}
              onPress={() => close(true)}
            >
              {confirmLabel}
            </Button>
          </div>
        }
      >
        <div className="text-sm text-[var(--text-secondary)]">{opts?.body}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}
```

- [ ] **Step 3 : Barrel**

```ts
// apps/web/src/lib/confirm/index.ts
export { ConfirmProvider } from "./ConfirmProvider";
export { useConfirm } from "./useConfirm";
export type { ConfirmOptions, ConfirmFn } from "./useConfirm";
```

- [ ] **Step 4 : Vérifier typecheck**

Run: `pnpm --filter @supernote/web typecheck`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/lib/confirm/
git commit -m "feat(ui): useConfirm + ConfirmProvider basés sur Modal HeroUI v3"
```

---

## Task 7 : Monter `ConfirmProvider` dans `RootLayout`

**Files:**
- Modify: `apps/web/src/RootLayout.tsx`

- [ ] **Step 1 : Lire le fichier actuel**

Run: `cat apps/web/src/RootLayout.tsx`
Note l'ordre des providers : `ThemeProvider` > `ToastProvider` > children. `ConfirmProvider` doit être à l'intérieur de `ToastProvider` (pour pouvoir éventuellement appeler `useToast` plus tard) et englober tout le contenu de l'app.

- [ ] **Step 2 : Modifier l'import**

Trouve l'import :

```tsx
import { ThemeProvider, ToastProvider } from "@supernote/ui";
```

Ajoute en dessous :

```tsx
import { ConfirmProvider } from "@/lib/confirm";
```

- [ ] **Step 3 : Modifier le rendu**

Trouve le bloc `<ToastProvider>{children}</ToastProvider>` (ligne ~30-61). Remplace par :

```tsx
<ToastProvider>
  <ConfirmProvider>
    {/* ce qui était à l'intérieur de ToastProvider — préserver */}
    {children}
  </ConfirmProvider>
</ToastProvider>
```

**Important :** ne pas dupliquer le contenu de `<ToastProvider>`. Si ce dernier contenait déjà d'autres enfants/wrappers, garder l'ordre exact et insérer `<ConfirmProvider>` juste à l'intérieur, autour de `{children}`.

- [ ] **Step 4 : Vérifier typecheck**

Run: `pnpm --filter @supernote/web typecheck`
Expected: PASS.

- [ ] **Step 5 : Vérification visuelle (manuelle, optionnelle)**

Run: `pnpm --filter @supernote/web dev`
Charger l'app, vérifier qu'aucune erreur console n'apparaît au boot. Pas de modal visible (état pending = null).

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/RootLayout.tsx
git commit -m "feat(ui): monter ConfirmProvider dans RootLayout"
```

---

## Task 8 : Smoke test d'intégration `useConfirm` (manuel via composant scratch)

Ce test garantit que la chaîne complète fonctionne avant que d'autres specs en dépendent. Pas de fichier de test automatisé (test de hook React sans jsdom = trop coûteux ici), mais une vérification manuelle obligatoire.

**Files:**
- Create temporaire : `apps/web/src/lib/confirm/__smoke__.tsx` (sera supprimé)

- [ ] **Step 1 : Créer un composant de smoke test**

```tsx
// apps/web/src/lib/confirm/__smoke__.tsx
import { Button } from "@heroui/react";
import { useConfirm } from "./useConfirm";

export function ConfirmSmokeButton() {
  const confirm = useConfirm();
  return (
    <Button
      onPress={async () => {
        const ok = await confirm({
          title: "Smoke test",
          body: "Cliquer sur Confirmer ou Annuler.",
          variant: "danger",
          confirmLabel: "Supprimer",
        });
        // eslint-disable-next-line no-console
        console.log("[confirm-smoke]", ok);
      }}
    >
      Smoke confirm
    </Button>
  );
}
```

- [ ] **Step 2 : Brancher temporairement le smoke button**

Ouvrir `apps/web/src/app/parametres/page.tsx`, ajouter en haut de la première section visible :

```tsx
import { ConfirmSmokeButton } from "@/lib/confirm/__smoke__";
// ...
<ConfirmSmokeButton />
```

- [ ] **Step 3 : Lancer dev server**

Run: `pnpm --filter @supernote/web dev`
Naviguer vers `/parametres`. Cliquer "Smoke confirm".
Expected :
- Modal apparaît avec titre "Smoke test", body, bouton "Supprimer" en rouge.
- Cliquer "Supprimer" → console `[confirm-smoke] true`.
- Re-cliquer le button. Cliquer "Annuler" ou Escape → console `[confirm-smoke] false`.

- [ ] **Step 4 : Vérifier accessibilité basique**

- Tab depuis le bouton → focus va sur "Annuler" puis "Supprimer".
- Escape ferme et résout `false`.
- Click backdrop ferme et résout `false`.

- [ ] **Step 5 : Nettoyer le smoke**

Supprimer :
- Le fichier `apps/web/src/lib/confirm/__smoke__.tsx`
- L'import et l'usage dans `apps/web/src/app/parametres/page.tsx`

Vérifier : `pnpm --filter @supernote/web typecheck` PASS.

- [ ] **Step 6 : Commit (uniquement le nettoyage si on a accidentellement modifié parametres ; sinon rien à commiter)**

Si parametres n'a pas été commité avec le smoke, rien à faire. Sinon :

```bash
git add apps/web/src/app/parametres/page.tsx
git rm apps/web/src/lib/confirm/__smoke__.tsx
git commit -m "chore(confirm): retirer le smoke test temporaire"
```

---

## Task 9 : `withMutationFeedback` — types + tests

**Files:**
- Create: `apps/web/src/lib/trpc/with-mutation-feedback.ts`
- Create: `apps/web/src/lib/trpc/with-mutation-feedback.test.ts`

- [ ] **Step 1 : Écrire les tests (failing)**

```ts
// apps/web/src/lib/trpc/with-mutation-feedback.test.ts
import { describe, expect, it, vi } from "vitest";
import { withMutationFeedback } from "./with-mutation-feedback";

function fakeToaster() {
  const calls: Array<{ title: string; description?: string; variant?: string }> = [];
  return {
    calls,
    toast: vi.fn((data: { title: string; description?: string; variant?: string }) => {
      calls.push(data);
      return "id";
    }),
  };
}

describe("withMutationFeedback", () => {
  it("appelle toast.success sur onSuccess avec libellé statique", () => {
    const t = fakeToaster();
    const opts = withMutationFeedback(t.toast, { success: "Enregistré", error: "Échec" });
    opts.onSuccess?.({}, undefined, undefined);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toMatchObject({ title: "Enregistré", variant: "success" });
  });

  it("appelle toast.danger sur onError avec libellé statique", () => {
    const t = fakeToaster();
    const opts = withMutationFeedback(t.toast, { success: "OK", error: "Échec" });
    opts.onError?.(new Error("boom"), undefined, undefined);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toMatchObject({ title: "Échec", variant: "danger" });
  });

  it("résout les libellés en fonction quand `error` est une factory", () => {
    const t = fakeToaster();
    const opts = withMutationFeedback(t.toast, {
      success: () => "Saved",
      error: (e) => `Fail: ${e instanceof Error ? e.message : String(e)}`,
    });
    opts.onSuccess?.({}, undefined, undefined);
    opts.onError?.(new Error("xyz"), undefined, undefined);
    expect(t.calls[0]).toMatchObject({ title: "Saved", variant: "success" });
    expect(t.calls[1]).toMatchObject({ title: "Fail: xyz", variant: "danger" });
  });

  it("ne toast pas si success/error sont undefined", () => {
    const t = fakeToaster();
    const opts = withMutationFeedback(t.toast, {});
    opts.onSuccess?.({}, undefined, undefined);
    opts.onError?.(new Error("x"), undefined, undefined);
    expect(t.calls).toHaveLength(0);
  });

  it("préserve callbacks utilisateur après toast", () => {
    const t = fakeToaster();
    const userSuccess = vi.fn();
    const userError = vi.fn();
    const opts = withMutationFeedback(
      t.toast,
      { success: "OK", error: "KO" },
      { onSuccess: userSuccess, onError: userError },
    );
    opts.onSuccess?.({ a: 1 }, undefined, undefined);
    opts.onError?.(new Error("e"), undefined, undefined);
    expect(userSuccess).toHaveBeenCalledWith({ a: 1 }, undefined, undefined);
    expect(userError).toHaveBeenCalledWith(expect.any(Error), undefined, undefined);
  });
});
```

- [ ] **Step 2 : Lancer test → échec**

Run: `pnpm --filter @supernote/web test src/lib/trpc/with-mutation-feedback.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3 : Implémenter**

```ts
// apps/web/src/lib/trpc/with-mutation-feedback.ts
type ToastFn = (data: {
  title: string;
  description?: string;
  variant?: "default" | "success" | "warning" | "danger" | "info";
}) => string;

type Label<T = unknown> = string | ((arg: T) => string);

export interface MutationFeedbackOptions<TData = unknown> {
  /** Libellé du toast de succès. Si absent, pas de toast succès. */
  success?: Label<TData>;
  /** Libellé du toast d'erreur. Si absent, pas de toast erreur. */
  error?: Label<unknown>;
}

export interface PassthroughCallbacks<TData = unknown> {
  onSuccess?: (data: TData, variables: unknown, context: unknown) => void;
  onError?: (error: unknown, variables: unknown, context: unknown) => void;
}

function resolve<T>(label: Label<T> | undefined, arg: T): string | null {
  if (label === undefined) return null;
  return typeof label === "function" ? label(arg) : label;
}

/**
 * Wrap les callbacks d'options tRPC `useMutation` pour ajouter des toasts
 * standard. Préserve les callbacks utilisateur passés via `passthrough`.
 *
 * Utilisation :
 *   const mut = trpc.x.useMutation(
 *     withMutationFeedback(toast, { success: "Enregistré", error: (e) => `Échec: ${e}` })
 *   );
 */
export function withMutationFeedback<TData = unknown>(
  toast: ToastFn,
  feedback: MutationFeedbackOptions<TData>,
  passthrough: PassthroughCallbacks<TData> = {},
): Required<PassthroughCallbacks<TData>> {
  return {
    onSuccess: (data, variables, context) => {
      const title = resolve(feedback.success, data);
      if (title !== null) {
        toast({ title, variant: "success" });
      }
      passthrough.onSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => {
      const title = resolve(feedback.error, error);
      if (title !== null) {
        toast({ title, variant: "danger" });
      }
      passthrough.onError?.(error, variables, context);
    },
  };
}
```

- [ ] **Step 4 : Lancer test → pass**

Run: `pnpm --filter @supernote/web test src/lib/trpc/with-mutation-feedback.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5 : Typecheck global**

Run: `pnpm --filter @supernote/web typecheck`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/lib/trpc/with-mutation-feedback.ts apps/web/src/lib/trpc/with-mutation-feedback.test.ts
git commit -m "feat(trpc): withMutationFeedback helper avec toast unifié"
```

---

## Task 10 : Smoke test `withMutationFeedback` (manuel)

Aucun fichier persisté. Vérification d'intégration uniquement.

- [ ] **Step 1 : Choisir un site d'appel existant et observer**

Ouvrir `apps/web/src/components/bases/DataGrid.tsx`. Vérifier que `useToast` y est déjà importé (ligne 22). Confirmer qu'on **peut** remplacer un futur `useMutation({ onSuccess: () => toast({...}) })` par `withMutationFeedback(toast, {...})`. Pas de modification ici — juste mental check.

- [ ] **Step 2 : Aucun commit (vérification seulement)**

---

## Task 11 : Suite de tests complète

- [ ] **Step 1 : Lancer toute la suite web**

Run: `pnpm --filter @supernote/web test`
Expected: PASS, tous les nouveaux tests inclus (au moins 3 fichiers × ~5 tests + with-mutation-feedback ~5).

- [ ] **Step 2 : Typecheck final**

Run: `pnpm --filter @supernote/web typecheck`
Expected: PASS.

- [ ] **Step 3 : Vérifier lint (si configuré)**

Run: `pnpm --filter @supernote/web lint 2>/dev/null || echo "no lint script"`
Expected: PASS ou "no lint script".

- [ ] **Step 4 : Si tout vert, aucun commit nécessaire (déjà commités au fur et à mesure).**

---

## Récapitulatif des commits attendus

```
feat(validation): type ValidationResult partagé
feat(validation): validateNonEmpty avec tests
feat(validation): validateEmail avec tests
feat(validation): validatePhone avec tests
feat(validation): barrel index
feat(ui): useConfirm + ConfirmProvider basés sur Modal HeroUI v3
feat(ui): monter ConfirmProvider dans RootLayout
feat(trpc): withMutationFeedback helper avec toast unifié
```

8 commits attendus, plus éventuellement 1 commit de nettoyage smoke si pollution accidentelle de `parametres/page.tsx`.

## Validation finale

- `pnpm --filter @supernote/web typecheck` PASS.
- `pnpm --filter @supernote/web test` PASS (≥ 4 nouveaux fichiers de tests).
- Smoke test useConfirm validé manuellement (Task 8).
- `RootLayout.tsx` wrap toujours `ToastProvider > ConfirmProvider > children`.
- Aucun nouveau `<button>` HTML nu introduit.
- Aucun `any` introduit.

## Next plans (dépendants de cette foundation)

- `2026-05-15-correctifs-ux-p0-journal.md` : findings #1 (JournalEditor save mort) + #2 (mock calendar) — consomme `withMutationFeedback`.
- `2026-05-15-correctifs-ux-p1-forms.md` : findings #3 (contacts email/tel) + #4 (todos quick-add) — consomme `validators/`.
- `2026-05-15-correctifs-ux-p2-mobile-empty.md` : findings #5 + #8.
- `2026-05-15-correctifs-ux-p3-destructifs.md` : findings #6 + #7 + #9 — consomme `useConfirm` et `withMutationFeedback`.
- `2026-05-15-correctifs-ux-p4-nav-palette.md` : findings #10 + #11.
