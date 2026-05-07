import * as React from "react";
import { Tooltip as HeroTooltip, TooltipContent, TooltipArrow } from "@heroui/react";
import { cn } from "../../cn.js";

export interface TooltipProps {
  /** Tooltip text content. */
  content: React.ReactNode;
  /** Element that triggers the tooltip. Must be a single React element. */
  children: React.ReactElement;
  /** Side the tooltip appears relative to the trigger. */
  placement?: "top" | "bottom" | "left" | "right";
  /** Delay before showing, in ms. */
  delay?: number;
  /** Show arrow pointing at the trigger. */
  showArrow?: boolean;
  /** Additional class for the tooltip content. */
  className?: string;
}

/**
 * Tooltip — floating label on hover/focus.
 * Uses HeroUI v3 compound component.
 */
export function Tooltip({
  content,
  children,
  placement = "top",
  delay = 300,
  showArrow = false,
  className,
}: TooltipProps) {
  return (
    <HeroTooltip delay={delay}>
      {children}
      <TooltipContent
        placement={placement}
        showArrow={showArrow}
        className={cn(
          "z-[var(--z-tooltip)] rounded-[var(--radius-md)] bg-[var(--surface-3)] px-3 py-1.5 text-xs text-[var(--text-primary)] [box-shadow:var(--shadow-md)]",
          className
        )}
      >
        {content}
        {showArrow && <TooltipArrow />}
      </TooltipContent>
    </HeroTooltip>
  );
}
