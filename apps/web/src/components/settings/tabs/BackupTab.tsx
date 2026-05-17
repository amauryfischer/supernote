"use client";

import { Archive, Upload, Download, FileZip, Clock, Trash, Play } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@heroui/react";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { localStore } from "@/lib/local-store";
import { DEMO_NOTES } from "@/components/notes/demo-fixtures";
import { DEMO_CONTACTS, DEMO_ORGANISATIONS } from "@/components/contacts/demo-fixtures";

interface ExportRecord {
  id: string;
  date: string;
  size: string;
  type: string;
}

const MOCK_EXPORTS: ExportRecord[] = [];

/** Injects demo fixture data into localStorage so the user can explore the app. */
function loadDemoData(): void {
  // Notes
  for (const note of DEMO_NOTES) {
    localStore.create("note", { title: note.title, body: note.body, folderPath: note.folderPath }, { tags: note.tags });
  }
  // Contacts
  for (const org of DEMO_ORGANISATIONS) {
    localStore.create("organisation", { name: org.name, sector: org.industry, website: org.website ?? "" });
  }
  for (const contact of DEMO_CONTACTS) {
    localStore.create("personne", {
      name: contact.name,
      email: contact.emails[0]?.value ?? "",
      phone: contact.phones[0]?.value ?? "",
      notes: contact.notes,
    }, { tags: contact.tags });
  }
  // Finance — fixtures supprimées avec la réécriture finance from scratch.
}

export function BackupTab() {
  const [exporting, setExporting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [demoLoaded, setDemoLoaded] = useState(false);
  const exports = MOCK_EXPORTS;

  const handleExport = async () => {
    // ZIP export via worker is not yet implemented. Keep the spinner UX so
    // users see something happen; the button is disabled below until then.
    setExporting(true);
    await new Promise((r) => setTimeout(r, 1200));
    setExporting(false);
  };

  const handleResetDemo = () => {
    localStore.clear();
    setResetDone(true);
    setDemoLoaded(false);
    setTimeout(() => setResetDone(false), 3000);
  };

  const handleLoadDemo = () => {
    localStore.clear();
    loadDemoData();
    setDemoLoaded(true);
    setTimeout(() => setDemoLoaded(false), 4000);
  };

  return (
    <div className="space-y-6">
      <SettingSection
        title="Export"
        description="Exportez l'intégralité de votre vault"
        icon={<Archive size={16} />}
      >
        <SettingRow label="Vault complet">
          <div className="flex flex-col gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onPress={handleExport}
              isDisabled
              aria-label="À implémenter — export via worker"
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
              style={{
                borderColor: "var(--accent)",
                color: "var(--accent)",
                backgroundColor: "var(--accent-subtle)",
              }}
            >
              <FileZip size={14} className={exporting ? "animate-pulse" : ""} />
              {exporting ? "Export en cours..." : "Exporter le vault en ZIP"}
            </Button>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              À implémenter — export via worker
            </span>
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Données démo"
        description="Charger ou vider des exemples de données pour explorer l'application"
        icon={<Play size={16} />}
      >
        <SettingRow label="Charger des exemples">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onPress={handleLoadDemo}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                style={{
                  borderColor: "var(--accent)",
                  color: "var(--accent)",
                  backgroundColor: "var(--accent-subtle)",
                }}
              >
                <Play size={14} />
                Charger des exemples (démo)
              </Button>
              {demoLoaded && (
                <span className="text-xs" style={{ color: "oklch(0.45 0.16 150)" }}>
                  Exemples chargés — rechargez la page pour voir les données.
                </span>
              )}
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Injecte des notes, contacts et données finance fictifs dans le store local. Vos données existantes sont effacées.
            </p>
          </div>
        </SettingRow>

        <SettingRow label="Vider le store local">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onPress={handleResetDemo}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
              style={{
                borderColor: "var(--danger)",
                color: "var(--danger)",
                backgroundColor: "transparent",
              }}
            >
              <Trash size={14} />
              Vider les données locales
            </Button>
            {resetDone && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Données effacées.
              </span>
            )}
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Import"
        description="Importez depuis d'autres applications"
        icon={<Upload size={16} />}
      >
        <SettingRow label="Sources">
          <div className="flex flex-wrap gap-2">
            {["Notion", "Obsidian", "vCard"].map((source) => (
              <Button
                key={source}
                isDisabled
                variant="ghost"
                size="sm"
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text-secondary)",
                  backgroundColor: "var(--surface-1)",
                }}
              >
                <Download size={12} />
                {source}
              </Button>
            ))}
          </div>
          <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
            À implémenter — import via worker
          </p>
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Historique des exports"
        description="Vos exports récents"
        icon={<Clock size={16} />}
      >
        {exports.length === 0 ? (
          <p className="px-1 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Aucun export récent
          </p>
        ) : (
          <div className="space-y-2">
            {exports.map((exp) => (
              <div
                key={exp.id}
                className="flex items-center justify-between rounded-lg border p-3"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)" }}
              >
                <div className="flex items-center gap-3">
                  <FileZip size={16} style={{ color: "var(--text-muted)" }} />
                  <div>
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                      vault_{exp.date.replace(/[: ]/g, "-")}.zip
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {exp.date} — {exp.size}
                    </p>
                  </div>
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-xs"
                  style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
                >
                  {exp.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </SettingSection>
    </div>
  );
}
