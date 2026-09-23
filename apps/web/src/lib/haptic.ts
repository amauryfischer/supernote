// ⚠️ Safari iOS n'expose pas `navigator.vibrate` : no-op silencieux là-bas.
export function haptic(ms = 10): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
}
