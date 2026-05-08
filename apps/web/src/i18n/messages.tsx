/**
 * Lightweight i18n runtime — replaces next-intl now that we're on Vite.
 *
 * Provides exactly the API surface this app uses:
 *   - `useTranslations(scope?)` → `(key, vars?) => string`
 *   - `useLocale()` → "fr" | "en"
 *   - `useFormatter()` → minimal Intl wrappers
 *
 * Messages are loaded lazily from `messages/{fr,en}.json` (the same files
 * that next-intl was reading) via `import()`. The provider is mounted in
 * `RootLayout` and gates rendering until the active locale resolves so no
 * consumer ever sees an undefined message.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";

type Messages = Record<string, unknown>;

const STORAGE_KEY = "supernote_locale";

// ── Module-level cache so toggling back-and-forth doesn't re-fetch. ────────
const messagesCache = new Map<Locale, Messages>();

async function loadMessages(locale: Locale): Promise<Messages> {
  const cached = messagesCache.get(locale);
  if (cached) return cached;
  const mod =
    locale === "en"
      ? await import("../../messages/en.json")
      : await import("../../messages/fr.json");
  const messages = (mod.default ?? mod) as Messages;
  messagesCache.set(locale, messages);
  return messages;
}

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale;
  } catch {
    /* localStorage disabled */
  }
  return DEFAULT_LOCALE;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function lookup(messages: Messages, dottedKey: string): unknown {
  const segments = dottedKey.split(".");
  let current: unknown = messages;
  for (const segment of segments) {
    if (current && typeof current === "object" && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  // Replace `{name}` placeholders. Mirrors next-intl's ICU-light behaviour
  // for simple substitutions — plurals/select aren't used in our messages.
  return template.replace(/\{(\w+)\}/g, (full, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? full : String(v);
  });
}

// ── Context ────────────────────────────────────────────────────────────────

interface LocaleContextValue {
  locale: Locale;
  messages: Messages;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

interface LocaleProviderProps {
  children: ReactNode;
}

/**
 * Loads and provides translations for the active locale. Renders `null`
 * until messages are ready — same behaviour the previous next-intl-based
 * provider had (sub-second gap on cold load).
 */
export function MessagesProvider({ children }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [messages, setMessages] = useState<Messages | null>(null);

  // Hydrate from storage once on mount.
  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  // Re-fetch chunk when locale changes.
  useEffect(() => {
    let cancelled = false;
    void loadMessages(locale).then((m) => {
      if (!cancelled) setMessages(m);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<LocaleContextValue | null>(
    () => (messages ? { locale, messages, setLocale } : null),
    [locale, messages, setLocale],
  );

  if (!value) return null;

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

// ── Hooks ──────────────────────────────────────────────────────────────────

function useCtx(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    // Should never happen — MessagesProvider gates the entire tree. But if
    // someone calls `useTranslations` outside it (e.g. tests), fail loud.
    throw new Error("useTranslations / useLocale called outside MessagesProvider");
  }
  return ctx;
}

export type Translator = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Returns a translator scoped to `namespace` (or the root if omitted).
 * Mirrors next-intl's `useTranslations(scope?)` exactly for the flat-key,
 * variable-substitution subset our message files use.
 */
export function useTranslations(namespace?: string): Translator {
  const { messages } = useCtx();
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      const value = lookup(messages, fullKey);
      if (typeof value === "string") return interpolate(value, vars);
      // Fall back to the key itself so the UI doesn't render `undefined`.
      return fullKey;
    },
    [messages, namespace],
  );
}

export function useLocale(): Locale {
  return useCtx().locale;
}

export function useMessages(): Messages {
  return useCtx().messages;
}

/**
 * Tiny `useFormatter` shim. We don't use `dateTime`/`number`/`relativeTime`
 * formatters anywhere in the current code, but the shape is provided in case
 * a future caller imports it.
 */
export function useFormatter() {
  const locale = useLocale();
  return useMemo(
    () => ({
      dateTime: (date: Date, options?: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(locale, options).format(date),
      number: (n: number, options?: Intl.NumberFormatOptions) =>
        new Intl.NumberFormat(locale, options).format(n),
      relativeTime: (value: number, unit: Intl.RelativeTimeFormatUnit) =>
        new Intl.RelativeTimeFormat(locale).format(value, unit),
    }),
    [locale],
  );
}

export function useNow(): Date {
  return new Date();
}

export function useTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Convenience exposed so callers (e.g. the existing LocaleProvider wrapper)
// can change the language imperatively.
export function useSetLocale() {
  return useCtx().setLocale;
}
