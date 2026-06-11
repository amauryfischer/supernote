"use client";

// ============================================================
// useApplyTemplate — runtime template application
// ============================================================
//
// Wires the pure renderer to the app: collects {{prompt:…}} answers through a
// sequence of HeroUI-styled PromptModals, interpolates {{date}}/{{time}} from
// the current clock, then creates a note from the rendered body and navigates
// to it. Mobile parity comes for free — `PromptModal` is a centered, focus
// trapped overlay (`max-w-sm`, `p-4`) that works identically at every width.

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PromptModal } from "@/components/shell";
import { trpc } from "@/lib/trpc/client";
import { noteFilePath } from "@/components/notes/adapters";
import type { Template } from "@supernote/templates";
import {
  applyTemplate,
  collectPrompts,
  deriveTitleFromBody,
  sanitizeFrontmatter,
  type TemplatePrompt,
} from "./apply-template";

interface ActiveApply {
  readonly template: Template;
  /** Prompts still to ask (head = current). */
  readonly remaining: TemplatePrompt[];
  /** Answers gathered so far, keyed by question. */
  readonly answers: Record<string, string>;
}

export interface UseApplyTemplateResult {
  /** Start applying a template; opens the prompt flow if it has any. */
  apply: (template: Template) => void;
  /** True while a note is being rendered + created. */
  isApplying: boolean;
  /** The modal element to mount once in the page. */
  modal: React.ReactNode;
}

/**
 * Hook owning the apply-a-template flow. The caller renders `modal` once and
 * calls `apply(template)` from a button / FAB.
 */
export function useApplyTemplate(): UseApplyTemplateResult {
  const router = useRouter();
  const [active, setActive] = useState<ActiveApply | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const createMutation = trpc.entities.create.useMutation();
  const utils = trpc.useUtils();

  const finish = useCallback(
    async (template: Template, answers: Record<string, string>) => {
      setActive(null);
      setIsApplying(true);
      try {
        const rendered = await applyTemplate(template, {
          promptAnswers: answers,
          now: new Date(),
        });
        const title = deriveTitleFromBody(rendered.body, template.name);
        const filePath = noteFilePath("Inbox", title);
        const entity = await createMutation.mutateAsync({
          typeId: template.entityType ?? "note",
          fields: { ...sanitizeFrontmatter(rendered.frontmatter), title, filePath },
          body: rendered.body,
          tags: [],
        });
        void utils.entities.list.invalidate();
        void utils.vault.folders.list.invalidate();
        router.push(`/notes/${entity.id}?folder=${encodeURIComponent("Inbox")}`);
      } finally {
        setIsApplying(false);
      }
    },
    [createMutation, router, utils],
  );

  const apply = useCallback(
    (template: Template) => {
      const prompts = collectPrompts(template);
      if (prompts.length === 0) {
        void finish(template, {});
        return;
      }
      setActive({ template, remaining: prompts, answers: {} });
    },
    [finish],
  );

  const current = active?.remaining[0] ?? null;

  const handleConfirm = useCallback(
    (value: string) => {
      setActive((prev) => {
        if (!prev) return prev;
        const [head, ...rest] = prev.remaining;
        if (!head) return prev;
        const answers = { ...prev.answers, [head.question]: value };
        if (rest.length === 0) {
          void finish(prev.template, answers);
          return null;
        }
        return { ...prev, remaining: rest, answers };
      });
    },
    [finish],
  );

  const handleCancel = useCallback(() => {
    setActive(null);
  }, []);

  const modal = useMemo(
    () => (
      <PromptModal
        open={current !== null}
        title={current?.question ?? ""}
        defaultValue={current?.defaultValue ?? ""}
        placeholder={current?.defaultValue}
        confirmLabel="Suivant"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    ),
    [current, handleConfirm, handleCancel],
  );

  return { apply, isApplying, modal };
}
