// ============================================================
// create-mail-draft action
// Platform-adaptive mail draft creation (no SMTP)
// ============================================================

import type { MailDraft } from "../types/index.js";

/**
 * Build a mailto: URL from a draft (universal fallback).
 */
export function buildMailtoUrl(draft: MailDraft): string {
  const params = new URLSearchParams();
  if (draft.cc?.length) params.set("cc", draft.cc.join(","));
  if (draft.bcc?.length) params.set("bcc", draft.bcc.join(","));
  if (draft.subject) params.set("subject", draft.subject);
  if (draft.body) params.set("body", draft.body);
  const to = draft.to.join(",");
  const qs = params.toString();
  return `mailto:${to}${qs ? `?${qs}` : ""}`;
}

/**
 * Build an AppleScript string to create a draft in Apple Mail (macOS).
 */
export function buildAppleMailScript(draft: MailDraft): string {
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const to = draft.to.map((a) => `make new to recipient with properties {address:"${escape(a)}"}`).join("\n");
  return [
    'tell application "Mail"',
    "  set newMessage to make new outgoing message with properties {",
    `    subject:"${escape(draft.subject)}",`,
    `    content:"${escape(draft.body)}",`,
    "    visible:true",
    "  }",
    "  tell newMessage",
    to,
    "  end tell",
    "end tell",
  ].join("\n");
}

/**
 * Build a PowerShell script to create a draft in Outlook via COM (Windows).
 */
export function buildOutlookPowerShellScript(draft: MailDraft): string {
  const escape = (s: string) => s.replace(/'/g, "''");
  return [
    `$outlook = New-Object -ComObject Outlook.Application`,
    `$mail = $outlook.CreateItem(0)`,
    `$mail.To = '${escape(draft.to.join(";"))}'`,
    draft.cc?.length ? `$mail.CC = '${escape(draft.cc.join(";"))}'` : "",
    `$mail.Subject = '${escape(draft.subject)}'`,
    `$mail.Body = '${escape(draft.body)}'`,
    `$mail.Display()`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Build Thunderbird CLI args to compose a draft (Linux).
 */
export function buildThunderbirdArgs(draft: MailDraft): string[] {
  const to = draft.to.join(",");
  const cc = draft.cc?.join(",") ?? "";
  const bcc = draft.bcc?.join(",") ?? "";
  const subject = draft.subject;
  const body = draft.body;
  const compose = [
    `to='${to}'`,
    cc ? `cc='${cc}'` : "",
    bcc ? `bcc='${bcc}'` : "",
    `subject='${subject}'`,
    `body='${body}'`,
  ]
    .filter(Boolean)
    .join(",");
  return ["-compose", compose];
}
