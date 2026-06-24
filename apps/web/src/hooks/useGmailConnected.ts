import { useSettings } from "@/components/settings";

/**
 * Vrai quand un compte Gmail est connecté : email relié présent ET Client ID
 * OAuth (réutilisé depuis Google Drive) renseigné. Source unique de vérité du
 * gate Gmail — utilisé par la page /mail, la sidebar et le drawer mobile (et les
 * phases embed/compose/capture à venir). Le `&&` re-masque Mail si l'utilisateur
 * efface le Client ID Drive après s'être connecté.
 */
export function useGmailConnected(): boolean {
  const { settings } = useSettings();
  return !!settings.gmail.connectedEmail && !!settings.googleDrive.clientId.trim();
}
