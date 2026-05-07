"use client";

import Link from "next/link";
import type { Contact } from "./fixtures";
import { ORGANISATIONS } from "./fixtures";
import { ContactAvatar } from "./ContactAvatar";
import { RelationChip } from "./RelationChip";
import { isBirthdaySoon, relativeBirthday } from "./utils";

interface ContactGalleryProps {
  contacts: Contact[];
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  /** Optional map of orgId → org name for live tRPC data (overrides fixture lookup). */
  orgNames?: Map<string, string>;
}

export function ContactGallery({ contacts, selectedIds, onToggleSelect, orgNames }: ContactGalleryProps) {
  return (
    <div className="grid gap-4 p-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
      {contacts.map((contact) => {
        const orgName = contact.organisationId
          ? (orgNames?.get(contact.organisationId) ?? ORGANISATIONS.find((o) => o.id === contact.organisationId)?.name)
          : undefined;
        const soon = isBirthdaySoon(contact.birthday);
        const rel = relativeBirthday(contact.birthday);
        const selected = selectedIds.includes(contact.id);

        return (
          <div
            key={contact.id}
            className="relative flex flex-col items-center gap-2 rounded-xl border p-4 transition-shadow hover:shadow-md"
            style={{
              borderColor: selected ? "var(--accent)" : "var(--border-subtle)",
              backgroundColor: selected ? "var(--accent-subtle)" : "var(--surface-1)",
            }}
          >
            <button
              onClick={() => onToggleSelect(contact.id)}
              className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded"
              aria-label={selected ? "Désélectionner" : "Sélectionner"}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(contact.id)}
                className="cursor-pointer accent-[var(--accent)]"
              />
            </button>

            <Link href={`/contacts/${contact.id}`} className="flex flex-col items-center gap-2 text-center">
              <ContactAvatar name={contact.name} photoUrl={contact.photoUrl} size={64} />
              <div>
                <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                  {contact.name}
                </p>
                {orgName && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {orgName}
                  </p>
                )}
              </div>
            </Link>

            <RelationChip type={contact.relationType} />

            {rel && (
              <span
                className="text-xs"
                style={soon ? { color: "oklch(0.55 0.20 28)", fontWeight: 600 } : { color: "var(--text-muted)" }}
              >
                Anniv. {rel}
              </span>
            )}

            {contact.tags.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1">
                {contact.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag}
                    className="rounded px-1.5 py-0.5 text-xs"
                    style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {contacts.length === 0 && (
        <div className="col-span-full py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Aucun contact trouvé.
        </div>
      )}
    </div>
  );
}
