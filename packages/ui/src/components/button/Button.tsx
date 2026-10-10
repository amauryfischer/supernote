import * as React from "react";
import { Button as HeroButton } from "@heroui/react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../cn.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Rôle, pas couleur : `--btn-primary-*` décide du rendu sans que le
        // composant ait à le savoir.
        //
        // ⚠️ `!` obligatoire : HeroUI livre ses `.button--*` HORS layer, et une
        // règle non layerée bat TOUJOURS un utilitaire Tailwind (`@layer
        // utilities`). Sans important, `.button--ghost` — la variante passée au
        // HeroButton sous-jacent — repeignait le bouton en transparent et le
        // primaire n'existait tout simplement pas. Même traitement pour secondary et
        // tertiary, qui s'affichaient en ghost. Pas pour ghost/outline : leur fond est
        // déjà transparent, et `!` écraserait les couleurs passées en `style`.
        primary:
          "bg-[var(--btn-primary-bg)]! text-[var(--btn-primary-fg)]! hover:bg-[var(--btn-primary-bg-hover)]! active:bg-[var(--btn-primary-bg-hover)]!",
        secondary:
          "bg-[var(--surface-2)]! text-[var(--text-primary)]! hover:bg-[var(--surface-3)]!",
        tertiary:
          "bg-[var(--accent-subtle)]! text-[var(--accent)]! hover:brightness-90",
        outline:
          "border border-[var(--border)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--surface-2)]",
        ghost:
          "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]",
        danger:
          "bg-[var(--color-danger)]! text-[var(--color-danger-foreground)]! hover:bg-[var(--color-danger-700)]!",
        "danger-soft":
          "bg-[var(--color-danger-50)]! text-[var(--color-danger)]! hover:bg-[var(--color-danger-100)]!",
      },
      size: {
        sm:   "h-9 md:h-8 rounded-[var(--radius-md)] px-3 text-sm",
        md:   "h-9 rounded-[var(--radius-md)] px-4 text-sm",
        lg:   "h-11 rounded-[var(--radius-lg)] px-5 text-base",
        icon: "h-9 w-9 md:h-8 md:w-8 rounded-[var(--radius-md)] p-0",
      },
    },
    defaultVariants: {
      // Rendu réel des boutons sans variante avant le correctif `!` ci-dessus.
      variant: "ghost",
      size: "md",
    },
  }
);

// ⚠️ tailwind-merge ne dédoublonne pas `h-7` et `md:h-8` (variantes différentes) :
// un h-/w- imposé par le site doit aussi retirer le `md:` de la taille, sinon il
// perd au-dessus de 768 px.
function withoutMdSize(base: string, className: unknown): string {
  if (typeof className !== "string") return base;
  let out = base;
  if (/(^|\s)h-/.test(className)) out = out.replace(/\smd:h-\S+/, "");
  if (/(^|\s)w-/.test(className)) out = out.replace(/\smd:w-\S+/, "");
  return out;
}

/** Supernote Button variant options. Kept separate from HeroUI's ButtonRootProps.variant. */
export type ButtonVariant = "primary" | "secondary" | "tertiary" | "outline" | "ghost" | "danger" | "danger-soft";
/** Supernote Button size options. */
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends Omit<React.ComponentPropsWithRef<typeof HeroButton>, "variant" | "size"> {
  /** Visual style variant. */
  variant?: ButtonVariant;
  /** Size preset. */
  size?: ButtonSize;
  /** Show loading indicator and disable interactions. */
  isLoading?: boolean;
}

/**
 * Button — ergonomic wrapper over HeroUI v3 Button.
 * Variants: `primary | secondary | tertiary | outline | ghost | danger | danger-soft`
 * Sizes: `sm | md | lg | icon`
 * All colors come from CSS tokens — no hardcoded values.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, isLoading, isDisabled, children, ...props },
    ref
  ) => (
    <HeroButton
      ref={ref}
      variant="ghost"
      isDisabled={isDisabled ?? isLoading}
      className={cn(withoutMdSize(buttonVariants({ variant, size }), className), className)}
      {...props}
    >
      {children}
    </HeroButton>
  )
);

Button.displayName = "Button";

export { buttonVariants };
