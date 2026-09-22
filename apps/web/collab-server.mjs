/**
 * collab-server — serveur Yjs (Hocuspocus 4) pour la co-édition des notes
 * partagées, greffé sur le `upgrade` du serveur HTTP existant via crossws.
 * Un document = une ressource de partage (`documentName` = id de ressource).
 */

import { Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import crossws from "crossws/adapters/node";

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

// ponytail: état des documents en mémoire d'un seul conteneur ;
// plusieurs conteneurs exigent @hocuspocus/extension-redis.
export function createCollabServer({ store, authenticate }) {
  const hocuspocus = new Hocuspocus({
    extensions: [
      new Database({
        fetch: ({ documentName }) => store.getDoc(documentName),
        // Le store différé peut tomber après la suppression : ne pas ressusciter la ligne.
        store: async ({ documentName, state }) => {
          if (await store.getResource(documentName)) await store.putDoc(documentName, state);
        },
      }),
    ],
    async onAuthenticate({ documentName, token, connectionConfig }) {
      const access = await authenticate(documentName, token);
      if (access.readOnly) connectionConfig.readOnly = true;
      return { slug: access.slug };
    },
  });

  const ws = crossws({
    // Refusé avant parsing : un invité ne pousse pas un document démesuré.
    serverOptions: { maxPayload: MAX_PAYLOAD_BYTES },
    hooks: {
      open(peer) {
        peer.hocuspocus = hocuspocus.handleConnection(peer.websocket, peer.request, {});
      },
      message(peer, message) {
        peer.hocuspocus?.handleMessage(message.uint8Array());
      },
      close(peer, event) {
        peer.hocuspocus?.handleClose({ code: event.code, reason: event.reason });
      },
      error(_peer, error) {
        console.error("[collab]", error);
      },
    },
  });

  function connectionsOf(resourceId) {
    return [...(hocuspocus.documents.get(resourceId)?.connections.keys() ?? [])];
  }

  // Sans fermeture du socket, le provider reste « connecté » et ne se réauthentifie jamais.
  function cut(connection) {
    connection.close();
    connection.webSocket.close();
  }

  return {
    handleUpgrade: (req, socket, head) => ws.handleUpgrade(req, socket, head),
    closeLink(resourceId, slug) {
      for (const c of connectionsOf(resourceId)) if (c.context?.slug === slug) cut(c);
    },
    closeResource(resourceId) {
      for (const c of connectionsOf(resourceId)) cut(c);
    },
    async sweep(isValid) {
      for (const [resourceId] of hocuspocus.documents) {
        for (const c of connectionsOf(resourceId)) {
          const slug = c.context?.slug;
          if (slug && !(await isValid(slug))) cut(c);
        }
      }
    },
  };
}
