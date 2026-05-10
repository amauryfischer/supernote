"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check } from "@phosphor-icons/react";
import { AppShell, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getIcon } from "@/components/schemas/icon-map";
import { trpc } from "@/lib/trpc/client";

const ICON_OPTIONS = [
  "User", "Building2", "Layers", "MessageCircle", "FileText",
  "Calendar", "Tag", "Wallet", "TrendingUp", "CreditCard",
  "BarChart2", "Target", "Star", "Hash", "Palette",
];

const COLOR_OPTIONS = [
  "#6366F1", "#0EA5E9", "#8B5CF6", "#10B981", "#F59E0B",
  "#EC4899", "#EF4444", "#F97316", "#06B6D4", "#64748B",
];

type WorkflowMode = "none" | "kanban" | "linear";

interface FormState {
  name: string;
  plural: string;
  icon: string;
  color: string;
  description: string;
  workflow: WorkflowMode;
}

export default function NouveauSchemaPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  useMobileTitle(isMobile ? "Nouveau type" : null);
  const [form, setForm] = useState<FormState>({
    name: "",
    plural: "",
    icon: "Box",
    color: "#6366F1",
    description: "",
    workflow: "none",
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = trpc.schemas.create.useMutation({
    onSuccess: (created) => {
      router.push(`/schemas/${created.id}`);
    },
    onError: (err) => {
      // Fallback: still navigate to schemas list even if backend fails
      setCreateError(err.message);
    },
  });

  const Icon = getIcon(form.icon);
  const slug = form.name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  const handleCreate = () => {
    setCreateError(null);
    if (!form.name || !form.plural) return;
    createMutation.mutate({
      name: form.name,
      plural: form.plural,
      icon: form.icon,
      color: form.color,
    });
  };

  const patch = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-3 py-6 md:px-6 md:py-10">
        {/* Back */}
        <button
          onClick={() => router.push("/schemas")}
          className="flex w-fit items-center gap-1.5 text-sm transition-colors hover:opacity-70"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={14} />
          Retour aux schémas
        </button>

        {/* Title */}
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            Nouveau type d&apos;entité
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Définissez un nouveau type de donnée structurée. Vous pourrez ajouter des champs ensuite.
          </p>
        </div>

        {/* Icon + Color preview */}
        <div
          className="flex items-center gap-5 rounded-xl border p-5"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
        >
          <div
            className="flex h-16 w-16 items-center justify-center rounded-xl text-white"
            style={{ backgroundColor: form.color }}
          >
            <Icon size={28} />
          </div>
          <div>
            <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              {form.name || "Nom du type"}
            </p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {form.plural || "Pluriel"} · slug : <span className="font-mono">{slug || "…"}</span>
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-5">
          {/* Name + Plural */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Nom singulier *">
              <input
                value={form.name}
                onChange={(e) => patch("name", e.target.value)}
                placeholder="Exemple : Livre"
                style={inputStyle}
              />
            </FormField>
            <FormField label="Nom pluriel *">
              <input
                value={form.plural}
                onChange={(e) => patch("plural", e.target.value)}
                placeholder="Exemple : Livres"
                style={inputStyle}
              />
            </FormField>
          </div>

          {/* Description */}
          <FormField label="Description">
            <textarea
              value={form.description}
              onChange={(e) => patch("description", e.target.value)}
              placeholder="À quoi sert ce type d'entité ?"
              rows={2}
              style={{ ...inputStyle, resize: "none" }}
              className="w-full"
            />
          </FormField>

          {/* Icon picker */}
          <FormField label="Icône">
            <div className="flex flex-wrap gap-2">
              {ICON_OPTIONS.map((name) => {
                const Ic = getIcon(name);
                const selected = form.icon === name;
                return (
                  <button
                    key={name}
                    onClick={() => patch("icon", name)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors"
                    style={
                      selected
                        ? { backgroundColor: form.color, color: "#fff", borderColor: form.color }
                        : { borderColor: "var(--border)", color: "var(--text-secondary)" }
                    }
                    title={name}
                  >
                    <Ic size={16} />
                  </button>
                );
              })}
            </div>
          </FormField>

          {/* Color picker */}
          <FormField label="Couleur">
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  onClick={() => patch("color", color)}
                  className="relative h-8 w-8 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: color,
                    borderColor: form.color === color ? "var(--text-primary)" : "transparent",
                  }}
                >
                  {form.color === color && (
                    <Check size={12} className="absolute inset-0 m-auto text-white" />
                  )}
                </button>
              ))}
            </div>
          </FormField>

          {/* Workflow */}
          <FormField label="Workflow">
            <div className="flex gap-3">
              {([
                { value: "none", label: "Aucun", desc: "Pas d'état prédéfini" },
                { value: "kanban", label: "Kanban", desc: "Colonnes d'états" },
                { value: "linear", label: "Linéaire", desc: "Pipeline séquentiel" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => patch("workflow", opt.value)}
                  className="flex flex-1 flex-col rounded-xl border px-4 py-3 text-left transition-colors"
                  style={
                    form.workflow === opt.value
                      ? { borderColor: "var(--accent)", backgroundColor: "var(--accent-subtle)" }
                      : { borderColor: "var(--border)" }
                  }
                >
                  <span
                    className="text-sm font-semibold"
                    style={{ color: form.workflow === opt.value ? "var(--accent)" : "var(--text-primary)" }}
                  >
                    {opt.label}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{opt.desc}</span>
                </button>
              ))}
            </div>
          </FormField>
        </div>

        {/* Error */}
        {createError && (
          <p className="text-sm text-red-500">{createError}</p>
        )}

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={() => router.push("/schemas")}
            className="rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Annuler
          </button>
          <button
            onClick={handleCreate}
            disabled={!form.name || !form.plural || createMutation.isPending}
            className="rounded-lg px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            {createMutation.isPending ? "Création…" : "Créer le type"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}

const inputStyle: React.CSSProperties = {
  borderColor: "var(--border)",
  backgroundColor: "var(--surface-1)",
  color: "var(--text-primary)",
  width: "100%",
  borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border)",
  padding: "8px 12px",
  fontSize: "0.875rem",
  outline: "none",
};

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}
