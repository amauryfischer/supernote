import type { AppSettings } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    vaultPath: "~/Documents/supernote",
    language: "fr",
    timezone: "Europe/Paris",
    dateFormat: "DD/MM/YYYY",
  },
  appearance: {
    theme: "system",
    accentColor: "#7c3aed",
    density: "normal",
    codeFont: "mono",
  },
  ia: {
    autoTagging: true,
    ollamaModel: "llama3.2",
    confidenceThreshold: 0.7,
    autoClassify: true,
    mentionDetection: true,
    actionExtraction: false,
    dailyBrief: false,
    rag: true,
  },
  sync: {
    gitRemoteUrl: "",
    autoCommitInterval: 5,
  },
  plugins: [],
  api: {
    httpToken: "sn_" + Math.random().toString(36).slice(2, 18),
    serverUrl: "http://localhost:3001",
  },
  shortcuts: [
    { id: "new-note", label: "Nouvelle note", keys: "Cmd+N" },
    { id: "command-palette", label: "Palette de commandes", keys: "Cmd+K" },
    { id: "search", label: "Recherche globale", keys: "Cmd+F" },
    { id: "toggle-sidebar", label: "Basculer la barre latérale", keys: "Cmd+B" },
    { id: "save", label: "Sauvegarder", keys: "Cmd+S" },
    { id: "settings", label: "Paramètres", keys: "Cmd+," },
    { id: "go-notes", label: "Aller aux notes", keys: "Cmd+1" },
    { id: "go-contacts", label: "Aller aux contacts", keys: "Cmd+2" },
  ],
  editorShortcuts: {},
  notifications: {
    osNotifications: true,
    sounds: false,
    persistence: false,
    toastDuration: 4,
  },
  googleDrive: {
    clientId: "",
    connectedEmail: "",
    driveRootFolderId: "",
  },
  gmail: {
    connectedEmail: "",
    aliases: [],
  },
};

export const ACCENT_COLORS = [
  { label: "Violet", value: "#7c3aed" },
  { label: "Bleu", value: "#2563eb" },
  { label: "Cyan", value: "#0891b2" },
  { label: "Vert", value: "#16a34a" },
  { label: "Ambre", value: "#d97706" },
  { label: "Orange", value: "#ea580c" },
  { label: "Rouge", value: "#dc2626" },
  { label: "Rose", value: "#db2777" },
];
