import * as React from "react";
import { cn } from "../../cn.js";

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

interface ToastContextValue {
  toasts: ToastData[];
  toast: (data: Omit<ToastData, "id">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

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

/**
 * ToastProvider — wraps the app and provides the `useToast()` hook.
 * Renders toasts in a fixed portal at the bottom-right of the viewport.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastData[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (data: Omit<ToastData, "id">): string => {
      const id = Math.random().toString(36).slice(2);
      const duration = data.duration ?? 4000;
      setToasts((prev) => [...prev, { ...data, id }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <div
        aria-live="polite"
        aria-label="Notifications"
        style={{ zIndex: "var(--z-toast)" } as React.CSSProperties}
        className="pointer-events-none fixed bottom-4 right-4 flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <SingleToast key={t.id} data={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

interface SingleToastProps {
  data: ToastData;
  onDismiss: (id: string) => void;
}

function SingleToast({ data, onDismiss }: SingleToastProps) {
  const variant = data.variant ?? "default";
  return (
    <div
      role="alert"
      // sn-toast-in: slide-up avec léger rebond (keyframes dans tokens.css,
      // gated prefers-reduced-motion).
      className={cn(
        "sn-toast-in pointer-events-auto w-80 rounded-[var(--radius-lg)] border p-4 [box-shadow:var(--shadow-lg)] transition-all",
        variantClass[variant]
      )}
    >
      <div className="flex items-start justify-between gap-3">
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
            <button
              className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline"
              onClick={() => {
                data.action?.onClick();
                onDismiss(data.id);
              }}
            >
              {data.action.label}
            </button>
          )}
        </div>
        <button
          aria-label="Dismiss"
          onClick={() => onDismiss(data.id)}
          className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
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
