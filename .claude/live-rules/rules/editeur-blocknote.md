---
description: "Boucle de debug @supernote/editor et pièges ProseMirror"
globs: ["packages/editor/**"]
priority: 20
---
`apps/web` consomme `@supernote/editor` via **dist/**, sans alias Vite vers src. Toute modif TypeScript de l'éditeur exige `pnpm --filter @supernote/editor build` avant de recharger le navigateur. Le CSS (`editor.css`) est exporté depuis src, un simple reload suffit.

Banc de test sans coffre : la WritingSurface de l'Accueil (`/`, « Continuer sans dossier ») fait tourner SupernoteEditor complet. La persistence RPC timeout mais l'édition client marche. Les pages Notes sont inutilisables sans coffre.

⚠️ **Piège MutationObserver ProseMirror.** Toute mutation d'attribut DOM sur un élément du subtree `.ProseMirror` (par exemple un `setAttribute` sur `.bn-block-outer` depuis un listener `selectionchange`) est vue par l'observer de PM. Pendant une conversion de bloc vers un NodeView React (contentDOM monté async), PM re-parse et re-résout la sélection à la frontière du blockGroup, et les frappes partent dans le mauvais bloc. Pour marquer un bloc visuellement : toujours une balise `<style>` dynamique dans `<head>`, keyée sur `data-id`.

⚠️ **Piège sélection collapsée par un sous-menu.** Un toggle React sur un contrôle de `FloatingFormattingToolbar` (rendue dans `bn-root`) qui monte un sous-menu au clic trusted collapse la sélection PM, donc la toolbar se démonte avant que le menu paraisse. Le motif qui marche, voir `editorChrome.tsx` : capturer `{from,to}` à l'ouverture, garder la toolbar montée tant que le sous-menu est ouvert (box gelée dans un ref), restaurer via `setTextSelection` juste avant d'appliquer le style.

Automation navigateur : après reload, le premier clic sur le placeholder est souvent absorbé par l'hydration. Sous WSL, `Page.captureScreenshot` peut timeout ; piloter alors l'éditeur via `pm.focus()` + `execCommand`, et déclencher les handlers par les props React plutôt que par coordonnées.
