"use client";

import { useEffect, useRef } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  isLoading?: boolean;
}

export function SearchBar({ value, onChange, isLoading }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="relative flex items-center w-full rounded-xl border"
      style={{
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
        boxShadow: "0 2px 12px oklch(0 0 0 / 0.06)",
      }}
    >
      <MagnifyingGlass
        size={22}
        className="absolute left-4 shrink-0"
        style={{ color: "var(--text-muted)" }}
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Rechercher dans tout le vault…"
        className="w-full bg-transparent py-4 pl-12 pr-12 text-lg outline-none"
        style={{ color: "var(--text-primary)" }}
        autoComplete="off"
        spellCheck={false}
      />
      {isLoading && (
        <div
          className="absolute right-10 h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "var(--accent)" }}
        />
      )}
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-4 rounded-md p-0.5 transition-colors hover:opacity-70"
          style={{ color: "var(--text-muted)" }}
          aria-label="Effacer la recherche"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}
