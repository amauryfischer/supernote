import * as React from "react";
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectIndicator,
  SelectPopover,
  ListBox,
  ListBoxItem,
} from "@heroui/react";
import { cn } from "../../cn.js";

export interface SelectOption {
  key: string;
  label: string;
  description?: string;
  startContent?: React.ReactNode;
  isDisabled?: boolean;
}

export interface SelectOptionGroup {
  key: string;
  title: string;
  options: SelectOption[];
}

export interface SelectProps {
  /** Option list. */
  options?: SelectOption[];
  /** Controlled selected key. */
  selectedKey?: string;
  /** Called when selection changes. */
  onSelectionChange?: (key: string) => void;
  /** Placeholder text. */
  placeholder?: string;
  /** Field label. */
  label?: string;
  /** Nom accessible quand aucun `label` visible n'est affiché. */
  "aria-label"?: string;
  /** Error message. */
  errorMessage?: string;
  /** Error state. */
  isInvalid?: boolean;
  /** Disabled state. */
  isDisabled?: boolean;
  /** Rendu de la valeur sélectionnée dans le trigger (défaut : contenu de l'item). */
  renderValue?: (option: SelectOption) => React.ReactNode;
  /** Classes ajoutées au trigger (après les classes de base). */
  triggerClassName?: string;
  /** Additional class. */
  className?: string;
}

/**
 * Select — single-value dropdown selection.
 * Uses HeroUI v3 compound component.
 */
export function Select({
  options = [],
  selectedKey,
  onSelectionChange,
  placeholder = "Select an option",
  label,
  "aria-label": ariaLabel,
  errorMessage,
  isInvalid,
  isDisabled,
  className,
  renderValue,
  triggerClassName,
}: SelectProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label && (
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </span>
      )}
      <SelectRoot
        selectedKey={selectedKey}
        onSelectionChange={(key) => {
          if (key != null) onSelectionChange?.(String(key));
        }}
        isDisabled={isDisabled}
        isInvalid={isInvalid}
        aria-label={ariaLabel}
      >
        <SelectTrigger
          className={cn(
            "flex w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-2)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)] disabled:cursor-not-allowed disabled:opacity-50",
            isInvalid && "border-[var(--color-danger)]",
            triggerClassName
          )}
        >
          <SelectValue className="min-w-0 flex-1 overflow-hidden text-left text-[var(--text-primary)] data-[placeholder]:text-[var(--text-muted)]">
            {({ isPlaceholder, defaultChildren }) => {
              if (isPlaceholder) return placeholder;
              const sel = renderValue ? options.find((o) => o.key === selectedKey) : undefined;
              return sel && renderValue ? renderValue(sel) : defaultChildren;
            }}
          </SelectValue>
          <SelectIndicator className="ml-2 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        </SelectTrigger>
        <SelectPopover className="z-[var(--z-dropdown)] min-w-[var(--trigger-width)] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-1 [box-shadow:var(--shadow-md)]">
          <ListBox className="outline-none">
            {options.map((opt) => (
              <ListBoxItem
                key={opt.key}
                id={opt.key}
                textValue={opt.label}
                isDisabled={opt.isDisabled}
                className="cursor-pointer rounded-[var(--radius-md)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none data-[focused]:bg-[var(--surface-2)] data-[hovered]:bg-[var(--surface-2)] data-[selected]:text-[var(--color-primary)]"
              >
                {opt.startContent || opt.description ? (
                  <span className="flex items-center gap-2">
                    {opt.startContent}
                    <span className="flex min-w-0 flex-col">
                      <span>{opt.label}</span>
                      {opt.description && (
                        <span className="text-xs text-[var(--text-muted)]">{opt.description}</span>
                      )}
                    </span>
                  </span>
                ) : (
                  opt.label
                )}
              </ListBoxItem>
            ))}
          </ListBox>
        </SelectPopover>
      </SelectRoot>
      {errorMessage && (
        <p className="text-xs text-[var(--color-danger)]">{errorMessage}</p>
      )}
    </div>
  );
}

