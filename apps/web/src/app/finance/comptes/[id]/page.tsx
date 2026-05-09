"use client";

/**
 * Account detail/edit page — mirrors /projets/[id] but for finance accounts.
 * Fields persist on blur via entities.update; the worker merges fields with
 * existing so partial updates are safe.
 */

import { AppShell } from "@/components/shell";
import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { flushVaultWorker } from "@/lib/trpc/browser-link";
import { parseDecimal } from "@/components/finance/utils";

const KIND_OPTIONS = [
  { value: "checking", label: "Courant" },
  { value: "savings", label: "Épargne" },
  { value: "pea", label: "PEA" },
  { value: "crypto", label: "Crypto" },
];

const inputClass =
  "w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)]";
const inputStyle: React.CSSProperties = {
  borderColor: "var(--border-subtle)",
  backgroundColor: "var(--surface-1)",
  color: "var(--text-primary)",
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
      {children}
    </label>
  );
}

export default function CompteDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const query = trpc.entities.get.useQuery({ id }, { enabled: !!id });
  const utils = trpc.useUtils();
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate({ typeId: "account" });
    },
  });

  const [name, setName] = useState("");
  const [kind, setKind] = useState("checking");
  const [balance, setBalance] = useState("0");
  const [iban, setIban] = useState("");

  // Track last-persisted scalar value per field so onBlur is a no-op when the
  // user only focused/blurred without changing anything. Saves a roundtrip and
  // avoids re-emitting invalidations that briefly toggle the "Enregistrement…"
  // indicator on every focus shift. Keys are field names, values are the
  // string/number that was last successfully sent (or hydrated from server).
  const lastPersistedRef = useRef<Record<string, unknown>>({});

  // Hydrate local state from server only on the first successful load (or
  // when the entity id changes). Without this guard, every mutation success
  // re-fires invalidation → refetch → effect, which can clobber a value the
  // user is actively typing — surfacing as "the amount won't change". After
  // hydration, server state and local state stay in sync via onBlur persists.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!query.data) return;
    if (hydratedFor.current === query.data.id) return;
    hydratedFor.current = query.data.id;
    const f = query.data.fields as Record<string, unknown>;
    const initialName = String(f["name"] ?? "");
    const initialKind = String(f["kind"] ?? "checking");
    const initialBalance = Number(f["current_balance"] ?? 0);
    const initialIban = String(f["iban"] ?? "");
    setName(initialName);
    setKind(initialKind);
    setBalance(String(initialBalance));
    setIban(initialIban);
    lastPersistedRef.current = {
      name: initialName,
      kind: initialKind,
      current_balance: initialBalance,
      iban: initialIban,
    };
  }, [query.data]);

  // Warn the user if they try to reload while a mutation is still flying.
  // The worker awaits schedulePersist BEFORE replying ok:true, so a successful
  // mutation is already on disk — but if the user reloads in the brief window
  // between blur (mutate sent) and ok response, beforeunload's flushVaultWorker
  // covers the worker side; the browser's native confirm covers the network
  // side (FSA writes can take a few ms, beforeunload aborts the page hide).
  useEffect(() => {
    if (!updateMutation.isPending) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the message but require returnValue to be set
      // for the prompt to appear. The exact string is not displayed.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [updateMutation.isPending]);

  function persist(patch: Record<string, string | number | boolean | string[] | null>) {
    if (!query.data) return;
    // Skip mutation if no field actually changed since last persist/hydrate.
    // This avoids a roundtrip on every blur even when the user only tabbed
    // through the form. We compare against `lastPersistedRef`, which is
    // seeded from the server payload at hydration time and updated after
    // every successful mutate.
    const changed: Record<string, string | number | boolean | string[] | null> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (lastPersistedRef.current[k] !== v) changed[k] = v;
    }
    if (Object.keys(changed).length === 0) return;

    console.info("[finance/comptes] persist", query.data.id, changed);
    // mutateAsync so we can wait + flush the worker afterwards (defensive:
    // the worker already persists before replying, but this gives us a hook
    // to update lastPersistedRef only on confirmed success).
    updateMutation.mutate(
      { id: query.data.id, fields: changed },
      {
        onSuccess: () => {
          for (const [k, v] of Object.entries(changed)) {
            lastPersistedRef.current[k] = v;
          }
          // Belt-and-suspenders flush: ensures the FSA writable stream has
          // closed even if the worker's pre-reply persist somehow raced.
          void flushVaultWorker();
        },
        onError: (err) => {
          console.error("[finance/comptes] persist failed", err);
        },
      },
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Link
          href="/finance/comptes"
          className="mb-6 flex items-center gap-1.5 text-sm transition-colors hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={14} /> Comptes
        </Link>

        {query.isLoading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement...</p>
        ) : query.isError || !query.data ? (
          <p className="text-sm" style={{ color: "var(--danger)" }}>Compte introuvable.</p>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => persist({ name })}
              placeholder="Nom du compte"
              className="mb-6 w-full bg-transparent text-2xl font-semibold outline-none"
              style={{ color: "var(--text-primary)" }}
            />

            <div className="flex flex-col gap-4">
              <div>
                <FieldLabel>Type</FieldLabel>
                <select
                  value={kind}
                  onChange={(e) => { setKind(e.target.value); persist({ kind: e.target.value }); }}
                  className={inputClass}
                  style={inputStyle}
                >
                  {KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <FieldLabel>Solde actuel (EUR)</FieldLabel>
                <input
                  type="text"
                  inputMode="decimal"
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                  onBlur={() => persist({ current_balance: parseDecimal(balance) })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>IBAN</FieldLabel>
                <input
                  type="text"
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  onBlur={() => persist({ iban })}
                  placeholder="FR76…"
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            </div>

            <SaveIndicator
              isPending={updateMutation.isPending}
              isError={updateMutation.isError}
              isSuccess={updateMutation.isSuccess}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

function SaveIndicator(props: { isPending: boolean; isError: boolean; isSuccess: boolean }) {
  if (props.isPending) {
    return <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>Enregistrement…</p>;
  }
  if (props.isError) {
    return <p className="mt-4 text-xs" style={{ color: "var(--danger)" }}>Échec de l'enregistrement</p>;
  }
  if (props.isSuccess) {
    return <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>Enregistré</p>;
  }
  return null;
}
