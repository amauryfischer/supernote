"use client";

/**
 * Settings → Coda. Shows whether the server-side connector is wired
 * (CODA_API_TOKEN), launches the import wizard, and lists the bases already
 * mirrored from Coda with a per-base refresh.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Chip } from "@heroui/react";
import { Table as TableIcon, ArrowsClockwise, ArrowSquareOut, Plus } from "@phosphor-icons/react";
import { useToast } from "@supernote/ui";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { codaStatus } from "@/lib/coda/client";
import { listCodaBindings, type CodaBinding } from "@/lib/coda/bindings";
import { refreshCodaBase } from "@/lib/coda/refresh";
import { CodaImportModal } from "@/components/coda/CodaImportModal";

export function CodaTab() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [bindings, setBindings] = useState<Record<string, CodaBinding>>(() => listCodaBindings());
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  useEffect(() => {
    void codaStatus().then(setEnabled);
  }, []);

  const reloadBindings = () => setBindings(listCodaBindings());

  const refresh = async (baseId: string) => {
    setRefreshingId(baseId);
    const res = await refreshCodaBase(baseId);
    setRefreshingId(null);
    if (res.ok) {
      toast({ title: `Synchronisé — ${res.value.upserted} ligne(s), ${res.value.deleted} supprimée(s)` });
      reloadBindings();
    } else {
      toast({ title: `Échec : ${res.error.message}`, variant: "danger" });
    }
  };

  const entries = Object.entries(bindings);

  return (
    <div className="flex flex-col gap-4">
      <SettingSection
        title="Coda (lecture seule)"
        description="Importe des tables Coda comme bases Supernote en lecture seule. Le token vit côté serveur (CODA_API_TOKEN)."
        icon={<TableIcon size={16} />}
        action={
          <Chip size="sm" variant="soft" color={enabled ? "success" : "default"}>
            {enabled === null ? "…" : enabled ? "Connecté" : "Indisponible"}
          </Chip>
        }
      >
        {enabled === false && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Définissez <code>CODA_API_TOKEN</code> dans l'environnement du serveur pour activer
            l'import Coda.
          </p>
        )}
        {enabled && (
          <SettingRow label="Importer" description="Choisir des tables Coda à répliquer localement.">
            <Button
              size="sm"
              onPress={() => setModalOpen(true)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
            >
              <Plus size={14} /> Importer depuis Coda
            </Button>
          </SettingRow>
        )}
      </SettingSection>

      {entries.length > 0 && (
        <SettingSection
          title="Bases importées"
          description="Bases miroir Coda. « Rafraîchir » re-tire les données et reconstruit les relations."
          icon={<ArrowsClockwise size={16} />}
        >
          {entries.map(([baseId, b]) => (
            <SettingRow
              key={baseId}
              label={b.tableName}
              description={`${b.docName}${b.lastRefreshedAt ? ` · maj ${new Date(b.lastRefreshedAt).toLocaleString()}` : ""}`}
            >
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => void refresh(baseId)}
                  isDisabled={refreshingId === baseId}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                  style={{ color: "var(--accent)" }}
                >
                  <ArrowsClockwise size={13} />
                  {refreshingId === baseId ? "Synchro…" : "Rafraîchir"}
                </Button>
                <Link
                  href={`/bases/${baseId}`}
                  className="rounded p-1.5 hover:bg-[var(--surface-2)]"
                  title="Ouvrir la base"
                  style={{ color: "var(--text-muted)" }}
                >
                  <ArrowSquareOut size={14} />
                </Link>
              </div>
            </SettingRow>
          ))}
        </SettingSection>
      )}

      <CodaImportModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onImported={reloadBindings}
      />
    </div>
  );
}
