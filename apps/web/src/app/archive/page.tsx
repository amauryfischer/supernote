"use client";

/**
 * /archive — flat dashboard of every archived note across the vault.
 *
 * Reads the same `entities.list` query everyone else uses (the tRPC cache
 * is shared, so this page is essentially free) and presents the archived
 * subset as a sortable list. Each row deep-links to /notes/:id so the user
 * can read the content without restoring it; a one-click "Désarchiver"
 * action puts the note back in the active set.
 */

import { Archive, ArrowUUpLeft, FileText, Folder as FolderIcon, MagnifyingGlass } from "@phosphor-icons/react";
import { Button, Input } from "@heroui/react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AppShell, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useNoteList, useArchiveNote } from "@/components/notes/hooks";
import { useDateFormat } from "@/lib/dateFormat";
import { useToast } from "@supernote/ui";

export default function ArchivePage() {
  const isMobile = useIsMobile();
  // `null` folderPath → fetch every note, then we pick the archived ones.
  // The recursive filter in useNoteList collapses to a no-op when null.
  const { notes, isLoading, isError, errorMessage } = useNoteList(null);
  const { setArchived, isPending } = useArchiveNote();
  const { full: formatFullDate } = useDateFormat();
  const { toast } = useToast();
  const [query, setQuery] = useState("");

  // For grouping we read `originalFolderPath` (set by useArchiveFolder when
  // archiving a whole folder). Single-note archives don't have it — we fall
  // back to the current folderPath, which for those is just where the note
  // already lived. The label "Archives diverses" is only used as a
  // last-resort bucket name.
  const groupKeyOf = (n: typeof notes[number]): string => {
    const orig = typeof n.fields?.["originalFolderPath"] === "string"
      ? (n.fields["originalFolderPath"] as string)
      : null;
    return orig ?? n.folderPath ?? "Archives diverses";
  };

  const archived = useMemo(() => {
    const list = notes.filter((n) => !!n.archivedAt);
    const q = query.toLowerCase().trim();
    const matched = q
      ? list.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.folderPath.toLowerCase().includes(q) ||
            groupKeyOf(n).toLowerCase().includes(q) ||
            n.tags.some((t) => t.toLowerCase().includes(q)),
        )
      : list;
    // Most-recently archived first — that's the order users want when
    // looking for "the thing I just put away".
    return [...matched].sort((a, b) => {
      const ta = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
      const tb = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
      return tb - ta;
    });
  // groupKeyOf depends only on its arg; React will re-derive correctly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, query]);

  // Group archived notes by their original folder so the page reads as
  // "these notes came from Travail/Projet-X" instead of one long flat list.
  // Groups are ordered by their most-recent archive date (so the freshest
  // batch appears at the top).
  const groups = useMemo(() => {
    const byKey = new Map<string, typeof archived>();
    for (const n of archived) {
      const key = groupKeyOf(n);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(n);
      else byKey.set(key, [n]);
    }
    return [...byKey.entries()]
      .map(([key, items]) => {
        const newest = items.reduce((acc, n) => {
          const t = n.archivedAt ? new Date(n.archivedAt).getTime() : 0;
          return t > acc ? t : acc;
        }, 0);
        return { key, items, newest };
      })
      .sort((a, b) => b.newest - a.newest);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archived]);

  const handleUnarchive = async (id: string) => {
    try {
      await setArchived(id, false);
      toast({ title: "Note désarchivée", variant: "success" });
    } catch {
      toast({ title: "Impossible de désarchiver la note", variant: "danger" });
    }
  };

  useMobileTitle(
    isMobile ? "Archive" : null,
    isMobile
      ? isLoading
        ? null
        : `${archived.length} note${archived.length !== 1 ? "s" : ""}`
      : null,
  );

  const handleUnarchiveGroup = async (ids: string[]) => {
    try {
      // Sequential — restoring N notes runs N file moves through the worker;
      // serialising them avoids an OPFS write storm and keeps the toast
      // count accurate even if a single move fails partway through.
      let ok = 0;
      for (const id of ids) {
        await setArchived(id, false);
        ok++;
      }
      toast({
        title: `${ok} note${ok !== 1 ? "s" : ""} désarchivée${ok !== 1 ? "s" : ""}`,
        variant: "success",
      });
    } catch {
      toast({ title: "Échec partiel du désarchivage", variant: "danger" });
    }
  };

  return (
    <AppShell>
      <div
        className="flex h-full flex-col"
        style={{ backgroundColor: "var(--surface-0)" }}
      >
        {/* Header — hidden on mobile (title via useMobileTitle, search inline below) */}
        <div
          className="hidden md:flex items-center justify-between gap-4 px-6 py-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ backgroundColor: "var(--surface-2)", color: "var(--text-secondary)" }}
            >
              <Archive size={18} />
            </div>
            <div>
              <h1
                className="text-base font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                Archive
              </h1>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {isLoading
                  ? "Chargement…"
                  : `${archived.length} note${archived.length !== 1 ? "s" : ""} archivée${archived.length !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>

          <div className="relative w-72 max-w-full">
            <MagnifyingGlass
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "var(--text-muted)" }}
            />
            <Input
              type="text"
              placeholder="Rechercher dans les archives…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-md py-1.5 pl-8 pr-3 text-xs outline-none"
              style={{
                backgroundColor: "var(--surface-1)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
              }}
            />
          </div>
        </div>

        {/* Mobile search bar — shown only on mobile */}
        <div
          className="md:hidden px-3 py-2"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="relative">
            <MagnifyingGlass
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "var(--text-muted)" }}
            />
            <Input
              type="text"
              placeholder="Rechercher dans les archives…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-md py-1.5 pl-8 pr-3 text-xs outline-none"
              style={{
                backgroundColor: "var(--surface-1)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
              }}
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3 md:p-6">
          {isError ? (
            <div className="mx-auto max-w-md text-center text-sm" style={{ color: "var(--text-muted)" }}>
              {errorMessage ?? "Impossible de charger les archives."}
            </div>
          ) : isLoading ? (
            <ArchiveSkeleton />
          ) : archived.length === 0 ? (
            <EmptyArchive hasQuery={query.length > 0} />
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
              {groups.map((group) => (
                <section key={group.key} className="flex flex-col gap-2">
                  <header className="flex items-center justify-between gap-2 px-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <FolderIcon size={13} style={{ color: "var(--text-muted)" }} />
                      <h2
                        className="sn-eyebrow sn-eyebrow--compact truncate"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {group.key}
                      </h2>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                        style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
                      >
                        {group.items.length}
                      </span>
                    </div>
                    {group.items.length > 1 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onPress={() => void handleUnarchiveGroup(group.items.map((n) => n.id))}
                        isDisabled={isPending}
                        className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium"
                        style={{
                          color: "var(--text-muted)",
                          borderColor: "var(--border-subtle)",
                        }}
                      >
                        <ArrowUUpLeft size={12} />
                        Tout désarchiver
                      </Button>
                    )}
                  </header>

                  <ul className="flex flex-col gap-1.5">
                    {group.items.map((note) => (
                      <li
                        key={note.id}
                        className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
                        style={{
                          backgroundColor: "var(--surface-1)",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        <FileText size={16} style={{ color: "var(--text-muted)" }} />

                        <Link
                          href={`/notes/${note.id}?folder=${encodeURIComponent(note.folderPath)}`}
                          className="flex min-w-0 flex-1 flex-col gap-0.5"
                        >
                          <span
                            className="truncate text-sm font-medium"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {note.title}
                          </span>
                          {note.tags.length > 0 && (
                            <span
                              className="flex items-center gap-1.5 truncate text-[11px]"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {note.tags.slice(0, 3).map((tag) => (
                                <span key={tag}>#{tag}</span>
                              ))}
                              {note.tags.length > 3 && <span>+{note.tags.length - 3}</span>}
                            </span>
                          )}
                        </Link>

                        <div
                          className="hidden shrink-0 text-[11px] tabular-nums sm:block"
                          style={{ color: "var(--text-muted)" }}
                          title={`Archivée le ${note.archivedAt ? formatFullDate(note.archivedAt) : "?"}`}
                        >
                          {note.archivedAt ? formatFullDate(note.archivedAt) : "—"}
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          onPress={() => void handleUnarchive(note.id)}
                          isDisabled={isPending}
                          aria-label="Désarchiver"
                          className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium"
                          style={{
                            color: "var(--text-secondary)",
                            borderColor: "var(--border-subtle)",
                          }}
                        >
                          <ArrowUUpLeft size={12} />
                          Désarchiver
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function ArchiveSkeleton() {
  return (
    <ul className="mx-auto flex w-full max-w-3xl flex-col gap-2">
      {[1, 2, 3, 4].map((i) => (
        <li
          key={i}
          className="flex animate-pulse items-center gap-3 rounded-lg px-3 py-3"
          style={{
            backgroundColor: "var(--surface-1)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div className="h-4 w-4 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-3.5 w-2/3 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
            <div className="h-3 w-1/2 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
          </div>
          <div className="h-7 w-24 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
        </li>
      ))}
    </ul>
  );
}

function EmptyArchive({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: "var(--surface-2)" }}
      >
        <Archive size={24} style={{ color: "var(--text-muted)" }} />
      </div>
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {hasQuery ? "Aucun résultat" : "Aucune note archivée"}
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {hasQuery
            ? "Essayez un autre mot-clé."
            : "Archivez une note depuis sa fiche ou son menu contextuel pour la retrouver ici."}
        </p>
      </div>
    </div>
  );
}
