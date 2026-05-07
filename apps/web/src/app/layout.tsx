import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Supernote",
  description: "Système de connaissance + CRM personnel local-first",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /*
     * suppressHydrationWarning is required when using next-themes:
     * the `class` attribute on <html> is set client-side to avoid
     * a flash-of-incorrect-theme, causing a server/client mismatch
     * that React would otherwise warn about.
     *
     * HeroUI v3 does NOT require a HeroUIProvider — the library is
     * fully CSS-based in v3 (provider was removed). Theming is handled
     * via CSS variables and next-themes class toggling.
     */
    <html lang="fr" suppressHydrationWarning>
      <body className="bg-[var(--surface-0)] text-[var(--text-primary)] antialiased">
        {children}
      </body>
    </html>
  );
}
