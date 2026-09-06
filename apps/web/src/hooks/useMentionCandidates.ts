"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import type { EntityRef } from "@supernote/ai";

export const PERSON_TYPE_ID = "personne";
const ORGANISATION_TYPE_ID = "organisation";
const CANDIDATE_LIMIT = 500;

/**
 * Entrée EXACTE de la requête des personnes. Partagée avec le créateur de
 * contact du journal : un `invalidate` dont l'entrée dérive viserait une autre
 * clé de cache et resterait muet, sans erreur de type.
 */
export const PERSON_CANDIDATES_INPUT = {
  typeId: PERSON_TYPE_ID,
  limit: CANDIDATE_LIMIT,
};

function fieldToName(fields: Record<string, unknown>): string {
  const raw = fields["name"];
  return typeof raw === "string" ? raw : "";
}

function fieldToAliases(fields: Record<string, unknown>): string[] {
  const raw = fields["aliases"];
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Contacts (personne + organisation) existants du vault, formatés pour
 * `extractEntityMentions` de `@supernote/ai`. Ne couvre QUE les entités déjà
 * connues : un nom absent du coffre ne peut pas être « lié ». C'est
 * `findNewPersonCandidates` qui propose alors de le CRÉER, et cette liste lui
 * sert justement de filtre anti-doublon.
 *
 * `listSummaries` plutôt que `list` : on ne lit que `fields.name`/`aliases`,
 * inutile de rapatrier les corps de notes complets (suspect n°1 d'un freeze
 * déjà diagnostiqué sur ce repo).
 */
export function useMentionCandidates(): EntityRef[] {
  const personnes = trpc.entities.listSummaries.useQuery(PERSON_CANDIDATES_INPUT, {
    staleTime: 30_000,
    retry: false,
  });
  const organisations = trpc.entities.listSummaries.useQuery(
    { typeId: ORGANISATION_TYPE_ID, limit: CANDIDATE_LIMIT },
    { staleTime: 30_000, retry: false },
  );

  return useMemo(() => {
    const items = [...(personnes.data?.items ?? []), ...(organisations.data?.items ?? [])];
    const refs: EntityRef[] = [];
    for (const item of items) {
      const name = fieldToName(item.fields);
      if (!name) continue;
      refs.push({
        id: item.id,
        name,
        aliases: fieldToAliases(item.fields),
        typeId: item.typeId,
      });
    }
    return refs;
  }, [personnes.data, organisations.data]);
}
