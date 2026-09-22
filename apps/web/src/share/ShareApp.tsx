import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input } from "@supernote/ui";
import { Spinner } from "@heroui/react";
import { LockSimple } from "@phosphor-icons/react";
import { cachedAccess, fetchMeta, forgetAccess, unlock, type Access, type Closed, type LinkMeta } from "./guest-api";
import { GuestNote } from "./GuestNote";
import { GuestEmail } from "./GuestEmail";

type View =
  | { kind: "loading" }
  | { kind: "closed"; reason: Closed | "lost" | "unavailable" }
  | { kind: "password"; meta: LinkMeta; error: string | null }
  | { kind: "open"; meta: LinkMeta; access: Access };

const CLOSED_TEXT: Record<Closed | "lost" | "unavailable", string> = {
  expired: "Ce lien a expiré.",
  revoked: "Ce lien a été retiré.",
  missing: "Ce lien n'existe pas.",
  lost: "Accès retiré : ce lien a été modifié ou révoqué.",
  unavailable: "Serveur indisponible, réessaie dans un instant.",
};

export function ShareApp({ slug }: { slug: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Deux pertes en moins de 10 s ne sont pas un jeton qui expire (12 h) : on ferme plutôt que de reboucler indéfiniment.
  const lastRetryRef = useRef(0);

  const load = useCallback(
    async (useCache: boolean) => {
      let meta: LinkMeta | Closed;
      try {
        meta = await fetchMeta(slug);
      } catch {
        return setView({ kind: "closed", reason: "unavailable" });
      }
      if (typeof meta === "string") return setView({ kind: "closed", reason: meta });
      document.title = meta.title || "Partage · Supernote";
      const cached = useCache ? cachedAccess(slug) : null;
      if (cached) return setView({ kind: "open", meta, access: cached });
      if (meta.needsPassword) return setView({ kind: "password", meta, error: null });
      let access: Access | "wrong" | "locked" | Closed;
      try {
        access = await unlock(slug);
      } catch {
        return setView({ kind: "closed", reason: "unavailable" });
      }
      if (access === "wrong" || access === "locked") return setView({ kind: "password", meta, error: null });
      if (typeof access === "string") return setView({ kind: "closed", reason: access });
      setView({ kind: "open", meta, access });
    },
    [slug],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const submitPassword = async (meta: LinkMeta) => {
    setBusy(true);
    try {
      const access = await unlock(slug, password);
      if (access === "wrong") return setView({ kind: "password", meta, error: "Mot de passe incorrect." });
      if (access === "locked") return setView({ kind: "password", meta, error: "Trop d'essais. Réessaie dans 15 minutes." });
      if (typeof access === "string") return setView({ kind: "closed", reason: access });
      setView({ kind: "open", meta, access });
    } catch {
      setView({ kind: "password", meta, error: "Serveur indisponible, réessaie dans un instant." });
    } finally {
      setBusy(false);
    }
  };

  // Passée à GuestNote/GuestEmail : une perte de connexion revérifie le lien avant de conclure à un retrait.
  const lose = useCallback(() => {
    forgetAccess(slug);
    if (Date.now() - lastRetryRef.current < 10_000) return setView({ kind: "closed", reason: "lost" });
    lastRetryRef.current = Date.now();
    void load(false);
  }, [slug, load]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-6 md:px-10 md:py-12">
      {view.kind === "loading" && (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      )}
      {view.kind === "closed" && (
        <p className="m-auto text-center text-[var(--text-secondary)]">{CLOSED_TEXT[view.reason]}</p>
      )}
      {view.kind === "password" && (
        <form
          className="m-auto flex w-full max-w-sm flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submitPassword(view.meta);
          }}
        >
          <h1 className="flex items-center gap-2 text-lg font-semibold [overflow-wrap:anywhere]">
            <LockSimple size={18} aria-hidden /> {view.meta.title || "Partage protégé"}
          </h1>
          <label htmlFor="share-password" className="text-sm text-[var(--text-secondary)]">
            Mot de passe
          </label>
          <Input
            id="share-password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {view.error && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {view.error}
            </p>
          )}
          <Button type="submit" variant="primary" isDisabled={busy || !password}>
            Ouvrir
          </Button>
        </form>
      )}
      {view.kind === "open" && view.access.kind === "note" && (
        <GuestNote slug={slug} title={view.meta.title} access={view.access} onLost={lose} />
      )}
      {view.kind === "open" && view.access.kind === "email" && <GuestEmail slug={slug} access={view.access} onLost={lose} />}
    </main>
  );
}
