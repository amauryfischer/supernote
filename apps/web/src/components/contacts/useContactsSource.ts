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
import { entitiesToContacts } from "./entityAdapter";
import type { Contact } from "./fixtures";

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

/** Hook: returns contacts from tRPC when in Electron, fixtures otherwise. */
export function useContactsSource(): ContactsSource {
  const isElectron = useIsElectron();

  const { data, isLoading } = trpc.entities.list.useQuery(
    { typeId: "personne", limit: 500 },
    {
      enabled: isElectron,
      retry: false,
    },
  );

  const contacts = useMemo<Contact[]>(() => {
    if (!isElectron) return CONTACTS;
    if (data?.items && data.items.length > 0) return entitiesToContacts(data.items);
    return CONTACTS;
  }, [isElectron, data]);

  return {
    contacts,
    mode: isElectron ? "live" : "fallback",
    isLoading: isElectron && isLoading,
  };
}
