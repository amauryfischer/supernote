"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check } from "@phosphor-icons/react";
import { Button, Input, TextArea } from "@heroui/react";
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
        <Button
          onPress={() => router.push("/schemas")}
          variant="ghost"
          size="sm"
          className="w-fit text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={14} />
          Retour aux schémas
        </Button>

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
              <Input
                value={form.name}
                onChange={(e) => patch("name", e.target.value)}
                placeholder="Exemple : Livre"
                variant="primary"
              />
            </FormField>
            <FormField label="Nom pluriel *">
              <Input
                value={form.plural}
                onChange={(e) => patch("plural", e.target.value)}
                placeholder="Exemple : Livres"
                variant="primary"
              />
            </FormField>
          </div>

          {/* Description */}
          <FormField label="Description">
            <TextArea
              value={form.description}
              onChange={(e) => patch("description", e.target.value)}
              placeholder="À quoi sert ce type d'entité ?"
              rows={2}
              variant="primary"
              className="w-full resize-none"
            />
          </FormField>

          {/* Icon picker */}
          <FormField label="Icône">
            <div className="flex flex-wrap gap-2">
              {ICON_OPTIONS.map((name) => {
                const Ic = getIcon(name);
                const selected = form.icon === name;
                const iconStyle: React.CSSProperties = selected
                  ? { backgroundColor: form.color, color: "#fff", borderColor: form.color }
                  : { borderColor: "var(--border)", color: "var(--text-secondary)" };
                return (
                  <Button
                    key={name}
                    onPress={() => patch("icon", name)}
                    isIconOnly
                    variant="outline"
                    size="sm"
                    className="h-9 w-9"
                    style={iconStyle}
                    aria-label={name}
                  >
                    <Ic size={16} />
                  </Button>
                );
              })}
            </div>
          </FormField>

          {/* Color picker */}
          <FormField label="Couleur">
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((color) => (
                <Button
                  key={color}
                  onPress={() => patch("color", color)}
                  isIconOnly
                  size="sm"
                  aria-label={`Couleur ${color}`}
                  className="relative h-8 w-8 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: color,
                    borderColor: form.color === color ? "var(--text-primary)" : "transparent",
                  }}
                >
                  {form.color === color && (
                    <Check size={12} className="absolute inset-0 m-auto text-white" />
                  )}
                </Button>
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
                <Button
                  key={opt.value}
                  onPress={() => patch("workflow", opt.value)}
                  variant="outline"
                  className="flex h-auto flex-1 flex-col items-start rounded-xl px-4 py-3"
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
                </Button>
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
          <Button
            onPress={() => router.push("/schemas")}
            variant="outline"
            size="md"
            className="text-sm font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Annuler
          </Button>
          <Button
            onPress={handleCreate}
            isDisabled={!form.name || !form.plural || createMutation.isPending}
            isPending={createMutation.isPending}
            size="md"
            className="text-sm font-medium"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            Créer le type
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

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
