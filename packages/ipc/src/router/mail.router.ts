import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  ListThreadsInput,
  ListThreadsOutput,
  GetThreadInput,
  GetThreadOutput,
  SearchThreadsInput,
  SearchThreadsOutput,
  GetLabelsInput,
  GetLabelsOutput,
  GetStateInput,
  GetStateOutput,
  SyncUpsertInput,
  SyncUpsertOutput,
  ApplyLocalMutationInput,
  ApplyLocalMutationOutput,
  ListOutboxInput,
  ListOutboxOutput,
  ResolveOutboxInput,
  ResolveOutboxOutput,
  RetryFailedInput,
  RetryFailedOutput,
  SetAiCategoryInput,
  SetAiCategoryOutput,
  SetAiSummaryInput,
  SetAiSummaryOutput,
  SetCommitmentsInput,
  SetCommitmentsOutput,
  GetAiCacheInput,
  GetAiCacheOutput,
} from "../schemas/mail.js";

/**
 * Local Gmail mirror — worker-side procedures.
 *
 * The browser vault worker implements these (see
 * `apps/web/src/lib/vault-worker/worker-router.ts`). They read/write the
 * account-scoped mirror tables; the actual Gmail network I/O happens on the
 * main thread (`apps/web/src/lib/gmail.ts`), which feeds `syncUpsert` and drains
 * the outbox.
 */
export const mailRouter = router({
  /** Read mirrored thread summaries for the list view. */
  listThreads: publicProcedure
    .input(ListThreadsInput)
    .output(ListThreadsOutput)
    .query(() => {
      throw notImplemented("mail.listThreads");
    }),

  /** Instant local search over the mirror (pre-parsed filters). */
  searchThreads: publicProcedure
    .input(SearchThreadsInput)
    .output(SearchThreadsOutput)
    .query(() => {
      throw notImplemented("mail.searchThreads");
    }),

  /** Read mirrored messages of one thread (null if not mirrored). */
  getThread: publicProcedure
    .input(GetThreadInput)
    .output(GetThreadOutput)
    .query(() => {
      throw notImplemented("mail.getThread");
    }),

  /** Read mirrored Gmail labels. */
  getLabels: publicProcedure
    .input(GetLabelsInput)
    .output(GetLabelsOutput)
    .query(() => {
      throw notImplemented("mail.getLabels");
    }),

  /** Read the reconciliation cursor + mirror/outbox counts. */
  getState: publicProcedure
    .input(GetStateInput)
    .output(GetStateOutput)
    .query(() => {
      throw notImplemented("mail.getState");
    }),

  /** Apply a reconciliation batch (upsert threads/messages/labels, drop, cursor). */
  syncUpsert: publicProcedure
    .input(SyncUpsertInput)
    .output(SyncUpsertOutput)
    .mutation(() => {
      throw notImplemented("mail.syncUpsert");
    }),

  /** Optimistic label change: patch mirror + enqueue outbox op, atomically. */
  applyLocalMutation: publicProcedure
    .input(ApplyLocalMutationInput)
    .output(ApplyLocalMutationOutput)
    .mutation(() => {
      throw notImplemented("mail.applyLocalMutation");
    }),

  /** Pending outbox ops awaiting push to Gmail. */
  listOutbox: publicProcedure
    .input(ListOutboxInput)
    .output(ListOutboxOutput)
    .query(() => {
      throw notImplemented("mail.listOutbox");
    }),

  /** Ack (delete) or fail (bump attempts) outbox ops after a push attempt. */
  resolveOutbox: publicProcedure
    .input(ResolveOutboxInput)
    .output(ResolveOutboxOutput)
    .mutation(() => {
      throw notImplemented("mail.resolveOutbox");
    }),

  /** Reset failed outbox ops to pending so the next flush retries them. */
  retryFailed: publicProcedure
    .input(RetryFailedInput)
    .output(RetryFailedOutput)
    .mutation(() => {
      throw notImplemented("mail.retryFailed");
    }),

  /** Store an AI classification on a thread (+ email_ai_cache entity for sync). */
  setAiCategory: publicProcedure
    .input(SetAiCategoryInput)
    .output(SetAiCategoryOutput)
    .mutation(() => {
      throw notImplemented("mail.setAiCategory");
    }),

  /** Store an AI summary on a thread (+ email_ai_cache entity for sync). */
  setAiSummary: publicProcedure
    .input(SetAiSummaryInput)
    .output(SetAiSummaryOutput)
    .mutation(() => {
      throw notImplemented("mail.setAiSummary");
    }),

  /** Store the commitments detected in a thread (mail_commitment entity, synced). */
  setCommitments: publicProcedure
    .input(SetCommitmentsInput)
    .output(SetCommitmentsOutput)
    .mutation(() => {
      throw notImplemented("mail.setCommitments");
    }),

  /** Bulk read AI classification + summary for a set of threads. */
  getAiCache: publicProcedure
    .input(GetAiCacheInput)
    .output(GetAiCacheOutput)
    .query(() => {
      throw notImplemented("mail.getAiCache");
    }),
});

export type MailRouter = typeof mailRouter;
