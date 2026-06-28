import { z } from "zod";

/**
 * Worker-side RPC contracts for the local Gmail mirror.
 *
 * The mirror is a disposable, account-scoped cache of a connected Gmail account
 * living in the vault SQLite DB. Gmail itself stays the source of truth — these
 * procedures are the bridge between the Gmail API (fetched on the main thread)
 * and the local mirror tables (`mail_thread` / `mail_message` / `mail_label` /
 * `mail_sync_state` / `mail_outbox`). See `db-schema.ts`.
 *
 * Shapes intentionally mirror the in-memory types in `apps/web/src/lib/gmail.ts`
 * (`ThreadListItem`, `EmailMessage`, `GmailLabel`) so the client maps 1:1.
 */

export const EmailAddressSchema = z.object({
  name: z.string(),
  email: z.string(),
});

export const EmailAttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  attachmentId: z.string(),
  messageId: z.string(),
});

// ── Row shapes (mirror → client) ────────────────────────────────────────────

/** A mirrored thread summary, enough to render the overlay list. */
export const MailThreadRowSchema = z.object({
  id: z.string(),
  subject: z.string(),
  from: EmailAddressSchema,
  date: z.string(),
  snippet: z.string(),
  labelIds: z.array(z.string()),
});
export type MailThreadRow = z.infer<typeof MailThreadRowSchema>;

/** A mirrored message of an opened thread. */
export const MailMessageRowSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  subject: z.string(),
  from: EmailAddressSchema,
  to: z.array(EmailAddressSchema),
  date: z.string(),
  snippet: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string().optional(),
  attachments: z.array(EmailAttachmentSchema),
  messageId: z.string().optional(),
  references: z.string().optional(),
  webLink: z.string(),
  labelIds: z.array(z.string()),
});
export type MailMessageRow = z.infer<typeof MailMessageRowSchema>;

export const MailLabelRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z
    .object({ textColor: z.string(), backgroundColor: z.string() })
    .optional(),
  type: z.string().optional(),
});
export type MailLabelRow = z.infer<typeof MailLabelRowSchema>;

export const MailOutboxRowSchema = z.object({
  opId: z.string(),
  threadId: z.string(),
  kind: z.string(),
  addLabelIds: z.array(z.string()),
  removeLabelIds: z.array(z.string()),
  attempts: z.number().int().nonnegative(),
  createdAt: z.number(),
});
export type MailOutboxRow = z.infer<typeof MailOutboxRowSchema>;

// ── mail.listThreads ────────────────────────────────────────────────────────

export const ListThreadsInput = z.object({
  accountId: z.string(),
  /** Restrict to threads carrying this Gmail label id (e.g. "INBOX"). */
  labelId: z.string().optional(),
  isUnread: z.boolean().optional(),
  isStarred: z.boolean().optional(),
  limit: z.number().int().positive().max(500).default(50),
  offset: z.number().int().nonnegative().default(0),
});
export type ListThreadsInput = z.infer<typeof ListThreadsInput>;

export const ListThreadsOutput = z.object({
  items: z.array(MailThreadRowSchema),
  total: z.number().int().nonnegative(),
});
export type ListThreadsOutput = z.infer<typeof ListThreadsOutput>;

// ── mail.getThread ──────────────────────────────────────────────────────────

export const GetThreadInput = z.object({
  accountId: z.string(),
  threadId: z.string(),
});
export type GetThreadInput = z.infer<typeof GetThreadInput>;

export const GetThreadOutput = z.object({
  /** null when the thread isn't mirrored yet (caller falls back to live fetch). */
  thread: z
    .object({
      id: z.string(),
      messages: z.array(MailMessageRowSchema),
      labelIds: z.array(z.string()),
      /** false when only the summary is mirrored (messages not fetched yet). */
      complete: z.boolean(),
    })
    .nullable(),
});
export type GetThreadOutput = z.infer<typeof GetThreadOutput>;

// ── mail.getLabels ──────────────────────────────────────────────────────────

export const GetLabelsInput = z.object({ accountId: z.string() });
export type GetLabelsInput = z.infer<typeof GetLabelsInput>;

export const GetLabelsOutput = z.object({ labels: z.array(MailLabelRowSchema) });
export type GetLabelsOutput = z.infer<typeof GetLabelsOutput>;

// ── mail.getState ───────────────────────────────────────────────────────────

export const GetStateInput = z.object({ accountId: z.string() });
export type GetStateInput = z.infer<typeof GetStateInput>;

export const GetStateOutput = z.object({
  historyId: z.string().nullable(),
  lastFullSyncAt: z.number(),
  lastSyncAt: z.number(),
  threadCount: z.number().int().nonnegative(),
  /** Outbox ops still to push (status != 'failed'). */
  pendingOutbox: z.number().int().nonnegative(),
  /** Outbox ops that exhausted their retries (status = 'failed'). */
  failedOutbox: z.number().int().nonnegative(),
});
export type GetStateOutput = z.infer<typeof GetStateOutput>;

// ── mail.syncUpsert ─────────────────────────────────────────────────────────
// One atomic reconciliation batch applied by the sync engine.

export const MailThreadInputSchema = z.object({
  id: z.string(),
  subject: z.string().default(""),
  from: EmailAddressSchema,
  snippet: z.string().default(""),
  date: z.string().default(""),
  internalDate: z.number().default(0),
  labelIds: z.array(z.string()).default([]),
  historyId: z.string().optional(),
});
export type MailThreadInput = z.infer<typeof MailThreadInputSchema>;

export const MailMessageInputSchema = MailMessageRowSchema.extend({
  internalDate: z.number().default(0),
});
export type MailMessageInput = z.infer<typeof MailMessageInputSchema>;

export const SyncUpsertInput = z.object({
  accountId: z.string(),
  threads: z.array(MailThreadInputSchema).optional(),
  /** Full message sets for opened/fully-synced threads, keyed by threadId. */
  messages: z
    .array(
      z.object({
        threadId: z.string(),
        labelIds: z.array(z.string()),
        items: z.array(MailMessageInputSchema),
      }),
    )
    .optional(),
  labels: z.array(MailLabelRowSchema).optional(),
  /** Thread ids that disappeared server-side (deleted / no longer matched). */
  removeThreadIds: z.array(z.string()).optional(),
  /** New reconciliation cursor (Gmail historyId of this batch). */
  historyId: z.string().optional(),
  /** Stamp lastFullSyncAt (a full reseed just completed). */
  markFullSync: z.boolean().optional(),
});
export type SyncUpsertInput = z.infer<typeof SyncUpsertInput>;

export const SyncUpsertOutput = z.object({
  threads: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
});
export type SyncUpsertOutput = z.infer<typeof SyncUpsertOutput>;

// ── mail.applyLocalMutation ─────────────────────────────────────────────────
// Optimistic label change: patches the mirror AND enqueues an outbox op atomically.

export const ApplyLocalMutationInput = z.object({
  accountId: z.string(),
  opId: z.string(),
  threadId: z.string(),
  /** Logical kind for the pusher (modifyLabels | trash | untrash). */
  kind: z.string(),
  addLabelIds: z.array(z.string()).default([]),
  removeLabelIds: z.array(z.string()).default([]),
  /** Remove the thread row from the mirror (archive/trash leaving the view). */
  dropThread: z.boolean().optional(),
  /**
   * Enqueue an outbox op for the background pusher (default true). Pass false to
   * patch the mirror only — used when the caller pushes to Gmail itself (the UI
   * already issues the direct API call) so the change isn't sent twice.
   */
  enqueue: z.boolean().default(true),
});
export type ApplyLocalMutationInput = z.infer<typeof ApplyLocalMutationInput>;

export const ApplyLocalMutationOutput = z.object({ ok: z.boolean() });
export type ApplyLocalMutationOutput = z.infer<typeof ApplyLocalMutationOutput>;

// ── mail.listOutbox ─────────────────────────────────────────────────────────

export const ListOutboxInput = z.object({ accountId: z.string() });
export type ListOutboxInput = z.infer<typeof ListOutboxInput>;

export const ListOutboxOutput = z.object({ items: z.array(MailOutboxRowSchema) });
export type ListOutboxOutput = z.infer<typeof ListOutboxOutput>;

// ── mail.resolveOutbox ──────────────────────────────────────────────────────

export const ResolveOutboxInput = z.object({
  opIds: z.array(z.string()),
  outcome: z.enum(["ack", "fail"]),
  error: z.string().optional(),
});
export type ResolveOutboxInput = z.infer<typeof ResolveOutboxInput>;

export const ResolveOutboxOutput = z.object({
  resolved: z.number().int().nonnegative(),
});
export type ResolveOutboxOutput = z.infer<typeof ResolveOutboxOutput>;

// ── mail.retryFailed ────────────────────────────────────────────────────────
// Reset failed outbox ops back to pending (attempts cleared) so the next flush
// retries them. Used by the "N échec(s)" badge's retry action.

export const RetryFailedInput = z.object({ accountId: z.string() });
export type RetryFailedInput = z.infer<typeof RetryFailedInput>;

export const RetryFailedOutput = z.object({
  retried: z.number().int().nonnegative(),
});
export type RetryFailedOutput = z.infer<typeof RetryFailedOutput>;
