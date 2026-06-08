"use client";

/**
 * useContactsSource — resolves the canonical contacts list.
 *
 * In PWA mode (FSA-capable browser): queries tRPC (vault Web Worker) and
 * adapts entities. Otherwise: skips tRPC and returns localStore + fixtures.
 *
 * The tRPC query is only fired when the worker is available, which avoids
 * the race where observer.error() fires synchronously before React Query
 * has initialised — leaving isError:false but data:undefined.
 */

import { useMemo } from "react";
import { trpc, hasWorkerBackend } from "@/lib/trpc/client";
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

function useHasBackend(): boolean {
  return hasWorkerBackend();
}

/** Hook: returns contacts from tRPC (vault worker) when available, fixtures + local otherwise. */
export function useContactsSource(): ContactsSource {
  const hasBackend = useHasBackend();
  const localEntities = useLocalEntities("personne");

  const { data, isLoading } = trpc.entities.list.useQuery(
    { typeId: "personne", limit: 500 },
    {
      enabled: hasBackend,
      retry: false,
    },
  );

  const contacts = useMemo<Contact[]>(() => {
    if (!hasBackend) {
      // In degraded mode: only local (user-created) entities + empty fixture (CONTACTS=[])
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
      const deduped = CONTACTS.filter((c) => !localIds.has(c.id)); // CONTACTS is [] by default
      return [...deduped, ...localContacts];
    }
    if (data?.items && data.items.length > 0) return entitiesToContacts(data.items);
    return CONTACTS; // [] by default
  }, [hasBackend, data, localEntities]);

  return {
    contacts,
    mode: hasBackend ? "live" : "fallback",
    isLoading: hasBackend && isLoading,
  };
}
