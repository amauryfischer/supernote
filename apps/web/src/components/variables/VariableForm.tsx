"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select, ListBox, ListBoxItem, Spinner } from "@heroui/react";
import type { Key } from "@heroui/react";
import type { Variable, VariableInput, VariableValue, VariableType } from "@supernote/ipc";
import { FormulaInputEditor } from "@/components/bases/FormulaInputEditor";
import { trpc } from "@/lib/trpc/client";

interface EvaluatedPreview {
  value: string | null;
  error: string | null;
}

interface VariableFormProps {
  initial?: Variable;
  submitLabel: string;
  onSubmit: (input: VariableInput) => Promise<void>;
  evaluatedPreview?: EvaluatedPreview | null;
}

const TYPE_LABELS: Record<VariableType, string> = {
  number: "Nombre",
  string: "Texte",
  boolean: "Booléen",
  date: "Date",
};

function buildValue(
  valueKind: "literal" | "formula",
  type: VariableType,
  literalValue: string,
  boolValue: boolean,
  expression: string,
): VariableValue {
  if (valueKind === "formula") return { kind: "formula", expression: expression.trim() };
  if (type === "boolean") return { kind: "literal", value: boolValue };
  if (type === "number") return { kind: "literal", value: Number(literalValue) };
  return { kind: "literal", value: literalValue };
}

function initFromVariable(v: Variable) {
  const vk: "literal" | "formula" = v.value.kind === "formula" ? "formula" : "literal";
  const expr = v.value.kind === "formula" ? v.value.expression : "";
  const bool =
    v.value.kind === "literal" && v.type === "boolean"
      ? (v.value.value as boolean)
      : false;
  const lit =
    v.value.kind === "literal" && v.type !== "boolean" ? String(v.value.value) : "";
  return { vk, expr, bool, lit } as const;
}

const ACTIVE_STYLE = { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" };
const INACTIVE_STYLE = { borderColor: "var(--border)", color: "var(--text-secondary)" };

export function VariableForm({
  initial,
  submitLabel,
  onSubmit,
  evaluatedPreview,
}: VariableFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<VariableType>(initial?.type ?? "string");
  const [valueKind, setValueKind] = useState<"literal" | "formula">(() => {
    if (!initial) return "literal";
    return initFromVariable(initial).vk;
  });
  const [literalValue, setLiteralValue] = useState(() => {
    if (!initial) return "";
    return initFromVariable(initial).lit;
  });
  const [boolValue, setBoolValue] = useState(() => {
    if (!initial) return false;
    return initFromVariable(initial).bool;
  });
  const [expression, setExpression] = useState(() => {
    if (!initial) return "";
    return initFromVariable(initial).expr;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Liste des autres variables pour autocomplétion $nom (on exclut la variable courante).
  const { data: allVars } = trpc.variables.list.useQuery();
  const variableNames = useMemo(
    () =>
      (allVars ?? [])
        .filter((v) => v.id !== initial?.id)
        .map((v) => v.name),
    [allVars, initial?.id],
  );

  useEffect(() => {
    if (!initial) return;
    const { vk, expr, bool, lit } = initFromVariable(initial);
    setName(initial.name);
    setType(initial.type);
    setValueKind(vk);
    setLiteralValue(lit);
    setBoolValue(bool);
    setExpression(expr);
  }, [initial]);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        type,
        value: buildValue(valueKind, type, literalValue, boolValue, expression),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const isEdit = !!initial;
  const pageTitle = isEdit ? `Variable $${name || initial!.name}` : "Nouvelle variable";

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
        {pageTitle}
      </h1>

      {/* Section Définition */}
      <div
        className="rounded-lg border p-4 space-y-4"
        style={{ borderColor: "var(--border)" }}
      >
        {/* Nom */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Nom
          </label>
          <div className="flex items-center gap-2">
            <span className="font-mono" style={{ color: "var(--text-muted)" }}>$</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-1)",
                color: "var(--text-primary)",
              }}
              placeholder="ma_variable"
              required
            />
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Lettres, chiffres et underscore. Référencée en formule via $nom.
          </p>
        </div>

        {/* Type */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Type
          </label>
          <Select
            selectedKey={type}
            onSelectionChange={(k: Key | null) => {
              const key = k == null ? null : String(k);
              if (key && (key in TYPE_LABELS)) setType(key as VariableType);
            }}
            aria-label="Type de la variable"
          >
            <Select.Trigger
              className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-1)",
                color: "var(--text-primary)",
              }}
            >
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {(Object.keys(TYPE_LABELS) as VariableType[]).map((t) => (
                  <ListBoxItem key={t} id={t}>{TYPE_LABELS[t]}</ListBoxItem>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        {/* Source */}
        <div>
          <label className="mb-2 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Source de la valeur
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onPress={() => setValueKind("literal")}
              className="rounded-md border px-3 py-1 text-xs font-medium transition-colors"
              style={valueKind === "literal" ? ACTIVE_STYLE : INACTIVE_STYLE}
            >
              Littérale
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onPress={() => setValueKind("formula")}
              className="rounded-md border px-3 py-1 text-xs font-medium transition-colors"
              style={valueKind === "formula" ? ACTIVE_STYLE : INACTIVE_STYLE}
            >
              Formule
            </Button>
          </div>
        </div>
      </div>

      {/* Boolean literal */}
      {valueKind === "literal" && type === "boolean" && (
        <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
          <label className="mb-2 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Valeur
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onPress={() => setBoolValue(!boolValue)}
            className="rounded-md border px-3 py-1 text-xs font-medium transition-colors"
            style={boolValue ? ACTIVE_STYLE : INACTIVE_STYLE}
          >
            {boolValue ? "true" : "false"}
          </Button>
        </div>
      )}

      {/* Non-boolean literal */}
      {valueKind === "literal" && type !== "boolean" && (
        <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
          <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Valeur
          </label>
          <Input
            type={type === "number" ? "number" : type === "date" ? "datetime-local" : "text"}
            value={literalValue}
            onChange={(e) => setLiteralValue(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-1)",
              color: "var(--text-primary)",
            }}
          />
        </div>
      )}

      {/* Formula */}
      {valueKind === "formula" && (
        <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
          <label className="mb-2 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Expression
          </label>
          <FormulaInputEditor
            inline
            variables={variableNames}
            initialExpression={expression}
            onChange={setExpression}
            placeholder="if($autre > 0, $autre * 1.2, 0)"
          />
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Coda-flavored. Référencez d&apos;autres variables avec $autre, les bases via Contact.where(…), etc.
          </p>
        </div>
      )}

      {/* Aperçu */}
      {evaluatedPreview != null && (
        <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
          <p className="mb-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Aperçu
          </p>
          {evaluatedPreview.error ? (
            <p className="text-sm" style={{ color: "var(--danger, #ef4444)" }}>
              {evaluatedPreview.error}
            </p>
          ) : (
            <code className="font-mono text-sm" style={{ color: "var(--text-primary)" }}>
              {evaluatedPreview.value ?? "null"}
            </code>
          )}
        </div>
      )}

      {/* Submit error */}
      {error !== null && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          type="submit"
          isDisabled={submitting}
          onPress={() => { void handleSubmit(); }}
          variant="ghost"
          size="sm"
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-90"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          {submitting ? <Spinner size="sm" /> : submitLabel}
        </Button>
      </div>
    </form>
  );
}
