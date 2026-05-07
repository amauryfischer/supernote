"use client";

import { useState } from "react";
import {
  Gear,
  Palette,
  Robot,
  GitBranch,
  PuzzlePiece,
  Key,
  Keyboard,
  Bell,
  Archive,
  Info,
  FloppyDisk,
} from "@phosphor-icons/react";
import { AppShell } from "@/components/shell";
import {
  SettingsProvider,
  useSettings,
  GeneralTab,
  AppearanceTab,
  IaOllamaTab,
  SyncTab,
  PluginsTab,
  ApiTab,
  ShortcutsTab,
  NotificationsTab,
  BackupTab,
  AboutTab,
} from "@/components/settings";
import type { SettingsTab } from "@/components/settings";

interface NavItem {
  id: SettingsTab;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { id: "general", label: "Général", icon: Gear },
  { id: "appearance", label: "Apparence", icon: Palette },
  { id: "ia-ollama", label: "IA & Ollama", icon: Robot },
  { id: "sync", label: "Sync", icon: GitBranch },
  { id: "plugins", label: "Plugins", icon: PuzzlePiece },
  { id: "api", label: "API & Intégrations", icon: Key },
  { id: "shortcuts", label: "Raccourcis", icon: Keyboard },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "backup", label: "Backup & Export", icon: Archive },
  { id: "about", label: "À propos", icon: Info },
];

function TabContent({ active }: { active: SettingsTab }) {
  switch (active) {
    case "general": return <GeneralTab />;
    case "appearance": return <AppearanceTab />;
    case "ia-ollama": return <IaOllamaTab />;
    case "sync": return <SyncTab />;
    case "plugins": return <PluginsTab />;
    case "api": return <ApiTab />;
    case "shortcuts": return <ShortcutsTab />;
    case "notifications": return <NotificationsTab />;
    case "backup": return <BackupTab />;
    case "about": return <AboutTab />;
  }
}

function SettingsContent() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const { saveSettings, isSaving } = useSettings();

  const activeItem = NAV_ITEMS.find((n) => n.id === activeTab)!;
  const ActiveIcon = activeItem.icon;

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <nav
        className="flex w-52 shrink-0 flex-col gap-0.5 border-r p-3"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)" }}
      >
        <p
          className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          Paramètres
        </p>
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-all"
              style={{
                backgroundColor: isActive ? "var(--accent-subtle)" : "transparent",
                color: isActive ? "var(--accent)" : "var(--text-secondary)",
                fontWeight: isActive ? 500 : 400,
              }}
            >
              <Icon size={15} weight={isActive ? "fill" : "regular"} />
              {label}
            </button>
          );
        })}
      </nav>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2">
            <ActiveIcon size={18} style={{ color: "var(--accent)" }} />
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              {activeItem.label}
            </h1>
          </div>
          {activeTab !== "about" && (
            <button
              onClick={saveSettings}
              disabled={isSaving}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
              style={{
                backgroundColor: "var(--accent)",
                color: "var(--accent-foreground)",
              }}
            >
              <FloppyDisk size={14} />
              {isSaving ? "Enregistrement..." : "Enregistrer"}
            </button>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <TabContent active={activeTab} />
        </div>
      </div>
    </div>
  );
}

export default function ParametresPage() {
  return (
    <AppShell>
      <SettingsProvider>
        <SettingsContent />
      </SettingsProvider>
    </AppShell>
  );
}
