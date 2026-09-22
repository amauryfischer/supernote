import type { Awareness } from "y-protocols/awareness";

export const NOTE_SHARE_EVENT = "supernote:note-share";

export function collabUrl(): string {
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/collab`;
}

const CURSOR_COLORS = ["#2f62d9", "#c2410c", "#15803d", "#a21caf", "#b45309", "#0e7490", "#be123c", "#4d7c0f"];

export function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length]!;
}

// 6 chiffres exactement : y-prosemirror suffixe l'alpha (`${color}70`).
const PEER_COLOR = /^#[0-9a-f]{6}$/i;

/** Réécrit en place `user` des pairs (couleur, nom) : les plugins de curseur l'injectent tel quel dans `style`. Renvoie la désinscription. */
export function sanitizePeerAwareness(awareness: Awareness): () => void {
  const clean = () => {
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.clientID || !("user" in state)) return;
      const user: unknown = state["user"];
      const u: Record<string, unknown> = user && typeof user === "object" ? (user as Record<string, unknown>) : {};
      if (typeof u["color"] !== "string" || !PEER_COLOR.test(u["color"])) u["color"] = "#888888";
      u["name"] = typeof u["name"] === "string" && u["name"] ? u["name"].slice(0, 40) : "Invité";
      state["user"] = u;
    });
  };
  awareness.on("change", clean);
  return () => awareness.off("change", clean);
}
