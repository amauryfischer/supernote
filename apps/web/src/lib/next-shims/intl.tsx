/**
 * Drop-in shim for `next-intl` (the small subset used by this app).
 *
 * Aliased via vite.config.ts so `import { useTranslations } from "next-intl"`
 * resolves here. We re-export the runtime hooks from our own LocaleProvider,
 * which loads `messages/{fr,en}.json` chunks with vanilla `import()` and
 * exposes a tiny `t()` interpolator — enough to cover every call site in
 * the repo (string keys with `{name}` placeholders, no rich text, no plural
 * formatting beyond what JS can do natively).
 *
 * Why a shim rather than removing next-intl entirely? Forty-odd files use
 * `useTranslations(scope?)` — this lets the rest of the migration stay
 * mechanical. The runtime is implemented in @/i18n/messages.
 */

export { useTranslations, useLocale, useFormatter, useNow, useTimeZone, useMessages } from "@/i18n/messages";
