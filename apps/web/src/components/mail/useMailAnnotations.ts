import { useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import { MAIL_ANNOTATIONS_EVENT, MAIL_ANNOTATION_TYPE_ID, fromEntity, type MailAnnotation } from "@/lib/mail-annotations";

/**
 * Repères perso du compte, par fil. L'identité de la Map ne change qu'avec son contenu
 * (partage structurel de react-query) : elle passe aux lignes mémoïsées de la liste.
 */
export function useMailAnnotations(accountId: string): ReadonlyMap<string, MailAnnotation> {
  // Les écritures d'un autre appareil n'invalident pas les requêtes : le poll local est gratuit (worker).
  const query = trpc.entities.list.useQuery(
    { typeId: MAIL_ANNOTATION_TYPE_ID, limit: 5000 },
    { refetchInterval: 60_000 },
  );
  const { refetch } = query;
  useEffect(() => {
    const on = () => void refetch();
    window.addEventListener(MAIL_ANNOTATIONS_EVENT, on);
    return () => window.removeEventListener(MAIL_ANNOTATIONS_EVENT, on);
  }, [refetch]);

  return useMemo(() => {
    const map = new Map<string, MailAnnotation>();
    for (const e of query.data?.items ?? []) {
      const a = fromEntity(e);
      if (a && a.accountId === accountId && (a.title || a.note || a.highlights.length)) map.set(a.threadId, a);
    }
    return map;
  }, [query.data, accountId]);
}
