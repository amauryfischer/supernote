"use client";

import { useCallback, useState } from "react";
import {
  loadTemplates,
  saveTemplates,
  upsertTemplate,
  removeTemplate,
  type MailTemplate,
} from "@/lib/mail-templates";

/**
 * État + persistance des modèles d'email. Hydrate depuis localStorage au montage
 * (initializer paresseux) et persiste à chaque mutation — même pattern que
 * `SettingsContext`. La logique CRUD reste pure (`@/lib/mail-templates`).
 */
export function useMailTemplates() {
  const [templates, setTemplates] = useState<MailTemplate[]>(loadTemplates);

  const persist = useCallback((next: MailTemplate[]) => {
    setTemplates(next);
    saveTemplates(next);
  }, []);

  const upsert = useCallback(
    (t: MailTemplate) => persist(upsertTemplate(templates, t)),
    [templates, persist],
  );

  const remove = useCallback(
    (id: string) => persist(removeTemplate(templates, id)),
    [templates, persist],
  );

  return { templates, upsert, remove };
}
