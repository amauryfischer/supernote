"use client";

import { Info, GithubLogo, ArrowSquareOut, ChatCircleDots } from "@phosphor-icons/react";
import { SettingSection } from "../SettingSection";
import { SettingRow } from "../SettingRow";

const APP_VERSION = "0.1.0";
const BUILD_HASH = "a1b2c3d";
const BUILD_DATE = "2026-05-07";

const LINKS = [
  { href: "https://docs.supernote.app", label: "Documentation", icon: ArrowSquareOut },
  { href: "https://github.com/supernote-app/supernote", label: "GitHub", icon: GithubLogo },
  { href: "https://discord.gg/supernote", label: "Discord", icon: ChatCircleDots },
];

const TECH_STACK = ["Next.js 15", "React 19", "HeroUI v3", "Tailwind v4", "tRPC", "Electron", "SQLite", "Ollama"];

export function AboutTab() {
  return (
    <div className="space-y-6">
      <SettingSection
        title="Supernote"
        description="Système de connaissance personnel local-first"
        icon={<Info size={16} />}
      >
        <SettingRow label="Version">
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
            >
              v{APP_VERSION}
            </span>
            <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
              {BUILD_HASH}
            </span>
          </div>
        </SettingRow>

        <SettingRow label="Build">
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {BUILD_DATE}
          </span>
        </SettingRow>

        <SettingRow label="Licence">
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            MIT
          </span>
        </SettingRow>
      </SettingSection>

      <SettingSection title="Liens" description="Documentation et communauté">
        <SettingRow label="Ressources">
          <div className="flex flex-wrap gap-2">
            {LINKS.map(({ href, label, icon: Icon }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-all hover:opacity-80"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text-secondary)",
                  backgroundColor: "var(--surface-1)",
                }}
              >
                <Icon size={14} />
                {label}
              </a>
            ))}
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title="Technologies" description="Stack open source">
        <SettingRow label="Composants">
          <div className="flex flex-wrap gap-1.5">
            {TECH_STACK.map((tech) => (
              <span
                key={tech}
                className="rounded-full px-2 py-0.5 text-xs"
                style={{ backgroundColor: "var(--surface-2)", color: "var(--text-secondary)" }}
              >
                {tech}
              </span>
            ))}
          </div>
        </SettingRow>
      </SettingSection>
    </div>
  );
}
