"use client";

/**
 * /bases/:typeId — standalone page for one Base (EntityType).
 *
 * Shell: AppShell layout, breadcrumb back to /schemas, header with the
 * Base name + icon + "+ Nouvelle entrée" affordance. Body: <BaseView/>.
 */

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Database, Plus, Gear, ArrowsClockwise, CloudCheck } from "@phosphor-icons/react";
import { Button } from "@heroui/react";
import { AppShell, useMobileTitle, useMobileFab } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { trpc } from "@/lib/trpc/client";
import { ipcEntityTypeToCore } from "@/components/schemas/adapters";
import { BaseView, useEntityMutations } from "@/components/bases";
import { getIcon } from "@/components/schemas/icon-map";
import { Skeleton, useToast } from "@supernote/ui";
import { getCodaBinding } from "@/lib/coda/bindings";
import { refreshCodaBase } from "@/lib/coda/refresh";

export default function BasePage() {
  const params = useParams<{ typeId: string }>();
  const router = useRouter();
  const isMobile = useIsMobile();

  const typeId = params?.typeId ?? "";

  const { data: ipcTypes, isLoading: typesLoading } = trpc.schemas.list.useQuery({
    search: undefined,
  });
  const ipcType = ipcTypes?.find((t) => t.id === typeId);
  const base = ipcType ? ipcEntityTypeToCore(ipcType) : undefined;
  const mut = useEntityMutations(typeId);
  const utils = trpc.useUtils();
  const { toast } = useToast();

  // A Coda-mirrored base is read-only: no create affordances, just a refresh.
  const codaBinding = base ? getCodaBinding(base.id) : null;
  const isCoda = !!codaBinding;
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!base || refreshing) return;
    setRefreshing(true);
    const res = await refreshCodaBase(base.id);
    setRefreshing(false);
    if (res.ok) {
      void utils.entities.list.invalidate();
      void utils.views.queryForView.invalidate();
      toast({ title: `Coda synchronisé — ${res.value.upserted} ligne(s), ${res.value.deleted} supprimée(s)` });
    } else {
      toast({ title: `Échec de la synchro Coda : ${res.error.message}`, variant: "danger" });
    }
  };

  const icon = base?.icon ?? "Database";
  const Icon = getIcon(icon);

  useMobileTitle(base ? base.plural : "Base");
  useMobileFab(
    isMobile && base && !isCoda
      ? {
          icon: Plus,
          label: "Nouvelle entrée",
          onPress: () => mut.create.mutate({ typeId: base.id, fields: {}, body: "" }),
        }
      : null,
  );

  if (typesLoading) {
    return (
      <AppShell>
        <div className="p-4">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-3 h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
        </div>
      </AppShell>
    );
  }

  if (!base) {
    return (
      <AppShell>
        <div className="flex h-full flex-col items-center justify-center gap-2 p-8">
          <Database size={32} style={{ color: "var(--text-muted)" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Base introuvable.
          </p>
          <Link
            href="/schemas"
            className="text-xs underline"
            style={{ color: "var(--accent)" }}
          >
            Voir toutes les bases
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Header */}
        <header
          className="flex items-center gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
        >
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            onPress={() => router.push("/schemas")}
            aria-label="Retour aux schémas"
            className="rounded p-1"
            style={{ color: "var(--text-muted)", minWidth: 0 }}
          >
            <ArrowLeft size={16} />
          </Button>
          <Icon
            size={18}
            style={{ color: base.color ?? "var(--accent)" }}
            weight="fill"
          />
          <div className="flex flex-col">
            <h1 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {base.plural}
            </h1>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {base.fields.length} champ{base.fields.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {isCoda ? (
              <Button
                size="sm"
                onPress={() => void handleRefresh()}
                isDisabled={refreshing}
                className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium"
                style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
              >
                <ArrowsClockwise size={12} /> {refreshing ? "Synchro…" : "Rafraîchir"}
              </Button>
            ) : (
              !isMobile && (
                <Button
                  size="sm"
                  onPress={() => mut.create.mutate({ typeId: base.id, fields: {}, body: "" })}
                  className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium"
                  style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }}
                >
                  <Plus size={12} /> Nouvelle entrée
                </Button>
              )
            )}
            <Link
              href={`/schemas/${base.id}`}
              className="rounded p-1.5 hover:bg-[var(--surface-2)]"
              title="Modifier le schéma"
              style={{ color: "var(--text-muted)" }}
            >
              <Gear size={14} />
            </Link>
          </div>
        </header>

        {/* Read-only Coda banner */}
        {isCoda && codaBinding && (
          <div
            className="flex items-center gap-2 border-b px-4 py-1.5 text-xs"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--accent-subtle)",
              color: "var(--accent)",
            }}
          >
            <CloudCheck size={13} />
            <span>
              Miroir Coda en lecture seule · {codaBinding.docName} / {codaBinding.tableName}
            </span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          <BaseView base={base} readOnly={isCoda} />
        </div>
      </div>
    </AppShell>
  );
}
