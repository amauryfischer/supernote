// Module sans dépendance : importable depuis le shell sans tirer l'éditeur de modèles.
export const TEMPLATE_PICKER_EVENT = "supernote:new-note-from-template";

/** Ouvre le choix « Nouvelle note depuis un modèle », monté une fois par CommandSurface. */
export function openTemplatePicker(): void {
  window.dispatchEvent(new CustomEvent(TEMPLATE_PICKER_EVENT));
}
