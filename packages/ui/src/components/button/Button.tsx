import * as React from "react";
import { Button as HeroButton } from "@heroui/react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../cn.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary-700)] active:bg-[var(--color-primary-800)]",
        secondary:
          "bg-[var(--surface-2)] text-[var(--text-primary)] hover:bg-[var(--surface-3)]",
        tertiary:
          "bg-[var(--accent-subtle)] text-[var(--accent)] hover:brightness-90",
        outline:
          "border border-[var(--border)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--surface-2)]",
        ghost:
          "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]",
        danger:
          "bg-[var(--color-danger)] text-[var(--color-danger-foreground)] hover:bg-[var(--color-danger-700)]",
      },
      size: {
        sm:   "h-7 rounded-[var(--radius-md)] px-3 text-xs",
        md:   "h-9 rounded-[var(--radius-md)] px-4 text-sm",
        lg:   "h-11 rounded-[var(--radius-lg)] px-5 text-base",
        icon: "h-8 w-8 rounded-[var(--radius-md)] p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
);

/** Supernote Button variant options. Kept separate from HeroUI's ButtonRootProps.variant. */
export type ButtonVariant = "primary" | "secondary" | "tertiary" | "outline" | "ghost" | "danger";
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
 * Variants: `primary | secondary | tertiary | outline | ghost | danger`
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
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </HeroButton>
  )
);

Button.displayName = "Button";

export { buttonVariants };
