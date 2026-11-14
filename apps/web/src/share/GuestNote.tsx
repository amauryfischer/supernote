import { useEffect, useMemo, useState, type MouseEvent } from "react";
import dynamic from "next/dynamic";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Button, Input, Tabs } from "@supernote/ui";
import { Spinner } from "@heroui/react";
import { COLLAB_FRAGMENT, SupernoteEditor } from "@supernote/editor";
import type { CanvasDocument } from "@supernote/canvas";
import { collabUrl, colorFor, sanitizePeerAwareness } from "@/lib/share/collab";
import { fetchBlobUrl, fetchCanvas, fetchMeta, type Access } from "./guest-api";

const canvasModule = () => import("@supernote/canvas");
const SupernoteCanvas = dynamic(() => canvasModule().then((m) => ({ default: m.SupernoteCanvas })), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Spinner aria-label="Chargement du canvas" />
    </div>
  ),
});

const VIEW_TABS = [
  { key: "note", label: "Note" },
  { key: "canvas", label: "Canvas" },
];

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

const isExternalUrl = (url: string) => /^(https?:|blob:|data:)/i.test(url);
const blobUrlByPath = new Map<string, string>();

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
  const [canvas, setCanvas] = useState<CanvasDocument | null>(null);
  const [view, setView] = useState<"note" | "canvas">("note");

  useEffect(() => {
    let alive = true;
    void fetchCanvas(slug, access.accessToken)
      .then(async (json) => {
        if (!json) return;
        const doc = (await canvasModule()).parseCanvas(json);
        const visible = (doc.excalidrawElements ?? []).some((e) => !e["isDeleted"]) || doc.nodes.length > 0;
        if (alive && visible) setCanvas(doc);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug, access.accessToken]);

  const session = useMemo(() => {
    if (!joined) return null;
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: access.resourceId,
      document: doc,
      token: access.accessToken,
      // Un lecteur ne publie rien : sans ce battement, le serveur le coupe et il se reconnecte en boucle.
      forceSyncInterval: 20000,
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
    // Un lecteur ne diffuse jamais son curseur.
    if (!writable) provider.awareness?.setLocalState(null);
    // Avant le montage de l'éditeur : les écouteurs lib0 passent dans l'ordre d'inscription, le plugin de curseur lit l'état après nous.
    const unsanitize = provider.awareness ? sanitizePeerAwareness(provider.awareness) : () => {};
    return { doc, provider, unsanitize };
  }, [joined, slug, access.resourceId, access.accessToken, onLost, writable]);

  useEffect(
    () => () => {
      session?.unsanitize();
      session?.provider.destroy();
      session?.doc.destroy();
    },
    [session],
  );

  const files = useMemo(
    () => ({
      upload: () => Promise.reject(new Error("L'ajout d'images est réservé au propriétaire.")),
      resolveUrl: async (path: string) => {
        if (!path || isExternalUrl(path)) return path;
        const cached = blobUrlByPath.get(path);
        if (cached) return cached;
        try {
          const url = await fetchBlobUrl(slug, access.accessToken, path);
          blobUrlByPath.set(path, url);
          return url;
        } catch {
          // Le chemin de coffre brut résoudrait vers share.html (fallback SPA) : mieux vaut une image cassée qu'un <img src> en HTML.
          return "";
        }
      },
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
        <h1 className="break-words text-lg font-semibold">{title || "Note partagée"}</h1>
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
      <h1 className="break-words text-2xl font-semibold [text-wrap:balance]">{title || "Note partagée"}</h1>
      {canvas && (
        <Tabs
          items={VIEW_TABS}
          selectedKey={view}
          onSelectionChange={(k) => setView(k === "canvas" ? "canvas" : "note")}
          className="[&_[role=tabpanel]]:hidden"
        />
      )}
      {/* Masqué plutôt que démonté : l'éditeur garde son état Yjs et son curseur. */}
      <div className={view === "canvas" ? "hidden" : undefined}>
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
      {/* Monté seulement visible : Excalidraw mesure son conteneur au montage, à 0 sous display:none. */}
      {view === "canvas" && canvas && (
        <div className="h-[70dvh] min-h-80 overflow-hidden rounded-lg border border-[var(--border-subtle)]">
          <SupernoteCanvas initialData={canvas} readOnly />
        </div>
      )}
    </div>
  );
}
