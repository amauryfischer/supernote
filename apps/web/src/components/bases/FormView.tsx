"use client";

/**
 * FormView — formulaire de saisie d'une entité de la Base.
 *
 * Phase MVP : version interne (intra-vault). Soumet → crée une entité.
 * Phase suivante (Pack C cont.) : publication via slug public côté API Hono.
 */

import { useMemo, useState, type ChangeEvent } from "react";
import { Button, Input, TextArea } from "@heroui/react";
import type { EntityType, Field } from "@supernote/core";
import type { View } from "@supernote/ipc";
import { useEntityMutations, useViewMutations, resolveVisibleFieldIds } from "./hooks";
import { useToast } from "@supernote/ui";

interface FormViewProps {
  base: EntityType;
  view: View;
}

export function FormView({ base, view }: FormViewProps) {
  const cfg = view.formConfig ?? {
    title: undefined,
    description: undefined,
    fields: [],
    successMessage: undefined,
    isPublic: false,
    publicSlug: undefined,
  };

  const allIds = useMemo(() => base.fields.map((f) => f.id), [base.fields]);
  const visibleIds = useMemo(
    () => resolveVisibleFieldIds(view, allIds),
    [view, allIds],
  );

  const fieldsToShow = useMemo<Field[]>(() => {
    const map = new Map<string, Field>();
    for (const f of base.fields) map.set(f.id, f);
    const configured = cfg.fields ?? [];
    if (configured.length > 0) {
      return configured
        .filter((fc) => fc.visible !== false)
        .map((fc) => map.get(fc.fieldId))
        .filter((f): f is Field => Boolean(f));
    }
    return visibleIds
      .map((id) => map.get(id))
      .filter((f): f is Field => Boolean(f));
  }, [base.fields, cfg.fields, visibleIds]);

  const mut = useEntityMutations(base.id);
  const { update: updateView } = useViewMutations();
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const submit = () => {
    const fieldsPayload: Record<string, unknown> = {};
    for (const f of fieldsToShow) {
      const v = values[f.id];
      if (v !== undefined && v !== "") fieldsPayload[f.id] = coerceValue(v, f);
    }
    mut.create.mutate(
      { typeId: base.id, fields: fieldsPayload as never, body: "" },
      {
        onSuccess: () => {
          setValues({});
          setSubmitted(true);
          toast({
            title: "Soumission enregistrée",
            description: cfg.successMessage ?? "Merci, l'entrée a été créée.",
          });
        },
        onError: (e) =>
          toast({ title: "Échec de la soumission", description: e.message, variant: "danger" }),
      },
    );
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-4">
        <Input
          aria-label="Titre du formulaire"
          placeholder="Titre du formulaire"
          value={cfg.title ?? ""}
          onChange={(e) =>
            updateView.mutate({
              id: view.id,
              formConfig: { ...cfg, title: e.target.value },
            })
          }
          className="text-xl font-semibold"
        />
      </div>
      <TextArea
        aria-label="Description"
        placeholder="Description (optionnelle)…"
        value={cfg.description ?? ""}
        rows={2}
        onChange={(e) =>
          updateView.mutate({
            id: view.id,
            formConfig: { ...cfg, description: e.target.value },
          })
        }
      />

      <div className="mt-6 flex flex-col gap-3">
        {fieldsToShow.map((f) => {
          const configured = cfg.fields?.find((fc) => fc.fieldId === f.id);
          const label = configured?.label ?? f.label ?? f.name;
          const required = configured?.required ?? false;
          const val = values[f.id] ?? "";
          return (
            <label key={f.id} className="flex flex-col gap-1">
              <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                {label}
                {required && (
                  <span style={{ color: "#EF4444" }} aria-hidden>
                    {" "}
                    *
                  </span>
                )}
              </span>
              {configured?.helpText && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {configured.helpText}
                </span>
              )}
              <FieldInput
                field={f}
                value={val}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, [f.id]: v }))
                }
              />
            </label>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-2">
        <Button variant="primary" onPress={submit} isDisabled={fieldsToShow.length === 0}>
          Envoyer
        </Button>
        {submitted && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            ✓ Soumis
          </span>
        )}
      </div>

      <div
        className="mt-8 rounded border p-3 text-xs"
        style={{
          borderColor: "var(--border-subtle)",
          color: "var(--text-muted)",
        }}
      >
        Publication publique du formulaire : pas encore disponible. La soumission interne
        crée une entrée dans cette Base.
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (v: string) => void;
}) {
  const kind = field.kind;
  if (kind === "longtext" || kind === "markdown") {
    return (
      <TextArea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.label || field.name}
      />
    );
  }
  if (kind === "number" || kind === "currency" || kind === "percent" || kind === "rating") {
    return (
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.label || field.name}
      />
    );
  }
  if (kind === "date") {
    return (
      <Input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.label || field.name}
      />
    );
  }
  if (kind === "datetime") {
    return (
      <Input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.label || field.name}
      />
    );
  }
  if (kind === "email") {
    return (
      <Input
        type="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.label || field.name}
      />
    );
  }
  if (kind === "url") {
    return (
      <Input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.label || field.name}
      />
    );
  }
  return (
    <Input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={field.label || field.name}
    />
  );
}

function coerceValue(raw: string, field: Field): unknown {
  if (raw === "" || raw === null || raw === undefined) return null;
  const numericKinds = [
    "number",
    "currency",
    "percent",
    "rating",
    "progress",
    "duration",
  ];
  if (numericKinds.includes(field.kind)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (field.kind === "bool") {
    return raw === "true" || raw === "1" || raw === "on";
  }
  return raw;
}
