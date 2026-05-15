type ToastFn = (data: {
  title: string;
  description?: string;
  variant?: "default" | "success" | "warning" | "danger" | "info";
}) => string;

type Label<T = unknown> = string | ((arg: T) => string);

export interface MutationFeedbackOptions<TData = unknown> {
  /** Libellé du toast de succès. Si absent, pas de toast succès. */
  success?: Label<TData>;
  /** Libellé du toast d'erreur. Si absent, pas de toast erreur. */
  error?: Label<unknown>;
}

export interface PassthroughCallbacks<TData = unknown> {
  onSuccess?: (data: TData, variables: unknown, context: unknown) => void;
  onError?: (error: unknown, variables: unknown, context: unknown) => void;
}

function resolve<T>(label: Label<T> | undefined, arg: T): string | null {
  if (label === undefined) return null;
  return typeof label === "function" ? label(arg) : label;
}

/**
 * Wrap les callbacks d'options tRPC `useMutation` pour ajouter des toasts
 * standard. Préserve les callbacks utilisateur passés via `passthrough`.
 */
export function withMutationFeedback<TData = unknown>(
  toast: ToastFn,
  feedback: MutationFeedbackOptions<TData>,
  passthrough: PassthroughCallbacks<TData> = {},
): Required<PassthroughCallbacks<TData>> {
  return {
    onSuccess: (data, variables, context) => {
      const title = resolve(feedback.success, data);
      if (title !== null) {
        toast({ title, variant: "success" });
      }
      passthrough.onSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => {
      const title = resolve(feedback.error, error);
      if (title !== null) {
        toast({ title, variant: "danger" });
      }
      passthrough.onError?.(error, variables, context);
    },
  };
}
