import * as React from "react";
import {
  Card as HeroCard,
  CardHeader as HeroCardHeader,
  CardContent as HeroCardContent,
  CardFooter as HeroCardFooter,
} from "@heroui/react";
import { cn } from "../../cn.js";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Visual elevation level affecting shadow intensity. */
  elevation?: "none" | "sm" | "md" | "lg";
}

const elevationClass: Record<NonNullable<CardProps["elevation"]>, string> = {
  none: "shadow-none",
  sm:   "[box-shadow:var(--shadow-sm)]",
  md:   "[box-shadow:var(--shadow-md)]",
  lg:   "[box-shadow:var(--shadow-lg)]",
};

/**
 * Card — surface container with optional elevation.
 * Compose with CardHeader, CardContent, CardFooter.
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevation = "sm", children, ...props }, ref) => (
    <HeroCard
      ref={ref}
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-1)]",
        elevationClass[elevation],
        className
      )}
      {...props}
    >
      {children}
    </HeroCard>
  )
);
Card.displayName = "Card";

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, children, ...props }, ref) => (
    <HeroCardHeader
      ref={ref}
      className={cn(
        "flex flex-col gap-1 border-b border-[var(--border-subtle)] px-5 pb-4 pt-5",
        className
      )}
      {...props}
    >
      {children}
    </HeroCardHeader>
  )
);
CardHeader.displayName = "CardHeader";

export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, children, ...props }, ref) => (
    <HeroCardContent
      ref={ref}
      className={cn("px-5 py-4 text-[var(--text-primary)]", className)}
      {...props}
    >
      {children}
    </HeroCardContent>
  )
);
CardContent.displayName = "CardContent";

export interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

export const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, children, ...props }, ref) => (
    <HeroCardFooter
      ref={ref}
      className={cn(
        "border-t border-[var(--border-subtle)] px-5 pb-5 pt-4",
        className
      )}
      {...props}
    >
      {children}
    </HeroCardFooter>
  )
);
CardFooter.displayName = "CardFooter";
