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
