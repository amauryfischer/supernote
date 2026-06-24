import { useCallback } from "react";
import { useSettings } from "@/components/settings/SettingsContext";
import { createDraft, buildGmailDraftUrl } from "@/lib/gmail";

export interface CreateDraftOptions {
  to?: string;
  subject: string;
  body: string;
}

export interface CreateDraftResult {
  draftId: string;
  url: string;
}

/**
 * Crée un brouillon Gmail et renvoie son URL web. Réutilise le Client ID
 * Google (Drive) ; nécessite Gmail connecté. Le scope `gmail.compose` est
 * demandé en incrémental par `createDraft`. Décalque `useCreateDriveDoc`.
 */
export function useCreateDraft() {
  const { settings } = useSettings();
  const createDraftFn = useCallback(
    async (opts: CreateDraftOptions): Promise<CreateDraftResult> => {
      const clientId = settings.googleDrive?.clientId?.trim() ?? "";
      if (!clientId) {
        throw new Error("Google n'est pas configuré (Paramètres → Google Drive).");
      }
      if (!settings.gmail?.connectedEmail) {
        throw new Error("Gmail n'est pas connecté (Paramètres → Gmail).");
      }
      const { draftId } = await createDraft(clientId, opts);
      return { draftId, url: buildGmailDraftUrl(draftId) };
    },
    [settings.googleDrive?.clientId, settings.gmail?.connectedEmail],
  );
  return { createDraft: createDraftFn };
}
