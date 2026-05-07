"use client";

import { Archive, Upload, Download, FileZip, Clock } from "@phosphor-icons/react";
import { useState } from "react";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";

interface ExportRecord {
  id: string;
  date: string;
  size: string;
  type: string;
}

const MOCK_EXPORTS: ExportRecord[] = [
  { id: "1", date: "2026-05-06 14:32", size: "12.4 MB", type: "ZIP" },
  { id: "2", date: "2026-04-29 09:15", size: "11.8 MB", type: "ZIP" },
];

export function BackupTab() {
  const [exporting, setExporting] = useState(false);
  const exports = MOCK_EXPORTS;

  const handleExport = async () => {
    setExporting(true);
    await new Promise((r) => setTimeout(r, 1200));
    setExporting(false);
  };

  return (
    <div className="space-y-6">
      <SettingSection
        title="Export"
        description="Exportez l'intégralité de votre vault"
        icon={<Archive size={16} />}
      >
        <SettingRow label="Vault complet">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-all hover:opacity-80 disabled:opacity-50"
            style={{
              borderColor: "var(--accent)",
              color: "var(--accent)",
              backgroundColor: "var(--accent-subtle)",
            }}
          >
            <FileZip size={14} className={exporting ? "animate-pulse" : ""} />
            {exporting ? "Export en cours..." : "Exporter le vault en ZIP"}
          </button>
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
              <button
                key={source}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-all hover:opacity-80"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text-secondary)",
                  backgroundColor: "var(--surface-1)",
                }}
              >
                <Download size={12} />
                {source}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Historique des exports"
        description="Vos exports récents"
        icon={<Clock size={16} />}
      >
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
      </SettingSection>
    </div>
  );
}
