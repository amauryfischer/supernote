/**
 * Renders a note to standalone HTML for public sharing.
 *
 * `markdownToHtmlLossy` (headless BlockNote, same schema as the live editor)
 * gets the text/structure right for free — every custom block's own
 * `toExternalHTML` already runs. But formula and inline-database blocks emit
 * ROUND-TRIP placeholders there (`{= expr}`, "Database view (base=…)") meant
 * for re-parsing back into a block, not for a reader. This module enriches
 * those two in place with live data (current formula value, an actual table
 * of the base's visible rows/columns) so a public share reads as the note
 * actually looks — see `docs` note in `ShareNotePanel.tsx` for the one block
 * that stays a placeholder (canvas: no static-image export exists yet).
 *
 * The server re-sanitizes with DOMPurify before ever storing or serving this
 * — see `share-backend.mjs` — so this pass optimizes for fidelity, not for
 * being the last line of defense.
 */

import { markdownToHtmlLossy } from "@supernote/editor";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { formatJsonValue } from "@/components/notes/NoteFormulaBridge";
import { resolveVisibleFieldIds } from "@/components/bases/hooks";

// Shape minimale utilisée ici — le worker renvoie du JSON IPC brut (`field.type`,
// pas le `Field`/`EntityType` discriminé de @supernote/core), et cet export ne
// lit que id/name par champ, donc pas besoin du type complet.
interface FieldLike {
  id: string;
  name: string;
}
interface BaseLike {
  fields: FieldLike[];
}
interface ViewLike {
  id: string;
  isSystem?: boolean;
  visibleFields: string[];
  hiddenFields: string[];
  filters?: { fieldId: string; op: string; value?: unknown }[];
  sorts?: { fieldId: string; direction: "asc" | "desc" }[];
}

async function enrichFormulas(container: HTMLElement): Promise<void> {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(".sn-formula-block-export"));
  await Promise.all(
    nodes.map(async (node) => {
      const expression = node.dataset.formula ?? "";
      const span = document.createElement("span");
      span.className = "sn-share-formula-value";
      if (!expression.trim()) {
        span.textContent = "—";
        node.replaceWith(span);
        return;
      }
      try {
        const result = (await trpcVanillaClient.formulas.evaluate.query({ expression })) as {
          value: string | null;
          error: string | null;
        };
        span.textContent = result.error
          ? "#ERREUR"
          : formatJsonValue(result.value, node.dataset.outputKind);
      } catch {
        span.textContent = "#ERREUR";
      }
      node.replaceWith(span);
    }),
  );
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "✓" : "";
  if (Array.isArray(value)) return value.map(formatCellValue).join(", ");
  if (typeof value === "number") return value.toLocaleString("fr-FR");
  return String(value);
}

async function renderBaseTable(baseId: string, viewId: string | undefined): Promise<HTMLElement> {
  const [base, views] = await Promise.all([
    trpcVanillaClient.schemas.get.query({ id: baseId }) as Promise<BaseLike>,
    trpcVanillaClient.views.list.query({ typeId: baseId }) as Promise<ViewLike[]>,
  ]);
  const view =
    (viewId ? views.find((v) => v.id === viewId) : undefined) ??
    views.find((v) => v.isSystem) ??
    views[0];

  const allFieldIds = base.fields.map((f) => f.id);
  const fieldIds = view ? resolveVisibleFieldIds(view, allFieldIds) : allFieldIds;
  const fields = fieldIds
    .map((id) => base.fields.find((f) => f.id === id))
    .filter((f): f is FieldLike => !!f);

  const { items } = (await trpcVanillaClient.views.queryForView.query({
    typeId: baseId,
    filters: (view?.filters ?? []) as never,
    sorts: (view?.sorts ?? []) as never,
    limit: 500,
  })) as { items: Array<{ fields: Record<string, unknown> }> };

  const table = document.createElement("table");
  table.className = "sn-share-base-table";
  const headRow = table.createTHead().insertRow();
  for (const f of fields) {
    const th = document.createElement("th");
    th.textContent = f.name;
    headRow.appendChild(th);
  }
  const tbody = table.createTBody();
  for (const entity of items) {
    const tr = tbody.insertRow();
    for (const f of fields) {
      tr.insertCell().textContent = formatCellValue(entity.fields[f.id]);
    }
  }
  return table;
}

async function enrichBases(container: HTMLElement): Promise<void> {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(".sn-database-block-export"));
  await Promise.all(
    nodes.map(async (node) => {
      const baseId = node.dataset.baseId ?? "";
      if (!baseId) return;
      try {
        node.replaceWith(await renderBaseTable(baseId, node.dataset.viewId || undefined));
      } catch {
        node.textContent = "Base — indisponible dans le partage public";
      }
    }),
  );
}

export async function exportNoteHtml(bodyMarkdown: string): Promise<string> {
  const container = document.createElement("div");
  container.innerHTML = markdownToHtmlLossy(bodyMarkdown);

  await Promise.all([enrichFormulas(container), enrichBases(container)]);

  // Pas d'export image pour une scène Excalidraw aujourd'hui (packages/canvas
  // n'expose aucun exportToSvg/Blob) — limite assumée plutôt qu'un rendu bancal.
  container.querySelectorAll<HTMLElement>(".sn-doodle-export").forEach((node) => {
    node.textContent = "Canvas — non disponible dans le partage public";
  });

  return container.innerHTML;
}
