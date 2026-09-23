"use client";

/**
 * /share — destination du Web Share Target API.
 *
 * Le SW (`public/sw.js`) intercepte `POST /share-target`, range le FormData
 * dans le Cache Storage `share-inbox` et redirige ici (`303 → /share?pending=1`).
 * Au montage, cette page relit ce cache, crée une note Inbox avec le titre, le
 * texte, le lien et les images partagées, puis rouvre la note créée.
 */

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@heroui/react";
import { EmptyState } from "@supernote/ui";
import { ShareNetwork } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { AppShell, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useWorkerReady, useCreateNote } from "@/components/notes/hooks";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { createVaultFileAdapter } from "@/lib/vault-file-adapter";

const SHARE_INBOX_CACHE = "share-inbox";
const SHARE_INBOX_ENTRY = "/share-target/pending";

interface SharedPayload {
  title: string;
  text: string;
  url: string;
  files: { name: string; type: string; dataUrl: string }[];
}

async function readPendingShare(): Promise<SharedPayload | null> {
  if (typeof caches === "undefined") return null;
  const cache = await caches.open(SHARE_INBOX_CACHE);
  const res = await cache.match(SHARE_INBOX_ENTRY);
  if (!res) return null;
  await cache.delete(SHARE_INBOX_ENTRY);
  return (await res.json()) as SharedPayload;
}

/** Images en pièces jointes : même chemin d'écriture que le collage dans l'éditeur. */
async function embedImages(files: SharedPayload["files"]): Promise<string[]> {
  const adapter = createVaultFileAdapter(() => "Inbox");
  const links: string[] = [];
  for (const f of files) {
    const blob = await fetch(f.dataUrl).then((r) => r.blob());
    const file = new File([blob], f.name, { type: f.type });
    const path = await adapter.upload(file);
    links.push(`![](${path})`);
  }
  return links;
}

export default function SharePage() {
  const isMobile = useIsMobile();
  useMobileTitle(isMobile ? "Partage" : null);
  const workerReady = useWorkerReady();
  const router = useRouter();
  const { createNote } = useCreateNote();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!workerReady || started.current) return;
    started.current = true;
    void (async () => {
      const shared = await readPendingShare();
      if (!shared) {
        router.replace("/mail");
        return;
      }
      try {
        const title = shared.title || shared.url || "Partage";
        const id = await createNote({ folder: "Inbox", title });
        const parts = [shared.text, shared.url ? `[${shared.url}](${shared.url})` : "", ...(await embedImages(shared.files))].filter(Boolean);
        if (parts.length > 0) {
          await trpcVanillaClient.entities.update.mutate({ id, body: parts.join("\n\n") });
        }
        router.replace(`/notes/${id}?folder=Inbox`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [workerReady, createNote, router]);

  let body: React.ReactNode;
  if (!workerReady) {
    body = (
      <EmptyState
        icon={<ShareNetwork size={28} aria-hidden />}
        title="Ouvre un coffre pour recevoir des partages"
      />
    );
  } else if (error) {
    body = (
      <EmptyState
        icon={<ShareNetwork size={28} aria-hidden />}
        title="Le partage n'a pas pu être enregistré"
        description={error}
      />
    );
  } else {
    body = <Spinner size="lg" aria-label="Enregistrement du partage" />;
  }

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col items-center justify-center p-6">{body}</div>
    </AppShell>
  );
}
