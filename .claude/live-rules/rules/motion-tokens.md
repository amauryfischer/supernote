---
description: "Toute animation passe par les tokens --sn-* et le moteur lib/motion"
globs: ["apps/web/**/*.tsx", "apps/web/**/*.css", "packages/ui/**/*.tsx", "packages/ui/**/*.css"]
priority: 15
---
L'app a un langage de mouvement unique, l'ADN du SmoothCaret. Toute nouvelle transition le consomme. **Jamais** framer-motion, react-spring, ni cubic-bezier ad-hoc.

Source de vérité :
- Tokens dans `apps/web/src/globals.css :root` — easings `--sn-ease-glide` (signature), `--sn-ease-out`, `--sn-ease-spring`, `--sn-ease-standard` ; durées `--sn-dur-1..4` ; composites `--sn-transition-*`.
- Utilitaires sûrs pour reduced-motion : `.sn-motion-colors`, `.sn-motion-glide`, `.sn-pressable`, `.sn-hover-lift`, `.sn-overlay-in`, `.sn-pop-in`.
- Moteur continu : `apps/web/src/lib/motion/` (`createSmoothScalar`, `useSmoothValue`, `prefersReducedMotion`), doc dans son README.

Transition CSS pour un état discret (hover, open, select). Moteur JS pour une valeur continue (drag-follow, scroll, compteur). Animer `transform` et `opacity`, pas `width`/`height`/`top`/`left`.

**Mode de saisie : décider au pointeur, jamais à la largeur.** `md:` confond deux axes indépendants. `.sn-reveal` pour une affordance secondaire (visible par défaut, masquée seulement sous `(hover: hover) and (not (any-pointer: coarse))`), `.sn-hit` pour le plancher tactile 32×32 sous `(any-pointer: coarse)`. Une cible dont la taille visuelle est imposée (case 16px) prend un anneau `::before` négatif, pas `.sn-hit`.

⚠️ Cascade : `.sn-pressable` est défini **après** `.sn-motion-colors`. Empiler les deux fait gagner le `transition` de `.sn-pressable` et perdre l'ease couleur. Si tu veux couleur + transform sur le même élément, compose un `transition` inline.
