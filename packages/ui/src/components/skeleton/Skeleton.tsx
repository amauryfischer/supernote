import * as React from "react";
import { SkeletonRoot } from "@heroui/react";
import { cn } from "../../cn.js";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Applies full-circle rounding (for avatar skeletons). */
  isCircle?: boolean;
}

/**
 * Skeleton — animated loading placeholder.
 */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, isCircle, ...props }, ref) => (
    <SkeletonRoot
      ref={ref}
      className={cn(
        "animate-pulse bg-[var(--surface-3)]",
        isCircle ? "rounded-full" : "rounded-[var(--radius-md)]",
        className
      )}
      {...props}
    />
  )
);
Skeleton.displayName = "Skeleton";

/** Pre-composed skeleton for a text block. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i === lines - 1 ? "w-3/4" : "w-full")}
        />
      ))}
    </div>
  );
}

/** Pre-composed skeleton for a card layout. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton isCircle className="h-10 w-10" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

