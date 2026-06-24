import { useCallback } from "react";
import { trpc } from "@/lib/trpc/client";
import { noteFilePath } from "@/components/notes/adapters";
import { emailToMarkdown } from "@/lib/mail-capture";
import type { EmailMessage } from "@/lib/gmail";
import type { FieldValue } from "@supernote/ipc";

/**
 * Capture un email en entité. captureToNote crée une note (Inbox) ;
 * captureToBase crée une ligne dans une base existante (fields keyés par name).
 * Réutilise trpc.entities.create (worker).
 */
export function useCaptureEmail() {
  const utils = trpc.useUtils();
  const create = trpc.entities.create.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate();
      void utils.vault.folders.list.invalidate();
    },
  });

  const captureToNote = useCallback(
    async (msg: EmailMessage): Promise<string> => {
      const title = msg.subject || "Email sans sujet";
      const filePath = noteFilePath("Inbox", title);
      const entity = await create.mutateAsync({
        typeId: "note",
        fields: { title, filePath },
        body: emailToMarkdown(msg),
        tags: [],
      });
      return entity.id;
    },
    [create],
  );

  const captureToBase = useCallback(
    async (typeId: string, fields: Record<string, FieldValue>): Promise<string> => {
      const entity = await create.mutateAsync({ typeId, fields, body: "" });
      return entity.id;
    },
    [create],
  );

  return { captureToNote, captureToBase };
}
