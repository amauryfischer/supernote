import * as React from "react";
import { Modal } from "@supernote/ui";
import { Button } from "@heroui/react";
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from "./useConfirm";

interface PendingConfirm {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);

  const confirm = React.useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setPending({ opts, resolve });
    });
  }, []);

  const close = React.useCallback(
    (result: boolean) => {
      if (!pending) return;
      pending.resolve(result);
      setPending(null);
    },
    [pending],
  );

  const opts = pending?.opts;
  const variant = opts?.variant ?? "default";
  const confirmLabel = opts?.confirmLabel ?? "Confirmer";
  const cancelLabel = opts?.cancelLabel ?? "Annuler";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        isOpen={pending !== null}
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
        title={opts?.title ?? ""}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onPress={() => close(false)}>
              {cancelLabel}
            </Button>
            <Button
              variant={variant === "danger" ? "danger" : "primary"}
              onPress={() => close(true)}
            >
              {confirmLabel}
            </Button>
          </div>
        }
      >
        <div className="text-sm text-[var(--text-secondary)]">{opts?.body}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}
