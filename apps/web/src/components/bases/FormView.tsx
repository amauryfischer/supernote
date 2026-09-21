"use client";

/**
 * FormView — formulaire de saisie d'une entité de la Base.
 *
 * Phase MVP : version interne (intra-vault). Soumet → crée une entité.
 * Phase suivante (Pack C cont.) : publication via slug public côté API Hono.
 */

import { useMemo, useState } from "react";
import { Button, Input, TextArea } from "@heroui/react";
import type { EntityType, Field } from "@supernote/core";
import type { View } from "@supernote/ipc";
import {
  useEntitiesForView,
  useEntityMutations,
  useViewMutations,
  resolveVisibleFieldIds,
  checkFieldConstraints,
  isBlankValue,
} from "./hooks";
import { Cell, READONLY_KINDS } from "./Cell";
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
  // Les champs calculés (formule, date de création…) ne se saisissent pas.
  const inputFields = useMemo(
    () => fieldsToShow.filter((f) => !READONLY_KINDS.has(f.kind)),
    [fieldsToShow],
  );
  const requiredIds = useMemo(
    () =>
      inputFields
        .filter((f) => cfg.fields?.find((fc) => fc.fieldId === f.id)?.required ?? f.required)
        .map((f) => f.id),
    [inputFields, cfg.fields],
  );

  const mut = useEntityMutations(base.id);
  const { update: updateView } = useViewMutations();
  const { toast } = useToast();
  // Lignes existantes chargées seulement si un champ unique doit être vérifié.
  const hasUnique = inputFields.some((f) => f.unique);
  const { data: existing } = useEntitiesForView(hasUnique ? base.id : undefined, [], []);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const setValue = (fieldId: string, next: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: next }));
    setErrors((prev) => {
      if (!(fieldId in prev)) return prev;
      const rest = { ...prev };
      delete rest[fieldId];
      return rest;
    });
  };

  const submit = () => {
    const fieldsPayload: Record<string, unknown> = {};
    for (const f of inputFields) {
      const v = values[f.id];
      if (!isBlankValue(v)) fieldsPayload[f.id] = v;
    }
    const found = checkFieldConstraints(inputFields, fieldsPayload, existing?.items ?? [], {
      mustFill: requiredIds,
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    mut.create.mutate(
      { typeId: base.id, fields: fieldsPayload as never, body: "" },
      {
        onSuccess: () => {
          setValues({});
          setErrors({});
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
    <div className="mx-auto max-w-2xl p-4 md:p-6">
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
        {inputFields.map((f) => {
          const configured = cfg.fields?.find((fc) => fc.fieldId === f.id);
          const label = configured?.label ?? f.label ?? f.name;
          const helpText = configured?.helpText ?? f.helpText;
          const error = errors[f.id];
          return (
            <div key={f.id} className="flex flex-col gap-1">
              <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                {label}
                {requiredIds.includes(f.id) && (
                  <span style={{ color: "#EF4444" }} aria-hidden>
                    {" "}
                    *
                  </span>
                )}
              </span>
              {helpText && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {helpText}
                </span>
              )}
              {/* Même éditeur typé que la grille et la fiche : options du
                  select, sélecteur de relation, date, nombre, case à cocher. */}
              <div
                className="flex min-h-9 rounded-md border"
                style={{
                  borderColor: error ? "#EF4444" : "var(--border-subtle)",
                  backgroundColor: "var(--surface-1)",
                }}
              >
                <Cell
                  field={f}
                  value={values[f.id]}
                  onChange={(next) => setValue(f.id, next)}
                  rowFields={values}
                  baseFields={base.fields}
                />
              </div>
              {error && (
                <span role="alert" className="text-xs" style={{ color: "#EF4444" }}>
                  {error}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-2">
        <Button variant="primary" onPress={submit} isDisabled={inputFields.length === 0}>
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
