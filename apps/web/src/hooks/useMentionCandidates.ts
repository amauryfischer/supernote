"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import type { EntityRef } from "@supernote/ai";

const CANDIDATE_LIMIT = 500;

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
 * connues — l'extracteur ne propose pas de créer une entité inconnue
 * (limite documentée dans la spec).
 *
 * `listSummaries` plutôt que `list` : on ne lit que `fields.name`/`aliases`,
 * inutile de rapatrier les corps de notes complets (suspect n°1 d'un freeze
 * déjà diagnostiqué sur ce repo).
 */
export function useMentionCandidates(): EntityRef[] {
  const personnes = trpc.entities.listSummaries.useQuery(
    { typeId: "personne", limit: CANDIDATE_LIMIT },
    { staleTime: 30_000 },
  );
  const organisations = trpc.entities.listSummaries.useQuery(
    { typeId: "organisation", limit: CANDIDATE_LIMIT },
    { staleTime: 30_000 },
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
