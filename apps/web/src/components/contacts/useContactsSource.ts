"use client";

/**
 * useContactsSource — resolves the canonical contacts list.
 *
 * In Electron (window.__supernoteIPC defined): queries tRPC and adapts entities.
 * In browser / mode dégradé: skips tRPC entirely and returns fixture data.
 *
 * The tRPC query is only fired when IPC is available, which avoids the race
 * condition where observer.error() fires synchronously before React Query has
 * fully initialised the query state — leaving isError: false but data: undefined.
 */

import { useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import { CONTACTS } from "./fixtures";
import { entitiesToContacts, entityToContact } from "./entityAdapter";
import type { Contact } from "./fixtures";
import { useLocalEntities } from "@/lib/local-store";
import type { FieldValue } from "@supernote/ipc";

export type ContactsSourceMode = "live" | "fallback";

export interface ContactsSource {
  contacts: Contact[];
  mode: ContactsSourceMode;
  isLoading: boolean;
}

function useIsElectron(): boolean {
  if (typeof window === "undefined") return false;
  return typeof window.__supernoteIPC !== "undefined";
}

/** Hook: returns contacts from tRPC when in Electron, fixtures + local otherwise. */
export function useContactsSource(): ContactsSource {
  const isElectron = useIsElectron();
  const localEntities = useLocalEntities("personne");

  const { data, isLoading } = trpc.entities.list.useQuery(
    { typeId: "personne", limit: 500 },
    {
      enabled: isElectron,
      retry: false,
    },
  );

  const contacts = useMemo<Contact[]>(() => {
    if (!isElectron) {
      const localContacts = localEntities.map((e) =>
        entityToContact({
          id: e.id,
          typeId: e.typeId,
          typeName: String(e.fields["name"] ?? ""),
          fields: e.fields as Record<string, FieldValue>,
          tags: e.tags ?? [],
          body: e.body ?? "",
          filePath: "",
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
        }),
      );
      const localIds = new Set(localContacts.map((c) => c.id));
      const deduped = CONTACTS.filter((c) => !localIds.has(c.id));
      return [...deduped, ...localContacts];
    }
    if (data?.items && data.items.length > 0) return entitiesToContacts(data.items);
    return CONTACTS;
  }, [isElectron, data, localEntities]);

  return {
    contacts,
    mode: isElectron ? "live" : "fallback",
    isLoading: isElectron && isLoading,
  };
}
