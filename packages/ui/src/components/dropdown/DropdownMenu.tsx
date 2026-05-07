import * as React from "react";
import {
  DropdownRoot,
  DropdownTrigger,
  DropdownMenu as HeroDropdownMenu,
  DropdownItem,
  DropdownPopover,
} from "@heroui/react";
import { cn } from "../../cn.js";

export interface DropdownMenuItem {
  key: string;
  label: React.ReactNode;
  /** Icon slot rendered before the label. */
  startContent?: React.ReactNode;
  /** Icon slot rendered after the label. */
  endContent?: React.ReactNode;
  /** Marks item as destructive (danger color). */
  isDanger?: boolean;
  /** Disabled state. */
  isDisabled?: boolean;
  /** Keyboard shortcut hint. */
  shortcut?: string;
  /** Separator before this item. */
  separator?: boolean;
  /** Called when this item is pressed. */
  onPress?: () => void;
}

export interface DropdownMenuSection {
  key: string;
  title?: string;
  items: DropdownMenuItem[];
}

export interface DropdownMenuProps {
  /** Element that opens the dropdown. */
  trigger: React.ReactNode;
  /** Flat list of items. */
  items?: DropdownMenuItem[];
  /** Sectioned items (use instead of items for grouped menus). */
  sections?: DropdownMenuSection[];
  /** Called when any item key is selected. */
  onAction?: (key: string) => void;
  /** Additional class for the popover. */
  className?: string;
}

const itemClass =
  "cursor-pointer rounded-[var(--radius-md)] px-3 py-1.5 text-sm outline-none data-[focused]:bg-[var(--surface-2)] data-[hovered]:bg-[var(--surface-2)]";

function renderItem(item: DropdownMenuItem) {
  return (
    <DropdownItem
      key={item.key}
      isDisabled={item.isDisabled}
      onPress={item.onPress}
      className={cn(
        itemClass,
        item.isDanger ? "text-[var(--color-danger)]" : "text-[var(--text-primary)]"
      )}
    >
      <span className="flex items-center gap-2.5">
        {item.startContent && (
          <span className="shrink-0 text-[var(--text-muted)]">
            {item.startContent}
          </span>
        )}
        <span className="flex-1">{item.label}</span>
        {(item.endContent ?? item.shortcut) && (
          <span className="ml-auto shrink-0 text-xs text-[var(--text-muted)]">
            {item.endContent ?? item.shortcut}
          </span>
        )}
      </span>
    </DropdownItem>
  );
}

/**
 * DropdownMenu — context menu opened by a trigger element.
 */
export function DropdownMenu({
  trigger,
  items,
  sections,
  onAction,
  className,
}: DropdownMenuProps) {
  // Flatten sections into a single list with visual separators
  const flatItems: DropdownMenuItem[] = sections
    ? sections.flatMap((section, sectionIndex) => {
        const sectionItems = section.items.map((item, itemIndex) => ({
          ...item,
          separator: sectionIndex > 0 && itemIndex === 0,
        }));
        return sectionItems;
      })
    : (items ?? []);

  return (
    <DropdownRoot>
      <DropdownTrigger>{trigger as React.ReactElement}</DropdownTrigger>
      <DropdownPopover
        className={cn(
          "z-[var(--z-dropdown)] min-w-[180px] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-1 [box-shadow:var(--shadow-lg)]",
          className
        )}
      >
        <HeroDropdownMenu onAction={(key) => onAction?.(String(key))}>
          {flatItems.map((item, i) => (
            <React.Fragment key={item.key}>
              {item.separator && (
                <div
                  key={`sep-${i}`}
                  role="separator"
                  className="my-1 h-px bg-[var(--border-subtle)]"
                />
              )}
              {renderItem(item)}
            </React.Fragment>
          ))}
        </HeroDropdownMenu>
      </DropdownPopover>
    </DropdownRoot>
  );
}
