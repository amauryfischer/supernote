"use client";

/**
 * Root layout — port of the former Next.js `app/layout.tsx`.
 *
 * Wraps every route with the same provider stack (theme, notifications,
 * tRPC, locale, keyboard shortcuts, prompt modal, PWA bootstrap, vault
 * picker). Renders an `<Outlet />` where children used to go.
 */

import { Outlet } from "react-router-dom";
import { ThemeProvider, ToastProvider } from "@supernote/ui";
import { NotificationsProvider } from "@supernote/notifications/renderer";
import { TrpcProvider } from "@/lib/trpc/Provider";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import { ShortcutProvider } from "@/lib/keyboard/ShortcutProvider";
import { CommandSurface } from "@/components/command";
import { NavProgress, ShellChromeProvider } from "@/components/shell";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { VaultInitBanner } from "@/lib/vault/VaultInitBanner";
import { PwaBootstrap } from "@/lib/pwa/PwaBootstrap";
import { PwaVaultSetup } from "@/lib/pwa/PwaVaultSetup";
import { AutomationNotificationBridge } from "@/lib/pwa/AutomationNotificationBridge";
import { GitSyncProvider } from "@/lib/git/GitSyncProvider";
import { OnlineSyncProvider } from "@/lib/online-sync/OnlineSyncProvider";
import { MountSyncProvider } from "@/lib/online-sync/mounts/MountSyncProvider";
import { PromptProvider } from "@/hooks/usePrompt";
import { SettingsProvider } from "@/components/settings/SettingsContext";
import { UiSoundBridge } from "@/lib/uiSounds";
import { ConfirmProvider } from "@/lib/confirm";
import { FreezeReportBanner } from "@/lib/diagnostics/FreezeReportBanner";
import { InboxAutoSort } from "@/lib/ai/InboxAutoSort";
import { MailOutgoingRunner } from "@/components/mail/MailOutgoingRunner";
import { MailFollowupRunner } from "@/components/mail/MailFollowupRunner";
import { CalendarRunner } from "@/components/agenda/CalendarRunner";

export function RootLayout() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="supernote-theme">
      <ToastProvider>
        <ConfirmProvider>
          <NotificationsProvider>
        <TrpcProvider>
          <LocaleProvider>
            <ShortcutProvider>
              <SettingsProvider>
              <PromptProvider>
                {/* Watchdog anti-freeze : breadcrumb de route + bannière de
                    rapport si la session précédente a gelé (cf. diagnostics). */}
                <FreezeReportBanner />
                {/* Global top-of-viewport navigation progress bar */}
                <NavProgress />
                {/* Register the Service Worker (no-op when not available) */}
                <PwaBootstrap />
                {/* Bridge worker AUTOMATION_NOTIFICATION → in-app drawer + OS */}
                <AutomationNotificationBridge />
                {/* Cmd+K command palette + seed commands */}
                <CommandSurface />
                {/* Sons d'interface (check, save, celebration) — joue les
                    CustomEvents "supernote:ui-sound" si le réglage
                    Notifications → sons est actif. */}
                <UiSoundBridge />
                {/* Tri de l'inbox par l'IA locale, au repos. Monté ici pour
                    vivre sous ToastProvider et TrpcProvider — il rend le
                    journal des déplacements, rien d'autre. */}
                <InboxAutoSort />
                {/* File d'envoi différé (annulation d'envoi, envoi programmé).
                    Monté ici, pas dans /mail : un message mis en file doit
                    partir même si on a quitté la page entre-temps. */}
                <MailOutgoingRunner />
                {/* Rappels de relance : un fil sans réponse revient en boîte à
                    l'échéance, même si on n'est pas sur /mail. */}
                <MailFollowupRunner />
                {/* Miroir de l'agenda : synchro et file d'écriture, hors de /agenda aussi. */}
                <CalendarRunner />
                {/* Vault auto-init status banner (only meaningful in Electron;
                    in PWA mode it stays silent). */}
                <VaultInitBanner />
                <OnboardingTour />
                {/* PWA: vault folder picker modal wraps every route.
                    GitSyncProvider lives INSIDE PwaVaultSetup so it can
                    read the active vault handle through `useVault()`. */}
                <PwaVaultSetup>
                  <GitSyncProvider>
                    <OnlineSyncProvider>
                      <MountSyncProvider>
                        {/* Chrome du shell (mode focus, panneaux, titre/FAB/
                            actions mobiles) monté AU-DESSUS des routes : les
                            pages rendent elles-mêmes `<AppShell>`, elles
                            seraient donc au-dessus d'un provider local et
                            leurs publications tomberaient dans le vide. */}
                        <ShellChromeProvider>
                          <Outlet />
                        </ShellChromeProvider>
                      </MountSyncProvider>
                    </OnlineSyncProvider>
                  </GitSyncProvider>
                </PwaVaultSetup>
              </PromptProvider>
              </SettingsProvider>
            </ShortcutProvider>
          </LocaleProvider>
        </TrpcProvider>
          </NotificationsProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
