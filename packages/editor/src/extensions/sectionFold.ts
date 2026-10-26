// Replier une section sous un titre.
//
// Les notes sont plates (le markdown n'imbrique pas une section dans son
// titre) : le `isToggleable` natif de BlockNote, qui replie les ENFANTS d'un
// titre, ne s'applique donc pas. Une section = les blocs frères qui suivent un
// titre jusqu'au prochain titre de niveau ≤.
//
// ⚠️ Tout passe par des décorations ProseMirror (classe sur le nœud + widget du
// chevron) : jamais de mutation DOM externe dans le sous-arbre éditeur, que le
// MutationObserver de PM relirait (cf. patterns.md).
//
// État = ensemble de clés de titre `niveau|texte|n-ième` (les ids de bloc sont
// régénérés à chaque chargement du markdown). Renommer un titre replié le
// déplie. Persisté en localStorage si l'hôte donne une clé (`foldStorageKey`).

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

interface Section {
  key: string;
  level: number;
  folded: boolean;
  /** Début du blockContainer du titre. */
  start: number;
  /** Fin de l'étendue de la section (dernier frère couvert, repliée ou non). */
  scopeEnd: number;
  /** Fin du texte du titre : position du chevron et d'atterrissage du curseur. */
  textEnd: number;
  /** Nœuds masqués par cette section, [début, fin] chacun. */
  hidden: Array<[number, number]>;
  count: number;
}

interface FoldState {
  folded: ReadonlySet<string>;
  sections: Section[];
  decorations: DecorationSet;
}

interface FoldMeta {
  key: string;
  fold: boolean;
}

const pluginKey = new PluginKey<FoldState>("supernoteSectionFold");
const STORAGE_PREFIX = "sn-fold:";

function headingOf(node: PMNode): PMNode | null {
  const first = node.firstChild;
  return node.type.name === "blockContainer" && first?.type.name === "heading" ? first : null;
}

function countContainers(node: PMNode): number {
  let n = node.type.name === "blockContainer" ? 1 : 0;
  node.descendants((d) => {
    if (d.type.name === "blockContainer") n++;
  });
  return n;
}

function scan(doc: PMNode, folded: ReadonlySet<string>): Section[] {
  const sections: Section[] = [];
  const seen = new Map<string, number>();

  const walkGroup = (group: PMNode, groupStart: number) => {
    const open: Section[] = [];
    group.forEach((child, offset) => {
      const start = groupStart + offset;
      const end = start + child.nodeSize;
      const head = headingOf(child);
      const level = head ? Number(head.attrs.level) : 0;
      if (head) while (open.length && open[open.length - 1]!.level >= level) open.pop();

      const hider = open.find((s) => s.folded);
      if (hider) {
        hider.hidden.push([start, end]);
        hider.count += countContainers(child);
        for (const s of open) s.scopeEnd = end;
        return;
      }

      let section: Section | undefined;
      if (head) {
        const base = `${level}|${head.textContent}`;
        const nth = seen.get(base) ?? 0;
        seen.set(base, nth + 1);
        const key = `${base}|${nth}`;
        section = {
          key,
          level,
          folded: folded.has(key),
          start,
          scopeEnd: end,
          textEnd: start + 2 + head.content.size,
          hidden: [],
          count: 0,
        };
        sections.push(section);
        open.push(section);
      }
      for (const s of open) s.scopeEnd = end;

      const nested = child.childCount > 1 ? child.lastChild : null;
      if (nested?.type.name === "blockGroup") {
        const nestedStart = end - 1 - nested.nodeSize;
        if (section?.folded) {
          section.hidden.push([nestedStart, nestedStart + nested.nodeSize]);
          section.count += countContainers(nested);
        } else {
          walkGroup(nested, nestedStart + 1);
        }
      }
    });
  };

  const root = doc.firstChild;
  if (root) walkGroup(root, 1);
  return sections;
}

function persist(storageKey: string | undefined, folded: ReadonlySet<string>, sections: Section[]) {
  if (!storageKey) return;
  const present = new Set(sections.map((s) => s.key));
  try {
    const keys = [...folded].filter((k) => present.has(k));
    if (keys.length) localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(keys));
    else localStorage.removeItem(STORAGE_PREFIX + storageKey);
  } catch {
    /* stockage indisponible : le repli reste en mémoire */
  }
}

function load(storageKey: string | undefined): Set<string> {
  if (!storageKey) return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

function setFolded(view: EditorView, key: string, fold: boolean) {
  const meta: FoldMeta = { key, fold };
  view.dispatch(view.state.tr.setMeta(pluginKey, meta));
}

function createToggle(view: EditorView, section: Section): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.contentEditable = "false";
  btn.className = "sn-fold-toggle sn-reveal sn-hit";
  btn.setAttribute("aria-expanded", String(!section.folded));
  const n = section.count;
  btn.setAttribute(
    "aria-label",
    section.folded
      ? `Déplier la section (${n} ${n > 1 ? "blocs masqués" : "bloc masqué"})`
      : "Replier la section",
  );
  if (section.folded) btn.dataset.forceVisible = "true";

  const chevron = document.createElement("span");
  chevron.className = "sn-fold-toggle__chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "›";
  btn.append(chevron);
  if (section.folded) {
    const label = document.createElement("span");
    label.className = "sn-fold-toggle__count";
    label.textContent = `${n} ${n > 1 ? "blocs masqués" : "bloc masqué"}`;
    btn.append(label);
  }

  // Sans ça le clic déplace la sélection (et ferme le clavier tactile).
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    setFolded(view, section.key, !section.folded);
  });
  return btn;
}

function build(doc: PMNode, folded: ReadonlySet<string>): FoldState {
  const sections = scan(doc, folded);
  const decos: Decoration[] = [];
  for (const s of sections) {
    const container = doc.nodeAt(s.start);
    if (!container) continue;
    decos.push(
      Decoration.node(s.start, s.start + container.nodeSize, {
        class: `group sn-fold-head${s.folded ? " sn-folded" : ""}`,
      }),
    );
    // Pas de widget sur un titre vide : il casserait le placeholder BlockNote.
    if (s.textEnd > s.start + 2) {
      decos.push(
        Decoration.widget(s.textEnd, (view) => createToggle(view, s), {
          side: 1,
          key: `fold:${s.key}:${s.folded}:${s.count}`,
          stopEvent: () => true,
          ignoreSelection: true,
        }),
      );
    }
    for (const [from, to] of s.hidden) decos.push(Decoration.node(from, to, { class: "sn-fold-hidden" }));
  }
  return { folded, sections, decorations: DecorationSet.create(doc, decos) };
}

function createPlugin(getStorageKey: () => string | undefined): Plugin<FoldState> {
  return new Plugin<FoldState>({
    key: pluginKey,
    state: {
      init: (_config, state) => build(state.doc, load(getStorageKey())),
      apply(tr, prev, _old, newState) {
        const meta = tr.getMeta(pluginKey) as FoldMeta | undefined;
        if (!meta && !tr.docChanged) return prev;
        let folded = prev.folded;
        if (meta) {
          const next = new Set(folded);
          if (meta.fold) next.add(meta.key);
          else next.delete(meta.key);
          folded = next;
        }
        return build(newState.doc, folded);
      },
    },
    props: {
      decorations: (state) => pluginKey.getState(state)?.decorations,
    },
    // Le curseur ne doit jamais se retrouver dans un bloc invisible : il déplie la
    // section (navigation, undo, insertion programmatique) — sauf juste après un
    // repli, où l'on ramène le curseur sur le titre.
    appendTransaction(trs, _old, newState) {
      const st = pluginKey.getState(newState);
      if (!st || st.folded.size === 0) return null;
      const head = newState.selection.head;
      const section = st.sections.find((s) => s.folded && s.hidden.some(([a, b]) => head > a && head < b));
      if (!section) return null;
      const justFolded = trs.some((tr) => {
        const meta = tr.getMeta(pluginKey) as FoldMeta | undefined;
        return meta?.fold === true && meta.key === section.key;
      });
      if (justFolded) return newState.tr.setSelection(TextSelection.create(newState.doc, section.textEnd));
      const meta: FoldMeta = { key: section.key, fold: false };
      return newState.tr.setMeta(pluginKey, meta);
    },
    view: () => ({
      update(view, prevState) {
        const prev = pluginKey.getState(prevState);
        const next = pluginKey.getState(view.state);
        if (next && prev?.folded !== next.folded) persist(getStorageKey(), next.folded, next.sections);
      },
    }),
  });
}

/** Mod+Alt+F : replie / déplie la section qui contient le curseur. */
export function toggleSectionAtCursor(view: EditorView): boolean {
  const st = pluginKey.getState(view.state);
  if (!st) return false;
  const head = view.state.selection.head;
  const section = st.sections.filter((s) => s.start <= head && head < s.scopeEnd).pop();
  if (!section) return false;
  setFolded(view, section.key, !section.folded);
  return true;
}

export function createSectionFoldExtension(getStorageKey: () => string | undefined): Extension {
  return Extension.create({
    name: "supernoteSectionFold",
    addProseMirrorPlugins() {
      return [createPlugin(getStorageKey)];
    },
  });
}
