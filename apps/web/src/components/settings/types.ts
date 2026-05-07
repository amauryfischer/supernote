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

export interface AppSettings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  ia: IaSettings;
  sync: SyncSettings;
  plugins: Plugin[];
  api: ApiSettings;
  shortcuts: Shortcut[];
  notifications: NotificationSettings;
}
