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
 * Images need the same treatment for a different reason: the headless editor
 * has no `resolveFileUrl`, so pasted images keep their vault-relative `src`
 * (`Projets/_attachments/img-….png`) — meaningless outside the owner's vault.
 * `enrichImages` resolves each one through the live editor's own file
 * adapter (the same `blob:` resolution used on-screen) and inlines it as a
 * `data:` URI so the public page is fully self-contained. The share CSP
 * (`img-src data: https: http:`, see `share-backend.mjs`) already expects this.
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

function isEmbeddableImageSrc(src: string): boolean {
  return /^(https?:|data:)/i.test(src);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function enrichImages(
  container: HTMLElement,
  resolveUrl: (path: string) => Promise<string>,
): Promise<void> {
  const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src || isEmbeddableImageSrc(src)) return;
      try {
        const blobUrl = await resolveUrl(src);
        if (!blobUrl.startsWith("blob:")) return; // introuvable dans le coffre — laissé tel quel
        const blob = await fetch(blobUrl).then((r) => r.blob());
        img.setAttribute("src", await blobToDataUrl(blob));
      } catch {
        // Laisse le chemin de coffre d'origine plutôt qu'un bloc cassé visible.
      }
    }),
  );
}

export async function exportNoteHtml(
  bodyMarkdown: string,
  resolveUrl: (path: string) => Promise<string>,
): Promise<string> {
  const container = document.createElement("div");
  container.innerHTML = markdownToHtmlLossy(bodyMarkdown);

  await Promise.all([enrichFormulas(container), enrichBases(container), enrichImages(container, resolveUrl)]);

  // Pas d'export image pour une scène Excalidraw aujourd'hui (packages/canvas
  // n'expose aucun exportToSvg/Blob) — limite assumée plutôt qu'un rendu bancal.
  container.querySelectorAll<HTMLElement>(".sn-doodle-export").forEach((node) => {
    node.textContent = "Canvas — non disponible dans le partage public";
  });

  return container.innerHTML;
}
