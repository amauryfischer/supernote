"use client";

import {
  BookOpen,
  Calendar,
  FileText,
  Hash,
  Layers,
  Users,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShellChrome } from "@/components/shell/shell-chrome-context";

interface QuickAccessItem {
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const QUICK_ACCESS: QuickAccessItem[] = [
  { label: "Notes", description: "Vos notes libres et documents", icon: FileText },
  { label: "Contacts", description: "Personnes et organisations", icon: Users },
  { label: "Projets", description: "Projets et tâches actives", icon: Layers },
  { label: "Journal", description: "Notes quotidiennes", icon: Calendar },
  { label: "Schémas", description: "Types d'entités et champs", icon: Hash },
  { label: "Vues", description: "Requêtes et vues sauvegardées", icon: BookOpen },
  { label: "Routines", description: "Automations et rappels", icon: Zap },
];

/**
 * The writing surface IS the homepage. The user can start typing immediately.
 * As soon as they start writing, the other affordances fade out so the writing
 * flow is unobstructed. ESC restores the home view.
 */
export function WritingSurface() {
  const [content, setContent] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const shellChrome = useShellChrome();

  const isWriting = isFocused || content.length > 0;

  // Tell the shell to dim its non-essential UI while the user writes.
  useEffect(() => {
    shellChrome.setFocusMode(isWriting);
  }, [isWriting, shellChrome]);

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    setContent(e.currentTarget.innerText);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && content.trim().length === 0) {
      editorRef.current?.blur();
    }
  };

  const exitWriting = () => {
    if (editorRef.current) {
      editorRef.current.innerText = "";
    }
    setContent("");
    setIsFocused(false);
  };

  // Derive the auto-title from the first non-empty line.
  const titlePreview =
    content.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
  const truncatedTitle =
    titlePreview.length > 60 ? titlePreview.slice(0, 60) + "…" : titlePreview;

  return (
    <div className="relative mx-auto flex h-full max-w-3xl flex-col px-8">
      {/* Writing canvas */}
      <div
        className={`transition-all duration-300 ease-out ${
          isWriting ? "pt-20" : "pt-16"
        }`}
      >
        {/* Title chip (subtle, derived from first line) */}
        <div
          className={`mb-3 transition-opacity duration-200 ${
            isWriting && truncatedTitle ? "opacity-100" : "opacity-0"
          }`}
          style={{ minHeight: "1.25rem" }}
        >
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--accent)" }}
            />
            Inbox · {truncatedTitle || "nouvelle note"}
          </span>
        </div>

        {/* The actual writing area */}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          spellCheck
          data-placeholder="Commencez à écrire…"
          className="writing-canvas outline-none"
          style={{
            minHeight: "8rem",
            fontSize: "1.0625rem",
            lineHeight: "1.7",
            color: "var(--text-primary)",
          }}
        />
      </div>

      {/* Footer hint when writing */}
      <div
        className={`pointer-events-none fixed bottom-6 left-1/2 z-20 -translate-x-1/2 transition-all duration-200 ${
          isWriting
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2 opacity-0"
        }`}
      >
        <div
          className="pointer-events-auto flex items-center gap-3 rounded-full border px-4 py-1.5 text-[11px] shadow-sm backdrop-blur"
          style={{
            backgroundColor: "var(--surface-1)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-muted)",
          }}
        >
          <kbd
            className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-2)",
            }}
          >
            ⌘ S
          </kbd>
          <span>enregistrer</span>
          <span style={{ color: "var(--border)" }}>·</span>
          <kbd
            className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-2)",
            }}
          >
            Esc
          </kbd>
          <button
            onClick={exitWriting}
            className="transition-colors hover:text-[var(--text-primary)]"
          >
            quitter
          </button>
        </div>
      </div>

      {/* Quick access grid — fades out while writing */}
      <div
        className={`mt-12 transition-all duration-300 ease-out ${
          isWriting
            ? "pointer-events-none -translate-y-2 opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        <h2
          className="mb-4 text-[10px] font-medium uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          Accès rapide
        </h2>
        <div className="grid grid-cols-2 gap-3 pb-12">
          {QUICK_ACCESS.map((item) => (
            <button
              key={item.label}
              className="group flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-[var(--surface-2)]"
              style={{
                backgroundColor: "var(--surface-1)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <div
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: "var(--surface-2)" }}
              >
                <item.icon
                  size={15}
                  className="text-[var(--text-secondary)]"
                />
              </div>
              <div className="min-w-0">
                <p
                  className="text-sm font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  {item.label}
                </p>
                <p
                  className="truncate text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  {item.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Placeholder behavior for contentEditable */}
      <style jsx global>{`
        .writing-canvas:empty:before {
          content: attr(data-placeholder);
          color: var(--text-muted);
          opacity: 0.5;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
