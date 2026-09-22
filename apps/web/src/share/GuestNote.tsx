import { useEffect, useMemo, useState, type MouseEvent } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Button, Input } from "@supernote/ui";
import { Spinner } from "@heroui/react";
import { COLLAB_FRAGMENT, SupernoteEditor } from "@supernote/editor";
import { collabUrl, colorFor } from "@/lib/share/collab";
import { fetchBlobUrl, fetchMeta, type Access } from "./guest-api";

const NAME_KEY = "supernote.share.guestName";

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function Unavailable() {
  return (
    <div className="rounded-md border border-dashed border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-muted)]">
      Contenu lié au coffre, non disponible
    </div>
  );
}

export function GuestNote({
  slug,
  title,
  access,
  onLost,
}: {
  slug: string;
  title: string;
  access: Access;
  onLost: () => void;
}) {
  const writable = access.mode === "write";
  const [name, setName] = useState(readName);
  const [joined, setJoined] = useState(!writable || !!readName());
  const [synced, setSynced] = useState(false);

  const session = useMemo(() => {
    if (!joined) return null;
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: access.resourceId,
      document: doc,
      token: access.accessToken,
      onSynced: () => setSynced(true),
      // Une panne serveur transitoire ("unavailable") n'est pas un refus définitif.
      onAuthenticationFailed: ({ reason }) => {
        if (reason !== "unavailable") onLost();
      },
      // Une coupure peut ne pas relancer l'authentification : on revérifie le lien ; réseau/5xx ignoré, le provider se reconnecte seul.
      onDisconnect: () => {
        void fetchMeta(slug)
          .then((meta) => {
            if (typeof meta === "string") onLost();
          })
          .catch(() => {});
      },
    });
    return { doc, provider };
  }, [joined, slug, access.resourceId, access.accessToken, onLost]);

  useEffect(() => () => session?.provider.destroy(), [session]);

  // Un lecteur voit les curseurs des autres sans diffuser le sien.
  useEffect(() => {
    if (session && synced && !writable) session.provider.awareness?.setLocalState(null);
  }, [session, synced, writable]);

  const files = useMemo(
    () => ({
      upload: () => Promise.reject(new Error("L'ajout d'images est réservé au propriétaire.")),
      resolveUrl: (path: string) => fetchBlobUrl(slug, access.accessToken, path).catch(() => path),
    }),
    [slug, access.accessToken],
  );

  if (!joined) {
    return (
      <form
        className="m-auto flex w-full max-w-sm flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            localStorage.setItem(NAME_KEY, name.trim());
          } catch {
            /* le nom sera redemandé */
          }
          setJoined(true);
        }}
      >
        <h1 className="text-lg font-semibold">{title || "Note partagée"}</h1>
        <label htmlFor="guest-name" className="text-sm text-[var(--text-secondary)]">
          Ton nom
        </label>
        <Input id="guest-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <Button type="submit" variant="primary" isDisabled={!name.trim()}>
          Rejoindre
        </Button>
      </form>
    );
  }

  if (!session || !synced) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Les liens internes (mention, wikilink) mèneraient vers l'app du propriétaire.
  const blockInternalLinks = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a[href^="/"]')) e.preventDefault();
  };

  const userName = writable ? name.trim() : "Lecteur";
  return (
    <div className="flex flex-col gap-4" onClickCapture={blockInternalLinks}>
      <h1 className="text-2xl font-semibold [text-wrap:balance]">{title || "Note partagée"}</h1>
      <SupernoteEditor
        readOnly={!writable}
        collaboration={{
          fragment: session.doc.getXmlFragment(COLLAB_FRAGMENT),
          provider: { awareness: session.provider.awareness ?? undefined },
          user: { name: userName, color: colorFor(userName) },
        }}
        renderDatabaseView={Unavailable}
        renderFormula={Unavailable}
        files={files}
      />
    </div>
  );
}
