"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
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
  ShieldCheck,
  BookmarkSimple,
  Database,
  Table,
} from "@phosphor-icons/react";
import { AppShell, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
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
  SecurityTab,
  TemplatesTab,
  SchemasTab,
  GoogleDriveTab,
  CodaTab,
} from "@/components/settings";
import type { SettingsTab } from "@/components/settings";
import { useTranslations } from "next-intl";

interface NavItem {
  id: SettingsTab;
  labelKey: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { id: "general", labelKey: "settings.tabs.general", icon: Gear },
  { id: "appearance", labelKey: "settings.tabs.appearance", icon: Palette },
  { id: "ia-ollama", labelKey: "settings.tabs.iaOllama", icon: Robot },
  { id: "sync", labelKey: "settings.tabs.sync", icon: GitBranch },
  { id: "plugins", labelKey: "settings.tabs.plugins", icon: PuzzlePiece },
  { id: "api", labelKey: "settings.tabs.api", icon: Key },
  { id: "shortcuts", labelKey: "settings.tabs.shortcuts", icon: Keyboard },
  { id: "notifications", labelKey: "settings.tabs.notifications", icon: Bell },
  { id: "backup", labelKey: "settings.tabs.backup", icon: Archive },
  { id: "securite", labelKey: "settings.tabs.securite", icon: ShieldCheck },
  { id: "templates", labelKey: "settings.tabs.templates", icon: BookmarkSimple },
  { id: "schemas", labelKey: "settings.tabs.schemas", icon: Database },
  { id: "google-drive", labelKey: "settings.tabs.googleDrive", icon: Database },
  { id: "coda", labelKey: "settings.tabs.coda", icon: Table },
  { id: "about", labelKey: "settings.tabs.about", icon: Info },
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
    case "securite": return <SecurityTab />;
    case "templates": return <TemplatesTab />;
    case "schemas": return <SchemasTab />;
    case "google-drive": return <GoogleDriveTab />;
    case "coda": return <CodaTab />;
    case "about": return <AboutTab />;
  }
}

function SettingsContent() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const { saveSettings, isSaving } = useSettings();
  const t = useTranslations();
  const isMobile = useIsMobile();

  const activeItem = NAV_ITEMS.find((n) => n.id === activeTab)!;
  const ActiveIcon = activeItem.icon;

  // Mobile chrome — publish the active section name as the page title
  useMobileTitle(isMobile ? t("settings.title") : null, isMobile ? t(activeItem.labelKey) : null);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Navigation — desktop: fixed-width sidebar; mobile: horizontal scroll strip */}
      <nav
        className="flex shrink-0 flex-row gap-0.5 overflow-x-auto border-b p-2 md:w-52 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:border-b-0 md:border-r md:p-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)" }}
      >
        <p
          className="mb-2 hidden px-2 text-[10px] font-semibold uppercase tracking-widest md:block"
          style={{ color: "var(--text-muted)" }}
        >
          {t("settings.title")}
        </p>
        {NAV_ITEMS.map(({ id, labelKey, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <Button
              key={id}
              onPress={() => setActiveTab(id)}
              variant="ghost"
              size="sm"
              className="flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-all md:gap-2.5"
              style={{
                backgroundColor: isActive ? "var(--accent-subtle)" : "transparent",
                color: isActive ? "var(--accent)" : "var(--text-secondary)",
                fontWeight: isActive ? 500 : 400,
                justifyContent: "flex-start",
                minWidth: 0,
                height: "auto",
              }}
            >
              <Icon size={15} weight={isActive ? "fill" : "regular"} />
              <span className="whitespace-nowrap">{t(labelKey)}</span>
            </Button>
          );
        })}
      </nav>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header — hidden on mobile (title in top bar, save button kept) */}
        <div
          className="flex items-center justify-between border-b px-3 py-3 md:px-6 md:py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="hidden items-center gap-2 md:flex">
            <ActiveIcon size={18} style={{ color: "var(--accent)" }} />
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              {t(activeItem.labelKey)}
            </h1>
          </div>
          {activeTab !== "about" && activeTab !== "securite" && activeTab !== "templates" && activeTab !== "schemas" && (
            <Button
              onPress={saveSettings}
              isDisabled={isSaving}
              size="sm"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50 md:ml-auto"
              style={{
                backgroundColor: "var(--accent)",
                color: "var(--accent-foreground)",
              }}
            >
              <FloppyDisk size={14} />
              {isSaving ? t("settings.saving") : t("settings.save")}
            </Button>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6 md:py-5">
          <TabContent active={activeTab} />
        </div>
      </div>
    </div>
  );
}

export default function ParametresPage() {
  // SettingsProvider lives at the RootLayout so the settings context is
  // available across every route (the date format is read on /notes too).
  return (
    <AppShell>
      <SettingsContent />
    </AppShell>
  );
}
