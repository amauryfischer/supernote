import * as React from "react";
import {
  TabsRoot,
  TabListContainer,
  TabList,
  Tab,
  TabPanel,
} from "@heroui/react";
import { cn } from "../../cn.js";

export interface TabItem {
  key: string;
  label: React.ReactNode;
  /** Icon rendered before the label. */
  icon?: React.ReactNode;
  /** Tab panel content. */
  content?: React.ReactNode;
  /** Disabled state. */
  isDisabled?: boolean;
}

export interface TabsProps {
  /** Tab definitions. */
  items: TabItem[];
  /** Controlled selected key. */
  selectedKey?: string;
  /** Called when tab changes. */
  onSelectionChange?: (key: string) => void;
  /** Visual style of the tab list. */
  variant?: "primary" | "secondary";
  /** Additional class for the root element. */
  className?: string;
  /** Default selected tab key (uncontrolled). */
  defaultSelectedKey?: string;
}

/**
 * Tabs — tabbed navigation with panel content slots.
 * Uses HeroUI v3 compound component pattern.
 */
export function Tabs({
  items,
  selectedKey,
  onSelectionChange,
  variant = "primary",
  className,
  defaultSelectedKey,
}: TabsProps) {
  return (
    <TabsRoot
      selectedKey={selectedKey}
      defaultSelectedKey={defaultSelectedKey ?? items[0]?.key}
      onSelectionChange={(key) => onSelectionChange?.(String(key))}
      variant={variant}
      className={cn("w-full", className)}
    >
      <TabListContainer>
        <TabList className="border-b border-[var(--border-subtle)]">
          {items.map((item) => (
            <Tab
              key={item.key}
              id={item.key}
              isDisabled={item.isDisabled}
              className={cn(
                "border-b-2 border-transparent px-4 py-2 text-sm text-[var(--text-muted)] transition-colors",
                "data-[selected]:border-[var(--color-primary)] data-[selected]:text-[var(--color-primary)]",
                "hover:text-[var(--text-secondary)]"
              )}
            >
              {item.icon ? (
                <span className="flex items-center gap-1.5">
                  {item.icon}
                  {item.label}
                </span>
              ) : (
                item.label
              )}
            </Tab>
          ))}
        </TabList>
      </TabListContainer>
      {items.map((item) => (
        <TabPanel key={item.key} id={item.key} className="py-4">
          {item.content}
        </TabPanel>
      ))}
    </TabsRoot>
  );
}

