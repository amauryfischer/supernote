# Motion system — the "liquid" feel, everywhere

This is the app's shared motion vocabulary, distilled from the smooth caret
(`packages/editor/src/SmoothCaret.tsx`). The goal: the **whole app should move
the way the caret glides** — quick, continuous, decelerating to rest, never
janky, never gratuitous. One feel, not 20 hand-rolled easings.

## The DNA (6 principles)

1. **Decelerate to rest.** Motion starts fast and eases out — the signature is
   `--sn-ease-glide`. Nothing moves at constant speed; nothing stops abruptly.
2. **Quick.** The caret glides in ~110ms. Durations live in `--sn-dur-1..4`
   (90 / 150 / 220 / 320ms). If you reach past `--sn-dur-4`, reconsider.
3. **Continuous, not restarting.** For value-driven motion (a number that keeps
   changing — drag follow, scroll position, counter), use the exponential
   smoothing engine (`createSmoothScalar` / `useSmoothValue`), **not** a CSS
   transition that re-eases on every retarget. For discrete state changes
   (hover, open/close, selection) a token-based CSS transition is correct.
4. **Settle and suspend.** Idle surfaces cost zero frames. The engine stops its
   rAF once settled; CSS transitions are inherently idle-free.
5. **Purposeful, restrained.** Motion communicates a change (something entered,
   moved, got focus). It is never decoration-for-its-own-sake. When in doubt,
   subtler and faster.
6. **Reduced-motion is sacred.** Every animation degrades to instant under
   `prefers-reduced-motion: reduce`. The motion-system CSS utilities and the JS
   engine already honour it — keep any bespoke keyframes inside a
   `@media (prefers-reduced-motion: no-preference)` guard.

## What to reach for

### CSS tokens (the default — covers ~90% of surfaces)

Defined on `:root` in `apps/web/src/globals.css`. They cascade everywhere,
including `editor.css`.

| Token | Use |
| --- | --- |
| `--sn-ease-glide` | signature decel — transforms, slides, the default |
| `--sn-ease-out` | softer decel for large layout moves (panels, drawers) |
| `--sn-ease-spring` | slight overshoot — press, pop, check |
| `--sn-ease-standard` | symmetric — color / opacity fades |
| `--sn-dur-1..4` | 90 / 150 / 220 / 320ms |
| `--sn-transition-colors` | drop-in for hover/active/selection color changes |
| `--sn-transition-transform` | drop-in transform glide |
| `--sn-transition-opacity` | drop-in opacity fade |
| `--sn-transition-glide` | transform + opacity together (enter/leave) |

Utility classes (also in `globals.css`), all reduced-motion-safe:

- `.sn-motion-colors` — smooth color/bg/border state changes
- `.sn-motion-glide` — glide transform + opacity
- `.sn-pressable` — tactile `scale(0.96)` on `:active`
- `.sn-hover-lift` — subtle `translateY(-2px)` on hover
- `.sn-overlay-in` / `.sn-pop-in` — entrance animations for overlays/popovers

Inline example:

```tsx
<div style={{ transition: "var(--sn-transition-glide)" }} />
// or
<button className="sn-pressable">…</button>
```

### JS engine (for continuous, value-driven motion only)

```ts
import { useSmoothValue, createSmoothScalar } from "@/lib/motion";

// React, value-driven (animated counter, smooth progress):
const shown = useSmoothValue(progress);          // re-renders only while moving

// Imperative, hot path (write straight to a ref — no React per frame):
const s = createSmoothScalar((v) => { el.style.transform = `translateX(${v}px)`; });
s.setTarget(420);   // glides; suspends when settled
s.jumpTo(0);        // teleport, no glide
s.stop();           // on cleanup
```

## Don't

- Don't add `framer-motion` / `react-spring` — pure CSS + rAF is the house style.
- Don't animate `width`/`height`/`top`/`left` when `transform`/`opacity` will do
  (layout thrash). Prefer compositor-friendly properties.
- Don't blanket-animate an element that a framework recreates on every keystroke
  (see the editor's block-enter note) — keyframes replay and the text flickers.
- Don't exceed `--sn-dur-4` for interaction feedback. Slow ≠ smooth.
