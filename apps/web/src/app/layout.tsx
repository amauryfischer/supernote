import type { Metadata } from "next";
import "./globals.css";
import { TrpcProvider } from "@/lib/trpc/Provider";
import { VaultInitBanner } from "@/lib/vault/VaultInitBanner";

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
     *
     * TrpcProvider wraps the entire app so tRPC hooks work everywhere.
     * VaultInitBanner shows a discreet status message on first launch.
     */
    <html lang="fr" suppressHydrationWarning>
      <body className="bg-[var(--surface-0)] text-[var(--text-primary)] antialiased">
        <TrpcProvider>
          <VaultInitBanner />
          {children}
        </TrpcProvider>
      </body>
    </html>
  );
}
