import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./config";

export default getRequestConfig(async () => {
  // Locale is resolved from cookie set by the client-side language switcher.
  // Falls back to DEFAULT_LOCALE (fr) when no cookie is present.
  const locale = DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default as Record<string, unknown>,
  };
});
