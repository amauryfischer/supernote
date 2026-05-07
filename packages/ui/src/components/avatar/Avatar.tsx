import * as React from "react";
import { AvatarRoot, AvatarImage, AvatarFallback } from "@heroui/react";
import { cn } from "../../cn.js";

export interface AvatarProps {
  /** Image URL. */
  src?: string;
  /** Fallback text (initials) when no src. */
  name?: string;
  /** Alt text for the image. */
  alt?: string;
  /** Size preset. */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Show border ring. */
  isBordered?: boolean;
  /** Additional class. */
  className?: string;
}

const sizeClass: Record<NonNullable<AvatarProps["size"]>, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-lg",
};

function getInitials(name?: string): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Avatar — user or entity picture with initials fallback.
 */
export function Avatar({
  src,
  name,
  alt,
  size = "md",
  isBordered = false,
  className,
}: AvatarProps) {
  return (
    <AvatarRoot
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full bg-[var(--color-primary-100)]",
        isBordered && "ring-2 ring-[var(--color-primary)] ring-offset-1",
        sizeClass[size],
        className
      )}
    >
      {src && (
        <AvatarImage
          src={src}
          className="h-full w-full object-cover"
          crossOrigin="anonymous"
        />
      )}
      <AvatarFallback className="flex h-full w-full items-center justify-center font-medium text-[var(--color-primary-700)]">
        {getInitials(name)}
      </AvatarFallback>
    </AvatarRoot>
  );
}

export interface AvatarGroupProps {
  /** Avatar items. */
  avatars: AvatarProps[];
  /** Maximum visible avatars before "+N" overflow. */
  max?: number;
  /** Size passed to all avatars. */
  size?: AvatarProps["size"];
  /** Additional class. */
  className?: string;
}

/**
 * AvatarGroup — horizontally stacked avatar collection with overflow count.
 */
export function AvatarGroup({
  avatars,
  max = 4,
  size = "sm",
  className,
}: AvatarGroupProps) {
  const visible = avatars.slice(0, max);
  const overflow = avatars.length - visible.length;

  return (
    <div className={cn("flex items-center -space-x-2", className)}>
      {visible.map((props, i) => (
        <Avatar key={i} size={size} {...props} isBordered />
      ))}
      {overflow > 0 && (
        <div
          className={cn(
            "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--surface-3)] font-medium text-[var(--text-secondary)] ring-2 ring-[var(--surface-1)]",
            sizeClass[size]
          )}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

