import * as React from "react";
import { cn } from "../../cn.js";

const inputBaseClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)] disabled:cursor-not-allowed disabled:opacity-50";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Left decorative slot (icon or text). */
  startContent?: React.ReactNode;
  /** Right decorative slot (icon or text). */
  endContent?: React.ReactNode;
  /** Controlled error message shown below the input. */
  errorMessage?: string;
  /** Visual error state. */
  isInvalid?: boolean;
}

/**
 * Input — single-line text field.
 * All colors come from CSS tokens.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { className, startContent, endContent, errorMessage, isInvalid, ...props },
    ref
  ) => (
    <div className="flex flex-col gap-1">
      <div className="relative flex items-center">
        {startContent && (
          <span className="pointer-events-none absolute left-3 text-[var(--text-muted)]">
            {startContent}
          </span>
        )}
        <input
          ref={ref}
          aria-invalid={isInvalid}
          className={cn(
            inputBaseClass,
            startContent && "pl-9",
            endContent && "pr-9",
            isInvalid && "border-[var(--color-danger)] focus:ring-[var(--color-danger-100)]",
            className
          )}
          {...props}
        />
        {endContent && (
          <span className="pointer-events-none absolute right-3 text-[var(--text-muted)]">
            {endContent}
          </span>
        )}
      </div>
      {errorMessage && (
        <p className="text-xs text-[var(--color-danger)]">{errorMessage}</p>
      )}
    </div>
  )
);
Input.displayName = "Input";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Controlled error message shown below the textarea. */
  errorMessage?: string;
  /** Visual error state. */
  isInvalid?: boolean;
}

/**
 * Textarea — multi-line text field.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, errorMessage, isInvalid, ...props }, ref) => (
    <div className="flex flex-col gap-1">
      <textarea
        ref={ref}
        aria-invalid={isInvalid}
        className={cn(
          inputBaseClass,
          "min-h-[80px] resize-y py-2",
          isInvalid && "border-[var(--color-danger)] focus:ring-[var(--color-danger-100)]",
          className
        )}
        {...props}
      />
      {errorMessage && (
        <p className="text-xs text-[var(--color-danger)]">{errorMessage}</p>
      )}
    </div>
  )
);
Textarea.displayName = "Textarea";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Appends a required asterisk. */
  required?: boolean;
}

/**
 * Label — accessible form label with optional required indicator.
 */
export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none text-[var(--text-primary)] peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    >
      {children}
      {required && (
        <span className="ml-1 text-[var(--color-danger)]" aria-hidden="true">
          *
        </span>
      )}
    </label>
  )
);
Label.displayName = "Label";
