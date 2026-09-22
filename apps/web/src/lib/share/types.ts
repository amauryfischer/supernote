export type ShareKind = "note" | "email";
export type ShareMode = "read" | "write";

export interface EmailSnapshot {
  subject: string;
  messages: { from: string; to: string; date: string; bodyText: string }[];
}
