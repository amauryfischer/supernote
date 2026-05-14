"use client";

import { Key, Copy, ArrowCounterClockwise, Check, Desktop } from "@phosphor-icons/react";
import { useState } from "react";
import { Button, Input } from "@heroui/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";

export function ApiTab() {
  const { settings, updateSettings } = useSettings();
  const { api } = settings;
  const [copied, setCopied] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const copyToken = async () => {
    await navigator.clipboard.writeText(api.httpToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regenerateToken = () => {
    const newToken = "sn_" + Math.random().toString(36).slice(2, 18);
    updateSettings("api", { ...api, httpToken: newToken });
  };

  const displayToken = showToken ? api.httpToken : api.httpToken.replace(/./g, "•");

  return (
    <div className="space-y-6">
      <SettingSection
        title="Token HTTP"
        description="Authentification pour l'API REST locale"
        icon={<Key size={16} />}
      >
        <SettingRow label="Token actuel">
          <div className="flex items-center gap-2">
            <span
              className="rounded-md border px-3 py-1.5 font-mono text-xs"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-1)",
                color: "var(--text-secondary)",
                minWidth: 180,
                letterSpacing: showToken ? "normal" : "0.15em",
              }}
            >
              {displayToken}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setShowToken((s) => !s)}
              className="text-xs underline"
              style={{ color: "var(--text-muted)" }}
            >
              {showToken ? "Masquer" : "Afficher"}
            </Button>
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={copyToken}
              aria-label="Copier le token"
              className="rounded-md border p-1.5"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)", backgroundColor: "var(--surface-1)" }}
            >
              {copied ? (
                <Check size={14} style={{ color: "var(--success)" }} />
              ) : (
                <Copy size={14} />
              )}
            </Button>
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={regenerateToken}
              aria-label="Régénérer le token"
              className="rounded-md border p-1.5"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)", backgroundColor: "var(--surface-1)" }}
            >
              <ArrowCounterClockwise size={14} />
            </Button>
          </div>
        </SettingRow>

        <SettingRow label="URL du serveur">
          <Input
            type="url"
            value={api.serverUrl}
            onChange={(e) => updateSettings("api", { ...api, serverUrl: e.target.value })}
            className="w-60"
          />
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="MCP Server"
        description="Serveur Model Context Protocol pour les intégrations"
      >
        <SettingRow label="Statut">
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: "color-mix(in srgb, var(--success) 15%, transparent)",
              color: "var(--success)",
            }}
          >
            Actif — port 3002
          </span>
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Claude Desktop"
        description="Connecter Supernote à Claude Desktop via MCP"
        icon={<Desktop size={16} />}
      >
        <SettingRow label="Configuration">
          <div
            className="max-w-lg rounded-lg border p-3"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-1)",
            }}
          >
            <p className="mb-1.5 text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
              ~/Library/Application Support/Claude/claude_desktop_config.json
            </p>
            <pre
              className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              {`{
  "mcpServers": {
    "supernote": {
      "command": "npx",
      "args": ["-y", "@supernote/mcp-server"],
      "env": {
        "SUPERNOTE_TOKEN": "${api.httpToken}",
        "SUPERNOTE_URL": "${api.serverUrl}"
      }
    }
  }
}`}
            </pre>
          </div>
        </SettingRow>
      </SettingSection>
    </div>
  );
}
