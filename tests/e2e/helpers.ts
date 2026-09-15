import type { Page } from "@playwright/test";

/**
 * Amorce l'app sans sélecteur de dossier ni visite guidée.
 *
 * Le mode dégradé fait tourner le coffre sur un mock localStorage : sans lui,
 * PwaVaultSetup affiche un overlay bloquant et `showDirectoryPicker()` ne peut
 * pas être piloté depuis un test. La persistence RPC y expire, l'édition
 * client fonctionne — c'est ce que ces tests couvrent.
 */
export async function bootDegraded(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("supernote.degraded", "1");
    localStorage.setItem("supernote.onboarding.completed", "true");
  });
}
