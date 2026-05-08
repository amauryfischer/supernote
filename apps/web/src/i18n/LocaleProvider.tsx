"use client";

/**
 * Compatibility wrapper around the new `MessagesProvider`.
 *
 * The rest of the app imports `LocaleProvider` and `useLocale` from this
 * module (it is what the old next-intl integration exposed). We now defer
 * the actual translation runtime to `@/i18n/messages`, but keep this file
 * as the public entry point so no other source file needs to change.
 */

import type { ReactNode } from "react";
import { MessagesProvider, useLocale as useLocaleStr, useSetLocale } from "./messages";
import type { Locale } from "./messages";

export type { Locale } from "./messages";
export { LOCALES, DEFAULT_LOCALE } from "./messages";

interface LocaleProviderProps {
  children: ReactNode;
}

/**
 * Mounts the message store and provides the active locale to all consumers.
 */
export function LocaleProvider({ children }: LocaleProviderProps) {
  return <MessagesProvider>{children}</MessagesProvider>;
}

/**
 * `useLocale()` returns `{ locale, setLocale }` — the API the settings page
 * expects. The newer `useLocale()` from `@/i18n/messages` returns just the
 * locale string (matching next-intl), so we wrap it here for back-compat.
 */
export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const locale = useLocaleStr();
  const setLocale = useSetLocale();
  return { locale, setLocale };
}
