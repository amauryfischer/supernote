import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import { COLLAB_FRAGMENT, type EditorCollaboration } from "@supernote/editor";
import { collabUrl, sanitizePeerAwareness } from "@/lib/share/collab";

export interface Peer { name: string; color: string }
export interface NoteCollab {
  status: "off" | "connecting" | "offline" | "ready";
  collaboration?: EditorCollaboration;
  peers: Peer[];
}

export interface NoteCollabHandle extends NoteCollab {
  /** Faux hors connexion : l'état serveur (frappes des invités) n'est alors pas garanti présent. */
  isSynced: () => boolean;
}

const OFFLINE_GRACE_MS = 3000;

export function collabDbName(shareId: string): string {
  return `supernote-collab-${shareId}`;
}

export function useNoteCollab(
  share: { id: string; key: string } | null,
  user: Peer,
  onGone: () => void,
): NoteCollabHandle {
  const [state, setState] = useState<NoteCollab>({ status: "off", peers: [] });
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    if (!share) {
      setState({ status: "off", peers: [] });
      return undefined;
    }
    setState({ status: "connecting", peers: [] });
    let alive = true;
    const doc = new Y.Doc();
    const local = new IndexeddbPersistence(collabDbName(share.id), doc);
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: share.id,
      document: doc,
      token: `owner:${share.key}`,
      // Seul `gone` efface la clé : une panne (`unavailable`) ou un refus transitoire laisse éditer la copie locale.
      onAuthenticationFailed: ({ reason }) => {
        if (reason === "gone") onGoneRef.current();
      },
    });
    providerRef.current = provider;
    // Avant tout montage d'éditeur : les écouteurs lib0 passent dans l'ordre d'inscription, le plugin de curseur lit l'état après nous.
    const unsanitize = provider.awareness ? sanitizePeerAwareness(provider.awareness) : () => {};
    const fragment = doc.getXmlFragment(COLLAB_FRAGMENT);
    let ready = false;
    const markReady = () => {
      if (ready || !alive) return;
      ready = true;
      setState((s) => ({
        ...s,
        status: "ready",
        collaboration: { fragment, provider: { awareness: provider.awareness ?? undefined }, user: userRef.current },
      }));
    };
    provider.on("synced", markReady);
    // Hors ligne : on édite la copie locale, fusionnée (CRDT) à la reconnexion.
    const timer = window.setTimeout(() => {
      void local.whenSynced.then(() => {
        if (fragment.length > 0) markReady();
        else if (!ready && alive) setState((s) => ({ ...s, status: "offline" }));
      });
    }, OFFLINE_GRACE_MS);

    const awareness = provider.awareness;
    let lastPeers = "";
    const onAwareness = () => {
      if (!awareness) return;
      const peers: Peer[] = [];
      awareness.getStates().forEach((s, clientId) => {
        const u = (s as { user?: Peer }).user;
        if (clientId !== awareness.clientID && u) peers.push({ name: u.name, color: u.color });
      });
      // `change` part à chaque déplacement de curseur : ne re-rendre la note que si la liste bouge.
      const key = JSON.stringify(peers);
      if (key === lastPeers) return;
      lastPeers = key;
      setState((st) => ({ ...st, peers }));
    };
    awareness?.on("change", onAwareness);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      awareness?.off("change", onAwareness);
      unsanitize();
      providerRef.current = null;
      provider.destroy();
      void local.destroy();
      doc.destroy();
    };
  }, [share?.id, share?.key]);

  const isSynced = useCallback(() => providerRef.current?.synced ?? false, []);
  return { ...state, isSynced };
}
