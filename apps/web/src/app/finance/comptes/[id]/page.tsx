"use client";

/**
 * Account detail/edit page — rewritten from scratch.
 *
 * Loads the entity once via tRPC `entities.get`, hydrates the form inputs
 * directly from the query result on first mount (no useEffect chain), and
 * persists changes via `entities.update` on blur. Avoids the previous render
 * loop / OOM crash by not driving useState off query data refs.
 */

import { ArrowLeft } from "@phosphor-icons/react";
import { Input } from "@heroui/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/shell";
import { Skeleton } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import { parseDecimal } from "@/components/finance/utils";

const KIND_OPTIONS = [
  { value: "checking", label: "Courant" },
  { value: "savings", label: "Épargne" },
  { value: "livret", label: "Livret" },
  { value: "pea", label: "PEA" },
  { value: "cto", label: "CTO" },
  { value: "assurance_vie", label: "Assurance-vie" },
  { value: "crypto", label: "Crypto" },
  { value: "other", label: "Autre" },
];

const fieldClass =
  "w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)]";
const fieldStyle: React.CSSProperties = {
  borderColor: "var(--border-subtle)",
  backgroundColor: "var(--surface-1)",
  color: "var(--text-primary)",
};

// Skeleton de formulaire au chargement — remplace le « Chargement… » texte.
function FormSkeleton() {
  return (
    <div className="mt-4 flex flex-col gap-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

export default function CompteDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const utils = trpc.useUtils();
  const query = trpc.entities.get.useQuery({ id }, { enabled: !!id });
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate({ typeId: "account" });
    },
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <Link
          href="/finance/comptes"
          className="mb-6 flex items-center gap-1.5 text-sm hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={14} /> Comptes
        </Link>

        {query.isLoading ? (
          <FormSkeleton />
        ) : query.isError || !query.data ? (
          <p className="text-sm" style={{ color: "var(--danger)" }}>Compte introuvable.</p>
        ) : (
          <AccountForm
            key={query.data.id}
            initialFields={query.data.fields as Record<string, unknown>}
            onPersist={(fields) =>
              updateMutation.mutate({ id: query.data!.id, fields })
            }
            isSaving={updateMutation.isPending}
            saveError={updateMutation.error?.message ?? null}
          />
        )}
      </div>
    </AppShell>
  );
}

interface AccountFormProps {
  initialFields: Record<string, unknown>;
  onPersist: (fields: Record<string, string | number>) => void;
  isSaving: boolean;
  saveError: string | null;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
      {children}
    </label>
  );
}

function AccountForm({ initialFields, onPersist, isSaving, saveError }: AccountFormProps) {
  // Seeded ONCE from server props. The parent uses `key={entityId}` to
  // remount this form if the entity id changes, so we never need to sync
  // back from the server after the initial mount.
  const [name, setName] = useState(String(initialFields["name"] ?? ""));
  const [kind, setKind] = useState(String(initialFields["kind"] ?? "checking"));
  const [balance, setBalance] = useState(
    String(Number(initialFields["current_balance"] ?? 0)),
  );
  const [institution, setInstitution] = useState(
    String(initialFields["institution"] ?? ""),
  );
  const [iban, setIban] = useState(String(initialFields["iban"] ?? ""));

  return (
    <div className="flex flex-col gap-4">
      <Input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => onPersist({ name })}
        placeholder="Nom du compte"
        className="mb-2 w-full bg-transparent text-2xl font-semibold outline-none"
        style={{ color: "var(--text-primary)" }}
      />

      <div>
        <FieldLabel>Type</FieldLabel>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            onPersist({ kind: e.target.value });
          }}
          className={fieldClass}
          style={fieldStyle}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <FieldLabel>Solde actuel (EUR)</FieldLabel>
        <Input
          type="text"
          inputMode="decimal"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          onBlur={() => onPersist({ current_balance: parseDecimal(balance) })}
          className={fieldClass}
          style={fieldStyle}
        />
      </div>

      <div>
        <FieldLabel>Institution</FieldLabel>
        <Input
          type="text"
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          onBlur={() => onPersist({ institution })}
          className={fieldClass}
          style={fieldStyle}
        />
      </div>

      <div>
        <FieldLabel>IBAN</FieldLabel>
        <Input
          type="text"
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          onBlur={() => onPersist({ iban })}
          placeholder="FR76…"
          className={fieldClass}
          style={fieldStyle}
        />
      </div>

      <SaveIndicator isPending={isSaving} errorMsg={saveError} />
    </div>
  );
}

function SaveIndicator({ isPending, errorMsg }: { isPending: boolean; errorMsg: string | null }) {
  if (isPending) {
    return <p className="text-xs" style={{ color: "var(--text-muted)" }}>Enregistrement…</p>;
  }
  if (errorMsg) {
    return <p className="text-xs" style={{ color: "var(--danger)" }}>Échec : {errorMsg}</p>;
  }
  return null;
}
