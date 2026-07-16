import * as React from "react";
import { CheckCircle, Info, Warning, X, XCircle, type Icon } from "@phosphor-icons/react";
import { cn } from "../../cn.js";
import { Button } from "../button/Button.js";

export type ToastVariant = "default" | "success" | "warning" | "danger" | "info";

export interface ToastData {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Duration in ms before auto-dismiss. 0 = persistent. */
  duration?: number;
  /** Action button config. */
  action?: { label: string; onClick: () => void };
}

/** Internal shape — `leaving` drives the exit animation before DOM removal. */
interface InternalToast extends ToastData {
  leaving: boolean;
}

interface ToastContextValue {
  toasts: ToastData[];
  toast: (data: Omit<ToastData, "id">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

/** Max toasts visible at once — the oldest is animated out when exceeded. */
const MAX_VISIBLE_TOASTS = 4;
/** Fallback removal delay when the exit animation never fires (reduced motion). */
const EXIT_FALLBACK_MS = 250;

const variantClass: Record<ToastVariant, string> = {
  default: "border-[var(--border)] bg-[var(--surface-1)]",
  success: "border-[var(--color-success-200)] bg-[var(--color-success-50)]",
  warning: "border-[var(--color-warning-200)] bg-[var(--color-warning-50)]",
  danger:  "border-[var(--color-danger-200)] bg-[var(--color-danger-50)]",
  info:    "border-[var(--color-primary-200)] bg-[var(--color-primary-50)]",
};

const variantTitleClass: Record<ToastVariant, string> = {
  default: "text-[var(--text-primary)]",
  success: "text-[var(--color-success-700)]",
  warning: "text-[var(--color-warning-700)]",
  danger:  "text-[var(--color-danger-700)]",
  info:    "text-[var(--color-primary-700)]",
};

const variantIcon: Record<ToastVariant, Icon | null> = {
  default: null,
  success: CheckCircle,
  warning: Warning,
  danger:  XCircle,
  info:    Info,
};

const variantIconClass: Record<ToastVariant, string> = {
  default: "text-[var(--text-muted)]",
  success: "text-[var(--color-success-600)]",
  warning: "text-[var(--color-warning-600)]",
  danger:  "text-[var(--color-danger-600)]",
  info:    "text-[var(--color-primary-600)]",
};

const variantBarClass: Record<ToastVariant, string> = {
  default: "bg-[var(--accent)]",
  success: "bg-[var(--color-success-500)]",
  warning: "bg-[var(--color-warning-500)]",
  danger:  "bg-[var(--color-danger-500)]",
  info:    "bg-[var(--color-primary-500)]",
};

/**
 * ToastProvider — wraps the app and provides the `useToast()` hook.
 * Renders toasts in a fixed portal: above the bottom nav on mobile,
 * bottom-right on desktop. Stack is capped at {@link MAX_VISIBLE_TOASTS}.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<InternalToast[]>([]);

  /** Removes the toast from the DOM for real (after the exit animation). */
  const remove = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** Public dismiss — flags the toast as leaving so it animates out first. */
  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id && !t.leaving ? { ...t, leaving: true } : t))
    );
  }, []);

  const toast = React.useCallback(
    (data: Omit<ToastData, "id">): string => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => {
        const next: InternalToast[] = [...prev, { ...data, id, leaving: false }];
        // Cap the visible stack — animate out the oldest still-visible toasts.
        const visible = next.filter((t) => !t.leaving);
        if (visible.length > MAX_VISIBLE_TOASTS) {
          const evicted = new Set(
            visible.slice(0, visible.length - MAX_VISIBLE_TOASTS).map((t) => t.id)
          );
          return next.map((t) => (evicted.has(t.id) ? { ...t, leaving: true } : t));
        }
        return next;
      });
      return id;
    },
    []
  );

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <div
        aria-live="polite"
        aria-label="Notifications"
        style={{ zIndex: "var(--z-toast)" } as React.CSSProperties}
        // Mobile : au-dessus de la bottom nav (+ safe area), pleine largeur.
        // Desktop : coin bas-droit classique.
        className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-4 right-4 flex flex-col gap-2 md:bottom-4 md:left-auto md:right-4"
      >
        {toasts.map((t) => (
          <SingleToast key={t.id} data={t} onDismiss={dismiss} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

interface SingleToastProps {
  data: InternalToast;
  /** Starts the exit animation. */
  onDismiss: (id: string) => void;
  /** Removes the toast from the DOM (called once the exit animation ends). */
  onRemove: (id: string) => void;
}

function SingleToast({ data, onDismiss, onRemove }: SingleToastProps) {
  const variant = data.variant ?? "default";
  const duration = data.duration ?? 4000;
  const IconComponent = variantIcon[variant];

  // ── Auto-dismiss timer, pausable on hover (re-armed with remaining time) ──
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = React.useRef(duration);
  const startedAtRef = React.useRef(0);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (duration <= 0 || data.leaving) return;
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => onDismiss(data.id), remainingRef.current);
    return clearTimer;
  }, [duration, data.leaving, data.id, onDismiss, clearTimer]);

  const handleMouseEnter = () => {
    if (duration <= 0 || data.leaving) return;
    clearTimer();
    remainingRef.current = Math.max(
      0,
      remainingRef.current - (Date.now() - startedAtRef.current)
    );
  };

  const handleMouseLeave = () => {
    if (duration <= 0 || data.leaving || timerRef.current !== null) return;
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => onDismiss(data.id), remainingRef.current);
  };

  // ── Exit: real DOM removal on animationend, fallback for reduced motion ──
  React.useEffect(() => {
    if (!data.leaving) return;
    const fallback = setTimeout(() => onRemove(data.id), EXIT_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [data.leaving, data.id, onRemove]);

  const handleAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (data.leaving && e.animationName === "sn-toast-out") {
      onRemove(data.id);
    }
  };

  return (
    <div
      role="alert"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onAnimationEnd={handleAnimationEnd}
      // sn-toast-in / sn-toast-out: keyframes dans tokens.css, gated
      // prefers-reduced-motion. `sn-toast` sert de hook :hover pour la barre.
      className={cn(
        "sn-toast relative w-full overflow-hidden rounded-[var(--radius-lg)] border p-4 [box-shadow:var(--shadow-lg)] transition-all md:w-80",
        data.leaving ? "sn-toast-out pointer-events-none" : "sn-toast-in pointer-events-auto",
        variantClass[variant]
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {IconComponent && (
          <IconComponent
            size={20}
            weight="duotone"
            aria-hidden="true"
            className={cn("mt-px shrink-0", variantIconClass[variant])}
          />
        )}
        <div className="flex-1">
          <p className={cn("text-sm font-semibold", variantTitleClass[variant])}>
            {data.title}
          </p>
          {data.description && (
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {data.description}
            </p>
          )}
          {data.action && (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 mt-1 text-[var(--accent)] hover:text-[var(--accent-hover)]"
              onClick={() => {
                data.action?.onClick();
                onDismiss(data.id);
              }}
            >
              {data.action.label}
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Dismiss"
          className="-mr-1 -mt-1 h-6 w-6 text-[var(--text-muted)]"
          onClick={() => onDismiss(data.id)}
        >
          <X size={14} aria-hidden="true" />
        </Button>
      </div>
      {duration > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            "sn-toast-progress absolute bottom-0 left-0 h-0.5 w-full",
            variantBarClass[variant]
          )}
          style={{ animationDuration: `${duration}ms` }}
        />
      )}
    </div>
  );
}

/**
 * useToast — returns `toast()` and `dismiss()` from any descendant of ToastProvider.
 */
export function useToast(): Omit<ToastContextValue, "toasts"> {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return { toast: ctx.toast, dismiss: ctx.dismiss };
}
