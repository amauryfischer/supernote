import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../cn.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[var(--radius-full)] font-medium transition-colors",
  {
    variants: {
      variant: {
        default:  "bg-[var(--surface-3)] text-[var(--text-secondary)]",
        primary:  "bg-[var(--color-primary-100)] text-[var(--color-primary-700)]",
        success:  "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
        warning:  "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
        danger:   "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
        outline:  "border border-[var(--border)] bg-transparent text-[var(--text-secondary)]",
      },
      size: {
        sm: "px-2 py-0.5 text-[10px]",
        md: "px-2.5 py-0.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Optional dot indicator before the label. */
  dot?: boolean;
}

/**
 * Badge — inline label for tags, statuses, and counts.
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, dot, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      )}
      {children}
    </span>
  )
);
Badge.displayName = "Badge";

export { badgeVariants };
