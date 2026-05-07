import * as React from "react";
import {
  AutocompleteRoot,
  AutocompleteTrigger,
  AutocompleteValue,
  AutocompleteIndicator,
  AutocompleteClearButton,
  AutocompleteFilter,
  AutocompletePopover,
  ListBox,
  ListBoxItem,
} from "@heroui/react";
import { cn } from "../../cn.js";

export interface ComboboxOption {
  key: string;
  label: string;
  description?: string;
  startContent?: React.ReactNode;
  isDisabled?: boolean;
}

export interface ComboboxOptionGroup {
  key: string;
  title: string;
  options: ComboboxOption[];
}

export interface ComboboxProps {
  /** Flat option list. */
  options?: ComboboxOption[];
  /** Controlled selected key. */
  selectedKey?: string;
  /** Called when selection changes. */
  onSelectionChange?: (key: string | null) => void;
  /** Placeholder. */
  placeholder?: string;
  /** Field label. */
  label?: string;
  /** Error message. */
  errorMessage?: string;
  /** Error state. */
  isInvalid?: boolean;
  /** Disabled state. */
  isDisabled?: boolean;
  /** Additional class. */
  className?: string;
}

/**
 * Combobox — searchable select with autocomplete behavior.
 * Uses HeroUI v3 AutocompleteRoot compound component.
 */
export function Combobox({
  options = [],
  selectedKey,
  onSelectionChange,
  placeholder = "Search or select…",
  label,
  errorMessage,
  isInvalid,
  isDisabled,
  className,
}: ComboboxProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label && (
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </span>
      )}
      <AutocompleteRoot
        selectedKey={selectedKey}
        onSelectionChange={(key) => onSelectionChange?.(key as string | null)}
        isDisabled={isDisabled}
        isInvalid={isInvalid}
      >
        <AutocompleteTrigger
          className={cn(
            "flex w-full items-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-1)] text-sm transition-colors focus-within:border-[var(--border-focus)] focus-within:ring-2 focus-within:ring-[var(--accent-subtle)]",
            isInvalid && "border-[var(--color-danger)]",
            isDisabled && "cursor-not-allowed opacity-50"
          )}
        >
          <AutocompleteFilter>
            <input
              placeholder={placeholder}
              className="flex-1 bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
          </AutocompleteFilter>
          <AutocompleteClearButton className="px-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <span aria-hidden="true">×</span>
          </AutocompleteClearButton>
          <AutocompleteIndicator className="mr-2 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        </AutocompleteTrigger>
        <AutocompletePopover className="z-[var(--z-dropdown)] min-w-[var(--trigger-width)] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-1 [box-shadow:var(--shadow-md)]">
          <ListBox className="max-h-64 overflow-y-auto outline-none">
            {options.map((opt) => (
              <ListBoxItem
                key={opt.key}
                id={opt.key}
                isDisabled={opt.isDisabled}
                className="cursor-pointer rounded-[var(--radius-md)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none data-[focused]:bg-[var(--surface-2)] data-[hovered]:bg-[var(--surface-2)] data-[selected]:text-[var(--color-primary)]"
              >
                {opt.label}
              </ListBoxItem>
            ))}
          </ListBox>
        </AutocompletePopover>
      </AutocompleteRoot>
      {errorMessage && (
        <p className="text-xs text-[var(--color-danger)]">{errorMessage}</p>
      )}
    </div>
  );
}

