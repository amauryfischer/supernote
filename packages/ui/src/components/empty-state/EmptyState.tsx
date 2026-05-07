import * as React from "react";
import { cn } from "../../cn.js";
import { Button } from "../button/Button.js";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "outline";
  icon?: React.ReactNode;
}

export interface EmptyStateProps {
  /** Icon element displayed above the title. */
  icon?: React.ReactNode;
  /** Main heading. */
  title: string;
  /** Explanatory paragraph. */
  description?: string;
  /** Primary CTA action. */
  action?: EmptyStateAction;
  /** Secondary CTA action. */
  secondaryAction?: EmptyStateAction;
  /** Additional class. */
  className?: string;
}

/**
 * EmptyState — placeholder shown when a list or view has no content.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 px-6 py-16 text-center",
        className
      )}
    >
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--surface-2)] text-[var(--text-muted)]">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
        {description && (
          <p className="max-w-xs text-sm text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2">
          {action && (
            <Button
              variant={action.variant ?? "primary"}
              size="sm"
              onClick={action.onClick}
            >
              {action.icon}
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant={secondaryAction.variant ?? "outline"}
              size="sm"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.icon}
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
