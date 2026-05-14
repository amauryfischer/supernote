"use client";

/**
 * FormulaInputEditor — éditeur de formule avec coloration syntaxique
 * et autocomplétion contextuelle.
 *
 * Architecture :
 *  - Tokenizer interne (regex) → liste de tokens typés
 *  - Overlay coloré rendu derrière un <textarea> transparent
 *  - Détection contextuelle au curseur : après `.` on propose les
 *    propriétés valides pour le type de la LHS (champ de base, agrégat
 *    de liste, propriété de ligne…).
 *  - Parse final via @supernote/formulas pour valider avant submit.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "@phosphor-icons/react";
import type { EntityType, Field } from "@supernote/core";
import { parseFormula, inferFormulaOutputKind } from "@supernote/formulas";
import { trpc } from "@/lib/trpc/client";
import { ipcEntityTypeToCore } from "@/components/schemas/adapters";

// ── Catalogue stdlib ─────────────────────────────────────────────────────────

interface FnSpec {
  name: string;
  sig: string;
  /** Catégorie pour l'aide. */
  group: "text" | "math" | "date" | "logic" | "list" | "entity";
}

const FUNCTIONS: FnSpec[] = [
  // Texte
  { name: "Concatenate", sig: "Concatenate(a, b, …)", group: "text" },
  { name: "Concat", sig: "Concat(a, b, …)", group: "text" },
  { name: "Format", sig: "Format(tpl, …) | Format(date, fmt)", group: "text" },
  { name: "Upper", sig: "Upper(s)", group: "text" },
  { name: "Lower", sig: "Lower(s)", group: "text" },
  { name: "Proper", sig: "Proper(s)", group: "text" },
  { name: "Trim", sig: "Trim(s)", group: "text" },
  { name: "Left", sig: "Left(s, n)", group: "text" },
  { name: "Right", sig: "Right(s, n)", group: "text" },
  { name: "Middle", sig: "Middle(s, start, len)", group: "text" },
  { name: "Substring", sig: "Substring(s, start, end?)", group: "text" },
  { name: "Find", sig: "Find(haystack, needle)", group: "text" },
  { name: "Replace", sig: "Replace(s, from, to)", group: "text" },
  { name: "Split", sig: "Split(s, sep)", group: "text" },
  { name: "Contains", sig: "Contains(s | list, x)", group: "text" },
  { name: "StartsWith", sig: "StartsWith(s, prefix)", group: "text" },
  { name: "EndsWith", sig: "EndsWith(s, suffix)", group: "text" },
  { name: "RegexMatch", sig: "RegexMatch(s, pattern)", group: "text" },
  { name: "Slugify", sig: "Slugify(s)", group: "text" },
  { name: "RepeatString", sig: "RepeatString(s, n)", group: "text" },
  { name: "Length", sig: "Length(s | list)", group: "text" },
  { name: "Len", sig: "Len(s | list)", group: "text" },
  { name: "ToText", sig: "ToText(v)", group: "text" },
  { name: "ToNumber", sig: "ToNumber(v)", group: "text" },
  // Maths
  { name: "Sum", sig: "Sum(list | …nums)", group: "math" },
  { name: "Average", sig: "Average(list | …nums)", group: "math" },
  { name: "Avg", sig: "Avg(list | …nums)", group: "math" },
  { name: "Median", sig: "Median(list)", group: "math" },
  { name: "Product", sig: "Product(list | …nums)", group: "math" },
  { name: "Min", sig: "Min(list | …nums)", group: "math" },
  { name: "Max", sig: "Max(list | …nums)", group: "math" },
  { name: "Count", sig: "Count(list)", group: "math" },
  { name: "CountIf", sig: "CountIf(list, predicate)", group: "math" },
  { name: "Abs", sig: "Abs(n)", group: "math" },
  { name: "Round", sig: "Round(n, decimals?)", group: "math" },
  { name: "RoundUp", sig: "RoundUp(n, decimals?)", group: "math" },
  { name: "RoundDown", sig: "RoundDown(n, decimals?)", group: "math" },
  { name: "Ceil", sig: "Ceil(n)", group: "math" },
  { name: "Floor", sig: "Floor(n)", group: "math" },
  { name: "Int", sig: "Int(n)", group: "math" },
  { name: "Sign", sig: "Sign(n)", group: "math" },
  { name: "Pow", sig: "Pow(base, exp)", group: "math" },
  { name: "Sqrt", sig: "Sqrt(n)", group: "math" },
  { name: "Mod", sig: "Mod(a, b)", group: "math" },
  { name: "Log", sig: "Log(n, base?)", group: "math" },
  { name: "Ln", sig: "Ln(n)", group: "math" },
  { name: "Exp", sig: "Exp(n)", group: "math" },
  { name: "Sin", sig: "Sin(n)", group: "math" },
  { name: "Cos", sig: "Cos(n)", group: "math" },
  { name: "Tan", sig: "Tan(n)", group: "math" },
  { name: "Random", sig: "Random()", group: "math" },
  { name: "RandomBetween", sig: "RandomBetween(lo, hi)", group: "math" },
  { name: "Sequence", sig: "Sequence(start, end, step?)", group: "math" },
  { name: "PI", sig: "PI()", group: "math" },
  { name: "E", sig: "E()", group: "math" },
  // Dates
  { name: "Now", sig: "Now()", group: "date" },
  { name: "Today", sig: "Today()", group: "date" },
  { name: "Date", sig: "Date(year, month, day)", group: "date" },
  { name: "Time", sig: "Time(h, m, s)", group: "date" },
  { name: "DateAdd", sig: "DateAdd(date, n, unit)", group: "date" },
  { name: "DateDiff", sig: "DateDiff(a, b, unit)", group: "date" },
  { name: "Year", sig: "Year(date)", group: "date" },
  { name: "Month", sig: "Month(date)", group: "date" },
  { name: "Day", sig: "Day(date)", group: "date" },
  { name: "Hour", sig: "Hour(date)", group: "date" },
  { name: "Minute", sig: "Minute(date)", group: "date" },
  { name: "Second", sig: "Second(date)", group: "date" },
  { name: "Weekday", sig: "Weekday(date)", group: "date" },
  { name: "WeekdayName", sig: "WeekdayName(date)", group: "date" },
  { name: "MonthName", sig: "MonthName(date)", group: "date" },
  { name: "WeekOfYear", sig: "WeekOfYear(date)", group: "date" },
  { name: "Quarter", sig: "Quarter(date)", group: "date" },
  { name: "ParseDate", sig: "ParseDate(s)", group: "date" },
  // Logique
  { name: "If", sig: "If(cond, then, else)", group: "logic" },
  { name: "IfElse", sig: "IfElse(c1, v1, …, default)", group: "logic" },
  { name: "IfBlank", sig: "IfBlank(value, fallback)", group: "logic" },
  { name: "Switch", sig: "Switch(value, c1, v1, …, default)", group: "logic" },
  { name: "SwitchIf", sig: "SwitchIf(c1, v1, …, default)", group: "logic" },
  { name: "And", sig: "And(a, b, …)", group: "logic" },
  { name: "Or", sig: "Or(a, b, …)", group: "logic" },
  { name: "Not", sig: "Not(b)", group: "logic" },
  { name: "IsBlank", sig: "IsBlank(v)", group: "logic" },
  { name: "IsNotBlank", sig: "IsNotBlank(v)", group: "logic" },
  { name: "IsNumber", sig: "IsNumber(v)", group: "logic" },
  { name: "IsText", sig: "IsText(v)", group: "logic" },
  { name: "IsList", sig: "IsList(v)", group: "logic" },
  { name: "IsBoolean", sig: "IsBoolean(v)", group: "logic" },
  { name: "IsDate", sig: "IsDate(v)", group: "logic" },
  { name: "True", sig: "True()", group: "logic" },
  { name: "False", sig: "False()", group: "logic" },
  // Listes
  { name: "Filter", sig: "Filter(list, x -> pred)", group: "list" },
  { name: "Where", sig: "Where(list, currentValue.x > …)", group: "list" },
  { name: "Map", sig: "Map(list, x -> expr)", group: "list" },
  { name: "Reduce", sig: "Reduce(list, fn, init)", group: "list" },
  { name: "Sort", sig: "Sort(list, key?)", group: "list" },
  { name: "Reverse", sig: "Reverse(list)", group: "list" },
  { name: "Unique", sig: "Unique(list)", group: "list" },
  { name: "GroupBy", sig: "GroupBy(list, key)", group: "list" },
  { name: "First", sig: "First(list)", group: "list" },
  { name: "Last", sig: "Last(list)", group: "list" },
  { name: "Nth", sig: "Nth(list, i)", group: "list" },
  { name: "Take", sig: "Take(list, n)", group: "list" },
  { name: "Drop", sig: "Drop(list, n)", group: "list" },
  { name: "Slice", sig: "Slice(list, start, end?)", group: "list" },
  { name: "Join", sig: "Join(list, sep)", group: "list" },
  { name: "In", sig: "In(value, list)", group: "list" },
  { name: "RandomItem", sig: "RandomItem(list)", group: "list" },
  { name: "ListConcat", sig: "ListConcat(a, b, …)", group: "list" },
  // Entités
  { name: "Lookup", sig: "Lookup(typeName, predicate)", group: "entity" },
  { name: "Backlinks", sig: "Backlinks(entity)", group: "entity" },
  { name: "Tags", sig: "Tags(entity)", group: "entity" },
];

const FUNCTION_NAMES_SET = new Set(FUNCTIONS.map((f) => f.name));

const KEYWORDS = new Set([
  "thisRow", "currentValue",
  "true", "false", "TRUE", "FALSE",
  "null", "NULL",
  "and", "or", "not", "AND", "OR", "NOT",
]);

/** Méthodes/propriétés valides sur une liste (chained). */
const LIST_MEMBERS: FnSpec[] = [
  { name: "count", sig: "count → number", group: "list" },
  { name: "length", sig: "length → number", group: "list" },
  { name: "sum", sig: "sum → number", group: "list" },
  { name: "avg", sig: "avg → number", group: "list" },
  { name: "min", sig: "min → number", group: "list" },
  { name: "max", sig: "max → number", group: "list" },
  { name: "first", sig: "first → item", group: "list" },
  { name: "last", sig: "last → item", group: "list" },
  { name: "where", sig: "where(currentValue …)", group: "list" },
  { name: "Filter", sig: "Filter(x -> pred)", group: "list" },
  { name: "Map", sig: "Map(x -> expr)", group: "list" },
  { name: "Sort", sig: "Sort(key?)", group: "list" },
  { name: "Reverse", sig: "Reverse()", group: "list" },
  { name: "Unique", sig: "Unique()", group: "list" },
  { name: "Take", sig: "Take(n)", group: "list" },
  { name: "Drop", sig: "Drop(n)", group: "list" },
  { name: "Slice", sig: "Slice(start, end?)", group: "list" },
  { name: "Join", sig: "Join(sep)", group: "list" },
  { name: "Count", sig: "Count()", group: "list" },
  { name: "Sum", sig: "Sum()", group: "list" },
];

// ── Tokenizer ────────────────────────────────────────────────────────────────

type TokKind =
  | "fn" | "base" | "field" | "keyword" | "string" | "number"
  | "operator" | "punct" | "ident" | "member" | "whitespace";

interface Tok {
  kind: TokKind;
  start: number;
  end: number;
  text: string;
}

interface LookupTables {
  baseNames: Set<string>;
  fieldNames: Set<string>;
}

function tokenize(src: string, tables: LookupTables): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let prevNonWs: Tok | null = null;
  const pushTok = (t: Tok): void => {
    out.push(t);
    if (t.kind !== "whitespace") prevNonWs = t;
  };
  const peekPrev = (): Tok | null => prevNonWs;
  while (i < src.length) {
    const c = src[i]!;
    // whitespace
    if (/\s/.test(c)) {
      let j = i;
      while (j < src.length && /\s/.test(src[j]!)) j++;
      pushTok({ kind: "whitespace", start: i, end: j, text: src.slice(i, j) });
      i = j;
      continue;
    }
    // string
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, src.length);
      pushTok({ kind: "string", start: i, end: j, text: src.slice(i, j) });
      i = j;
      continue;
    }
    // number
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[\d.]/.test(src[j]!)) j++;
      pushTok({ kind: "number", start: i, end: j, text: src.slice(i, j) });
      i = j;
      continue;
    }
    // field ref {slug}
    if (c === "{") {
      let j = i + 1;
      while (j < src.length && src[j] !== "}") j++;
      j = Math.min(j + 1, src.length);
      pushTok({ kind: "field", start: i, end: j, text: src.slice(i, j) });
      i = j;
      continue;
    }
    // identifier
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      const text = src.slice(i, j);
      let kind: TokKind = "ident";
      // si précédé d'un dot (token operator ".") → c'est un member
      const prev = peekPrev();
      if (prev && prev.kind === "operator" && prev.text === ".") {
        kind = "member";
      } else if (KEYWORDS.has(text)) kind = "keyword";
      else if (FUNCTION_NAMES_SET.has(text)) kind = "fn";
      else if (tables.baseNames.has(text)) kind = "base";
      else if (tables.fieldNames.has(text)) kind = "field";
      pushTok({ kind, start: i, end: j, text });
      i = j;
      continue;
    }
    // operators / punctuation
    if (/[+\-*/%=<>!&|.,()[\]]/.test(c)) {
      let j = i + 1;
      // multi-char ops
      const two = src.slice(i, i + 2);
      if (["==", "!=", "<=", ">=", "&&", "||", "->", "<>"].includes(two)) j = i + 2;
      const kind: TokKind = /[()[\],]/.test(c) ? "punct" : "operator";
      pushTok({ kind, start: i, end: j, text: src.slice(i, j) });
      i = j;
      continue;
    }
    // fallback
    pushTok({ kind: "ident", start: i, end: i + 1, text: c });
    i++;
  }
  return out;
}

const TOKEN_COLORS: Record<TokKind, string | null> = {
  fn: "#8B5CF6",         // violet
  base: "#10B981",       // vert
  field: "#3B82F6",      // bleu
  keyword: "#EAB308",    // ambre
  string: "#16A34A",     // vert sombre
  number: "#EA580C",     // orange
  operator: "var(--text-muted)",
  punct: "var(--text-muted)",
  ident: "var(--text-primary)",
  member: "#A855F7",     // violet clair
  whitespace: null,
};

// ── Completion ───────────────────────────────────────────────────────────────

type CompletionMode = "free" | "member-of-base" | "member-of-list" | "member-of-row";

interface CompletionItem {
  label: string;
  kind: "function" | "base" | "field" | "keyword" | "member";
  insertText: string;
  cursorDelta?: number;
  detail?: string;
}

interface ContextInfo {
  /** Mode actif. */
  mode: CompletionMode;
  /** Mot en cours (suffixe à filtrer). */
  prefix: string;
  /** Plage à remplacer dans la source. */
  start: number;
  end: number;
  /** Si mode = member-of-base : la base ciblée. */
  contextBase?: EntityType;
}

function contextAtCursor(
  src: string,
  cursor: number,
  basesByName: Map<string, EntityType>,
): ContextInfo {
  // Mot courant (identifier alphanum) à la position curseur
  let start = cursor;
  while (start > 0 && /[A-Za-z0-9_]/.test(src[start - 1] ?? "")) start--;
  let end = cursor;
  while (end < src.length && /[A-Za-z0-9_]/.test(src[end] ?? "")) end++;
  const prefix = src.slice(start, end);

  // Avant ce mot : est-on précédé d'un `.` ?
  // On regarde le caractère immédiatement avant `start` (en sautant le whitespace).
  let p = start - 1;
  while (p >= 0 && /\s/.test(src[p] ?? "")) p--;
  if (p >= 0 && src[p] === ".") {
    // identifier juste avant le `.`
    let identEnd = p;
    let identStart = p;
    while (identStart > 0 && /[A-Za-z0-9_]/.test(src[identStart - 1] ?? "")) identStart--;
    const ident = src.slice(identStart, identEnd);
    if (ident) {
      if (ident === "thisRow") return { mode: "member-of-row", prefix, start, end };
      const b = basesByName.get(ident);
      if (b) return { mode: "member-of-base", prefix, start, end, contextBase: b };
      // currentValue inside a where() — pas de typage précis, on traite comme row libre
      if (ident === "currentValue") return { mode: "member-of-row", prefix, start, end };
      // chaîne déjà aggregée: list result type. On propose les membres de list.
      return { mode: "member-of-list", prefix, start, end };
    }
  }
  return { mode: "free", prefix, start, end };
}

function buildCompletions(
  ctx: ContextInfo,
  base: EntityType,
  bases: EntityType[],
): CompletionItem[] {
  if (ctx.mode === "member-of-base" && ctx.contextBase) {
    const fields = ctx.contextBase.fields.map((f): CompletionItem => ({
      label: f.label || f.name,
      kind: "field",
      insertText: f.name || f.id,
      detail: f.kind,
    }));
    const listMembers = LIST_MEMBERS.map((m): CompletionItem => ({
      label: m.name,
      kind: "member",
      insertText: m.sig.includes("(") && !m.sig.startsWith(m.name + " ") ? `${m.name}()` : m.name,
      cursorDelta: m.sig.includes("(") && !m.sig.startsWith(m.name + " ") ? -1 : 0,
      detail: m.sig,
    }));
    return [...fields, ...listMembers];
  }
  if (ctx.mode === "member-of-row") {
    return base.fields.map((f): CompletionItem => ({
      label: f.label || f.name,
      kind: "field",
      insertText: f.name || f.id,
      detail: f.kind,
    }));
  }
  if (ctx.mode === "member-of-list") {
    return LIST_MEMBERS.map((m): CompletionItem => ({
      label: m.name,
      kind: "member",
      insertText: m.sig.includes("(") && !m.sig.startsWith(m.name + " ") ? `${m.name}()` : m.name,
      cursorDelta: m.sig.includes("(") && !m.sig.startsWith(m.name + " ") ? -1 : 0,
      detail: m.sig,
    }));
  }
  // mode free
  const fns = FUNCTIONS.map((f): CompletionItem => ({
    label: f.name,
    kind: "function",
    insertText: `${f.name}()`,
    cursorDelta: -1,
    detail: f.sig,
  }));
  const baseItems = bases.flatMap((b): CompletionItem[] => {
    const out: CompletionItem[] = [];
    const seen = new Set<string>();
    for (const cand of [b.name, b.plural].filter(Boolean) as string[]) {
      if (seen.has(cand)) continue;
      seen.add(cand);
      out.push({ label: cand, kind: "base", insertText: cand, detail: `${b.fields.length} champs` });
    }
    return out;
  });
  const fields = base.fields.map((f): CompletionItem => ({
    label: f.label || f.name,
    kind: "field",
    insertText: `{${f.name || f.id}}`,
    detail: f.kind,
  }));
  const kw: CompletionItem[] = [
    { label: "thisRow", kind: "keyword", insertText: "thisRow", detail: "ligne courante" },
    { label: "currentValue", kind: "keyword", insertText: "currentValue", detail: "item dans where/Filter" },
    { label: "true", kind: "keyword", insertText: "true" },
    { label: "false", kind: "keyword", insertText: "false" },
    { label: "null", kind: "keyword", insertText: "null" },
  ];
  return [...fns, ...baseItems, ...fields, ...kw];
}

// ── Param hints — détecte l'appel de fonction englobant ─────────────────────

function paramHintAtCursor(src: string, cursor: number): { name: string; argIndex: number } | null {
  let depth = 0;
  let commas = 0;
  let i = cursor - 1;
  while (i >= 0) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      const q = c;
      i--;
      while (i >= 0 && src[i] !== q) i--;
      i--;
      continue;
    }
    if (c === ")") { depth++; i--; continue; }
    if (c === "(") {
      if (depth === 0) {
        // ident juste avant
        let j = i - 1;
        while (j >= 0 && /\s/.test(src[j] ?? "")) j--;
        let end = j + 1;
        while (j >= 0 && /[A-Za-z0-9_]/.test(src[j] ?? "")) j--;
        const name = src.slice(j + 1, end);
        return name ? { name, argIndex: commas } : null;
      }
      depth--; i--; continue;
    }
    if (c === "," && depth === 0) commas++;
    i--;
  }
  return null;
}

function highlightParam(sig: string, argIndex: number): React.ReactNode {
  // signature ex : "Round(n, decimals?)". Trouve la parenthèse + split par virgule.
  const open = sig.indexOf("(");
  const close = sig.lastIndexOf(")");
  if (open < 0 || close < 0 || close < open) return sig;
  const head = sig.slice(0, open + 1);
  const tail = sig.slice(close);
  const params = sig.slice(open + 1, close).split(",").map((p) => p.trim());
  return (
    <>
      {head}
      {params.map((p, i) => (
        <span key={i}>
          {i > 0 && ", "}
          <span style={{ fontWeight: i === argIndex ? 700 : 400, color: i === argIndex ? "var(--accent)" : undefined }}>
            {p}
          </span>
        </span>
      ))}
      {tail}
    </>
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

type FormulaOutputKind = "text" | "number" | "date" | "bool";

interface FormulaInputEditorProps {
  base: EntityType;
  initialExpression?: string;
  initialOutputKind?: FormulaOutputKind;
  initialOutputFormat?: string;
  onSubmit: (expression: string, outputKind: FormulaOutputKind, outputFormat?: string) => void;
  onCancel: () => void;
}

// ── Composant ────────────────────────────────────────────────────────────────

export function FormulaInputEditor({
  base,
  initialExpression = "",
  initialOutputKind = "text",
  initialOutputFormat,
  onSubmit,
  onCancel,
}: FormulaInputEditorProps) {
  const [expression, setExpression] = useState(initialExpression);
  const [outputKind, setOutputKind] = useState<FormulaOutputKind>(initialOutputKind);
  const [outputFormat, setOutputFormat] = useState<string>(initialOutputFormat ?? "");
  const [outputKindOverridden, setOutputKindOverridden] = useState(false);
  const [cursor, setCursor] = useState(initialExpression.length);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  // Auto-inference outputKind tant que user n'a pas override le dropdown.
  useEffect(() => {
    if (outputKindOverridden || !expression.trim()) return;
    const r = parseFormula(expression);
    if (!r.ok) return;
    const inferred = inferFormulaOutputKind(r.value);
    if (inferred !== outputKind) setOutputKind(inferred);
  }, [expression, outputKindOverridden, outputKind]);

  // Sync scroll mirror ↔ textarea
  const handleScroll = () => {
    if (taRef.current && mirrorRef.current) {
      mirrorRef.current.scrollTop = taRef.current.scrollTop;
      mirrorRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  // Bases (autres EntityTypes) via tRPC
  const { data: ipcTypes } = trpc.schemas.list.useQuery({ search: undefined });
  const otherBases = useMemo<EntityType[]>(
    () => (ipcTypes ?? []).map(ipcEntityTypeToCore),
    [ipcTypes],
  );

  const basesByName = useMemo(() => {
    const m = new Map<string, EntityType>();
    for (const b of otherBases) {
      if (b.name) m.set(b.name, b);
      if (b.plural) m.set(b.plural, b);
    }
    return m;
  }, [otherBases]);

  const lookupTables = useMemo<LookupTables>(() => ({
    baseNames: new Set(basesByName.keys()),
    fieldNames: new Set(base.fields.flatMap((f) => [f.name, f.id].filter(Boolean))),
  }), [basesByName, base.fields]);

  // Tokenize
  const tokens = useMemo(() => tokenize(expression, lookupTables), [expression, lookupTables]);

  // Context-aware completion
  const ctx = useMemo(() => contextAtCursor(expression, cursor, basesByName), [expression, cursor, basesByName]);
  const allCompletions = useMemo(() => buildCompletions(ctx, base, otherBases), [ctx, base, otherBases]);
  const filtered = useMemo(() => {
    if (!ctx.prefix && ctx.mode === "free") return [];
    const lc = ctx.prefix.toLowerCase();
    if (!lc) return allCompletions.slice(0, 12);
    return allCompletions
      .filter((c) => c.label.toLowerCase().startsWith(lc))
      .slice(0, 12);
  }, [allCompletions, ctx]);

  useEffect(() => { setSelectedIdx(0); }, [ctx.prefix, ctx.mode]);

  const parseInfo = useMemo(() => {
    if (!expression.trim()) return { ok: true as const };
    const r = parseFormula(expression);
    if (r.ok) return { ok: true as const };
    return { ok: false as const, message: r.error.message, offset: r.error.position.offset };
  }, [expression]);
  const parseError = parseInfo.ok ? null : parseInfo.message;
  const errorOffset = parseInfo.ok ? -1 : parseInfo.offset;

  const paramHint = useMemo(() => {
    const h = paramHintAtCursor(expression, cursor);
    if (!h) return null;
    const fn = FUNCTIONS.find((f) => f.name === h.name);
    if (!fn) return null;
    return { name: h.name, argIndex: h.argIndex, sig: fn.sig };
  }, [expression, cursor]);

  const applyCompletion = useCallback((comp: CompletionItem) => {
    const before = expression.slice(0, ctx.start);
    const after = expression.slice(ctx.end);
    const next = before + comp.insertText + after;
    const newCursor = ctx.start + comp.insertText.length + (comp.cursorDelta ?? 0);
    setExpression(next);
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.focus();
        taRef.current.setSelectionRange(newCursor, newCursor);
        setCursor(newCursor);
      }
    });
  }, [expression, ctx.start, ctx.end]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => (i + 1) % filtered.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => (i - 1 + filtered.length) % filtered.length); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        const pick = filtered[selectedIdx];
        if (pick) applyCompletion(pick);
        return;
      }
    }
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!parseError) onSubmit(expression, outputKind, outputFormat || undefined);
    }
    // `.` declenche autocomplete sans avoir à taper après
    if (e.key === ".") {
      requestAnimationFrame(() => { if (taRef.current) setCursor(taRef.current.selectionStart); });
    }
  };

  const syncCursor = () => {
    if (taRef.current) setCursor(taRef.current.selectionStart);
  };

  useEffect(() => {
    taRef.current?.focus();
    taRef.current?.setSelectionRange(expression.length, expression.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Force scroll resync after every render
  useLayoutEffect(() => { handleScroll(); });

  return (
    <div className="flex flex-col gap-2" style={{ width: 380 }}>
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        Formule de la colonne
      </p>

      {paramHint && (
        <div
          className="rounded px-2 py-1 font-mono text-[10px]"
          style={{
            backgroundColor: "var(--surface-1)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
        >
          {highlightParam(paramHint.sig, paramHint.argIndex)}
        </div>
      )}

      <div className="relative">
        {/* Mirror coloré derrière le textarea */}
        <div
          ref={mirrorRef}
          aria-hidden
          className="absolute inset-0 pointer-events-none overflow-hidden rounded border"
          style={{
            borderColor: parseError ? "var(--destructive)" : "var(--border)",
            padding: "6px 8px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            lineHeight: "1.5",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "transparent",
            backgroundColor: "var(--surface-0)",
          }}
        >
          {tokens.map((t, i) => {
            const color = TOKEN_COLORS[t.kind];
            const isErr = errorOffset >= 0 && errorOffset >= t.start && errorOffset <= t.end;
            if (t.kind === "whitespace") return <span key={i}>{t.text}</span>;
            return (
              <span
                key={i}
                style={{
                  color: color ?? "var(--text-primary)",
                  fontWeight: t.kind === "fn" || t.kind === "base" ? 600 : 400,
                  ...(t.kind === "base" ? {
                    backgroundColor: "rgba(16,185,129,0.10)",
                    borderRadius: 2,
                    padding: "0 1px",
                  } : null),
                  ...(t.kind === "field" ? {
                    backgroundColor: "rgba(59,130,246,0.10)",
                    borderRadius: 2,
                    padding: "0 1px",
                  } : null),
                  ...(t.kind === "fn" ? {
                    backgroundColor: "rgba(139,92,246,0.08)",
                    borderRadius: 2,
                    padding: "0 1px",
                  } : null),
                  ...(isErr ? {
                    textDecorationLine: "underline",
                    textDecorationStyle: "wavy",
                    textDecorationColor: "var(--destructive)",
                  } : null),
                }}
              >
                {t.text}
              </span>
            );
          })}
          {/* trailing newline workaround */}
          {"​"}
        </div>

        <textarea
          ref={taRef}
          value={expression}
          onChange={(e) => { setExpression(e.target.value); setCursor(e.target.selectionStart); }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCursor}
          onClick={syncCursor}
          onSelect={syncCursor}
          onScroll={handleScroll}
          rows={4}
          spellCheck={false}
          placeholder='Ex : Contact.where(currentValue.age == thisRow.age).count'
          className="relative w-full resize-y rounded border"
          style={{
            borderColor: parseError ? "var(--destructive)" : "var(--border)",
            padding: "6px 8px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            lineHeight: "1.5",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            backgroundColor: "transparent",
            color: "transparent",
            caretColor: "var(--text-primary)",
            outline: "none",
          }}
        />

        {filtered.length > 0 && (
          <div
            className="absolute left-0 right-0 top-full mt-1 rounded border shadow-md"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--surface-0)",
              zIndex: 10,
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            <ContextBanner ctx={ctx} />
            {filtered.map((c, i) => (
              <button
                key={c.kind + ":" + c.label + ":" + i}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); applyCompletion(c); }}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px]"
                style={{
                  backgroundColor: i === selectedIdx ? "var(--surface-2)" : "transparent",
                  color: "var(--text-primary)",
                }}
              >
                <KindBadge kind={c.kind} />
                <span className="font-mono">{c.label}</span>
                {c.detail && (
                  <span className="ml-auto truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {c.detail}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {parseError && (
        <p className="font-mono text-[10px]" style={{ color: "var(--destructive)" }}>
          {parseError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <label className="text-[11px]" style={{ color: "var(--text-secondary)" }}>Sortie</label>
        <select
          value={outputKind}
          onChange={(e) => { setOutputKind(e.target.value as FormulaOutputKind); setOutputKindOverridden(true); }}
          className="rounded border bg-[var(--surface-1)] px-1.5 py-1 text-[11px]"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          title={outputKindOverridden ? "Override manuel" : "Inféré depuis la formule"}
        >
          <option value="text">Texte</option>
          <option value="number">Nombre</option>
          <option value="date">Date</option>
          <option value="bool">Booléen</option>
        </select>
        {!outputKindOverridden && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>auto</span>
        )}
        {(outputKind === "number" || outputKind === "date") && (
          <select
            value={outputFormat}
            onChange={(e) => setOutputFormat(e.target.value)}
            className="rounded border bg-[var(--surface-1)] px-1.5 py-1 text-[11px]"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            {outputKind === "number" && (
              <>
                <option value="">Brut</option>
                <option value="decimals:0">0 décimale</option>
                <option value="decimals:2">2 décimales</option>
                <option value="percent">Pourcentage</option>
                <option value="currency:EUR">€ EUR</option>
                <option value="currency:USD">$ USD</option>
              </>
            )}
            {outputKind === "date" && (
              <>
                <option value="">Locale</option>
                <option value="date:YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="date:DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="date:YYYY-MM-DD HH:mm">YYYY-MM-DD HH:mm</option>
              </>
            )}
          </select>
        )}
        <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
          Tab/Entrée = autocomplète · Ctrl+Entrée = valider
        </span>
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={11} className="inline" /> Annuler
        </button>
        <button
          type="button"
          disabled={!!parseError || !expression.trim()}
          onClick={() => onSubmit(expression, outputKind, outputFormat || undefined)}
          className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium"
          style={{
            backgroundColor: "var(--accent)",
            color: "var(--accent-foreground)",
            opacity: parseError || !expression.trim() ? 0.5 : 1,
          }}
        >
          <Check size={11} /> Valider la formule
        </button>
      </div>
    </div>
  );
}

function ContextBanner({ ctx }: { ctx: ContextInfo }) {
  let label = "";
  if (ctx.mode === "member-of-base" && ctx.contextBase) label = `Champs et méthodes de ${ctx.contextBase.plural || ctx.contextBase.name}`;
  else if (ctx.mode === "member-of-row") label = "Champs de la ligne courante";
  else if (ctx.mode === "member-of-list") label = "Méthodes de liste";
  else label = "Fonctions, bases, champs";
  return (
    <div
      className="px-2 py-1 text-[10px] uppercase tracking-wide"
      style={{
        color: "var(--text-muted)",
        backgroundColor: "var(--surface-1)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      {label}
    </div>
  );
}

function KindBadge({ kind }: { kind: CompletionItem["kind"] }) {
  const palette: Record<CompletionItem["kind"], { bg: string; fg: string; label: string }> = {
    function: { bg: "#8B5CF6", fg: "#fff", label: "ƒ" },
    base: { bg: "#10B981", fg: "#fff", label: "B" },
    field: { bg: "#3B82F6", fg: "#fff", label: "#" },
    keyword: { bg: "#EAB308", fg: "#fff", label: "k" },
    member: { bg: "#A855F7", fg: "#fff", label: "." },
  };
  const p = palette[kind];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        borderRadius: 3,
        backgroundColor: p.bg,
        color: p.fg,
        fontSize: 9,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {p.label}
    </span>
  );
}
