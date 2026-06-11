"use client";

import { Button, Card, Chip, Spinner } from "@heroui/react";
import { PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell, useMobileFab, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { trpc } from "@/lib/trpc/client";
import type { Variable } from "@supernote/ipc";
import { DeleteVariableModal } from "@/components/variables/DeleteVariableModal";

// ── Preview cell ──────────────────────────────────────────────────────────────

function VariablePreview({ id }: { id: string }) {
  const { data } = trpc.variables.evaluate.useQuery({ id });
  if (!data) return <span style={{ color: "var(--text-muted)" }}>…</span>;
  if (data.error) return <span className="text-sm" style={{ color: "var(--danger)" }}>{data.error}</span>;
  return <span className="font-mono text-sm">{data.value ?? "null"}</span>;
}

// ── Row ───────────────────────────────────────────────────────────────────────

function VariableRow({
  variable,
  onDelete,
}: {
  variable: Variable;
  onDelete: (id: string) => void;
}) {
  const router = useRouter();
  return (
    <tr
      className="border-b last:border-0"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <td className="px-4 py-3">
        <span className="font-mono text-sm" style={{ color: "var(--text-primary)" }}>
          ${variable.name}
        </span>
      </td>
      <td className="px-4 py-3">
        <Chip size="sm" variant="soft">{variable.type}</Chip>
      </td>
      <td className="px-4 py-3">
        <Chip
          size="sm"
          variant="soft"
          color={variable.value.kind === "formula" ? "accent" : "default"}
        >
          {variable.value.kind}
        </Chip>
      </td>
      <td className="px-4 py-3">
        <VariablePreview id={variable.id} />
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label="Éditer"
            onPress={() => router.push(`/variables/${variable.id}`)}
          >
            <PencilSimple size={16} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="danger-soft"
            aria-label="Supprimer"
            onPress={() => onDelete(variable.id)}
          >
            <Trash size={16} />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VariablesPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.variables.list.useQuery();
  const [toDelete, setToDelete] = useState<string | null>(null);

  function handleDeleted() {
    setToDelete(null);
    void utils.variables.list.invalidate();
  }

  // Parité mobile : la même action « Nouvelle variable » que le lien desktop,
  // exposée en FAB sous 768px (le lien en-tête est masqué par le shell mobile).
  useMobileTitle(isMobile ? "Variables" : null);
  useMobileFab(
    isMobile
      ? {
          icon: Plus,
          label: "Nouvelle variable",
          onPress: () => router.push("/variables/nouveau"),
        }
      : null,
  );

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Variables
        </h1>
        {/* Lien masqué sur mobile — le FAB prend le relais pour la création */}
        <Link
          href="/variables/nouveau"
          className="hidden md:flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={13} />
          Nouvelle variable
        </Link>
      </div>

      {/* Table */}
      <Card>
        <div
          className="overflow-x-auto rounded-xl"
          style={{ backgroundColor: "var(--surface-0)", border: "1px solid var(--border-subtle)" }}
        >
          {(data ?? []).length === 0 ? (
            <div className="px-6 py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Aucune variable. Créez-en une pour la réutiliser dans vos formules.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["Nom", "Type", "Source", "Aperçu", ""].map((col) => (
                    <th
                      key={col}
                      className="px-4 py-2.5 text-left text-xs font-medium"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((v) => (
                  <VariableRow key={v.id} variable={v} onDelete={setToDelete} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <DeleteVariableModal
        isOpen={toDelete !== null}
        variableId={toDelete}
        onClose={() => setToDelete(null)}
        onDeleted={handleDeleted}
      />
      </div>
    </AppShell>
  );
}
