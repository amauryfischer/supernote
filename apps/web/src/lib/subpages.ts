export function parentIdOf(fields: Record<string, unknown> | undefined): string | null {
  const id = fields?.["parentId"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

interface NestableNote {
  id: string;
  title: string;
  folderPath: string;
  fields?: Record<string, unknown>;
}

const isArchived = (n: NestableNote) => {
  const at = n.fields?.["archivedAt"];
  return typeof at === "string" && at.length > 0;
};

/**
 * Sépare les notes en premier niveau et enfants. Une note est enfant seulement si sa parente est
 * présente, dans le même dossier, non archivée, et si remonter la chaîne ne boucle pas sur elle
 * (un cycle écrit par la synchro laisse tous ses membres au premier niveau). Ordre d'entrée conservé.
 */
export function nestSubpages<T extends NestableNote>(notes: readonly T[]): { topLevel: T[]; childrenOf: Map<string, T[]> } {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const loops = (note: T): boolean => {
    const seen = new Set<string>();
    for (let id = parentIdOf(note.fields); id && !seen.has(id); id = parentIdOf(byId.get(id)?.fields)) {
      if (id === note.id) return true;
      seen.add(id);
    }
    return false;
  };

  const topLevel: T[] = [];
  const childrenOf = new Map<string, T[]>();
  for (const note of notes) {
    const pid = parentIdOf(note.fields);
    const parent = pid ? byId.get(pid) : undefined;
    if (!pid || !parent || parent.folderPath !== note.folderPath || isArchived(parent) || loops(note)) {
      topLevel.push(note);
      continue;
    }
    const siblings = childrenOf.get(pid);
    if (siblings) siblings.push(note);
    else childrenOf.set(pid, [note]);
  }
  return { topLevel, childrenOf };
}
