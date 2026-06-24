"use client";

import { useMemo, useState } from "react";
import { Modal, Button, useToast } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import { isCodaBase } from "@/lib/coda/bindings";
import {
  EMAIL_FIELD_SOURCE_LABELS,
  emailSourceValue,
  autoMapBaseFields,
  type EmailFieldSource,
} from "@/lib/mail-capture";
import { NativeSelect } from "@/components/settings/NativeSelect";
import { useCaptureEmail } from "./useCaptureEmail";
import type { EmailMessage } from "@/lib/gmail";
import type { FieldValue } from "@supernote/ipc";

const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "— (ignorer)" },
  ...(Object.keys(EMAIL_FIELD_SOURCE_LABELS) as EmailFieldSource[]).map((s) => ({
    value: s,
    label: EMAIL_FIELD_SOURCE_LABELS[s],
  })),
];

export function CaptureEmailModal({
  isOpen,
  message,
  onClose,
}: {
  isOpen: boolean;
  message: EmailMessage | null;
  onClose: () => void;
}) {
  const { data: bases } = trpc.schemas.list.useQuery(
    { search: undefined },
    { enabled: isOpen },
  );
  const { captureToBase } = useCaptureEmail();
  const { toast } = useToast();
  const [typeId, setTypeId] = useState<string>("");
  const [mapping, setMapping] = useState<Record<string, EmailFieldSource | "">>({});
  const [busy, setBusy] = useState(false);

  const targets = useMemo(
    () =>
      (bases ?? []).filter(
        (b) => b.id !== "note" && !b.isSystem && !isCodaBase(b.id),
      ),
    [bases],
  );
  const selected = targets.find((b) => b.id === typeId) ?? null;

  const chooseBase = (id: string) => {
    setTypeId(id);
    const b = targets.find((t) => t.id === id);
    setMapping(
      b
        ? autoMapBaseFields(
            b.fields.map((f) => ({
              name: f.name,
              label: f.label ?? f.name,
              type: String(f.type),
            })),
          )
        : {},
    );
  };

  const submit = async () => {
    if (!selected || !message) return;
    setBusy(true);
    try {
      const fields: Record<string, FieldValue> = {};
      for (const f of selected.fields) {
        const src = mapping[f.name];
        if (src) fields[f.name] = emailSourceValue(message, src);
      }
      await captureToBase(selected.id, fields);
      toast({ title: `Ligne créée dans « ${selected.name} »` });
      onClose();
    } catch (err) {
      toast({
        title: "Échec de la capture",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Capturer dans une base"
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {/* Base selection */}
        <div className="flex flex-col gap-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Base cible
          </span>
          <div className="flex flex-wrap gap-2">
            {targets.length === 0 && (
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                Aucune base disponible.
              </span>
            )}
            {targets.map((b) => (
              <Button
                key={b.id}
                variant={b.id === typeId ? "primary" : "ghost"}
                size="sm"
                onPress={() => chooseBase(b.id)}
              >
                {b.name}
              </Button>
            ))}
          </div>
        </div>

        {/* Field mapping */}
        {selected && (
          <div className="flex flex-col gap-2">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Mapping des champs
            </span>
            {selected.fields.map((f) => (
              <div key={f.name} className="flex items-center justify-between gap-3">
                <span className="text-sm">{f.label ?? f.name}</span>
                <NativeSelect
                  value={mapping[f.name] ?? ""}
                  onChange={(v) =>
                    setMapping((m) => ({
                      ...m,
                      [f.name]: v as EmailFieldSource | "",
                    }))
                  }
                  options={SOURCE_OPTIONS}
                />
              </div>
            ))}
            <Button
              variant="primary"
              isDisabled={busy}
              onPress={() => void submit()}
              className="mt-2 self-end"
            >
              {busy ? "Création…" : "Créer la ligne"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
