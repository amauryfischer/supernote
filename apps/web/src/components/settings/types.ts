export type SettingsTab =
  | "general"
  | "appearance"
  | "ia-ollama"
  | "sync"
  | "plugins"
  | "api"
  | "shortcuts"
  | "notifications"
  | "backup"
  | "securite"
  | "templates"
  | "schemas"
  | "google-drive"
  | "gmail"
  | "coda"
  | "about";

export interface GeneralSettings {
  vaultPath: string;
  language: "fr" | "en";
  timezone: string;
  dateFormat: string;
}

export interface AppearanceSettings {
  theme: "light" | "dark" | "system";
  accentColor: string;
  density: "compact" | "normal" | "spacious";
  codeFont: "sans" | "mono";
}

export interface IaSettings {
  autoTagging: boolean;
  ollamaModel: string;
  confidenceThreshold: number;
  autoClassify: boolean;
  mentionDetection: boolean;
  actionExtraction: boolean;
  dailyBrief: boolean;
  rag: boolean;
}

export interface SyncSettings {
  gitRemoteUrl: string;
  autoCommitInterval: number;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  path: string;
}

export interface ApiSettings {
  httpToken: string;
  serverUrl: string;
}

export interface Shortcut {
  id: string;
  label: string;
  keys: string;
}

export interface NotificationSettings {
  osNotifications: boolean;
  sounds: boolean;
  persistence: boolean;
  toastDuration: number;
}

export interface GoogleDriveSettings {
  /**
   * Google Cloud OAuth 2.0 client ID. Set up at
   * https://console.cloud.google.com/apis/credentials by creating an
   * "OAuth 2.0 Client ID" for a Web application with the app's origin
   * (e.g. `http://localhost:3101`) as an authorized JavaScript origin.
   * Empty = Drive auto-resolution disabled.
   */
  clientId: string;
  /**
   * Email of the connected Google account — displayed in settings + used
   * to decide whether to show "Connect" vs "Disconnect" buttons.
   */
  connectedEmail: string;
  /**
   * Drive folder ID matching the vault root. When set, "Nouveau Google
   * Doc/Sheet/Slides" creates the real file INSIDE the matching Drive folder
   * (root + resolved sub-path), so Google Drive Desktop materialises the
   * `.gdoc` shortcut in the right local folder — one source of truth. Empty =
   * files land at My Drive root (you move them yourself).
   * Get it from the folder's URL in Drive: drive.google.com/drive/folders/<ID>.
   */
  driveRootFolderId: string;
}

export interface GmailSettings {
  /**
   * Email du compte Gmail relié — vide = déconnecté. Le Client ID OAuth est
   * réutilisé depuis `googleDrive.clientId` (même projet Google Cloud, avec
   * l'API Gmail activée + scope readonly autorisé).
   */
  connectedEmail: string;
  /**
   * Autres adresses « à moi » (alias, boîtes partagées : `contact@…`, etc.)
   * traitées comme le compte connecté : jamais regroupées en groupe-expéditeur
   * dans la surcouche mail (cf. `buildMailOverlay`). Insensible à la casse.
   */
  aliases: string[];
}

export interface AppSettings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  ia: IaSettings;
  sync: SyncSettings;
  plugins: Plugin[];
  api: ApiSettings;
  shortcuts: Shortcut[];
  /** Overrides utilisateur des raccourcis éditeur : actionId -> combo canonique. Absent = défaut. */
  editorShortcuts: Record<string, string>;
  notifications: NotificationSettings;
  googleDrive: GoogleDriveSettings;
  gmail: GmailSettings;
}
