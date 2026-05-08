"use client";

// ============================================================
// ConditionDocsPanel
// ----------------------------------------------------------------
// Inline documentation for the routine condition formula language.
// All entries below were extracted from the actual implementation
// in `packages/formulas/src/`. Do not add features here that are
// not implemented there — this panel must reflect reality.
//
// Sources of truth (read these before editing):
//   - lexer.ts     → operators, keywords, literal forms
//   - evaluator.ts → property access, identifier resolution
//   - stdlib/      → math, dates, strings, logic, lists, entities
//   - value.ts     → type coercions
// ============================================================

import { X, CaretDown, CaretRight } from "@phosphor-icons/react";
import { useState } from "react";

interface ConditionDocsPanelProps {
  open: boolean;
  onClose: () => void;
}

interface DocEntry {
  /** Code form, e.g. `a == b` or `Contains(s, sub)` */
  syntax: string;
  /** One-line plain explanation (FR) */
  desc: string;
  /** Optional concrete example */
  example?: string;
}

interface DocSection {
  title: string;
  entries: DocEntry[];
  note?: string;
}

// ── Reference data (extracted from packages/formulas/src) ─────────────────

const SECTIONS: DocSection[] = [
  {
    title: "Opérateurs logiques",
    note: "Mots-clés : true, false, null. Insensibles à la casse pour les valeurs littérales mais les opérateurs sont en minuscules.",
    entries: [
      { syntax: "a and b", desc: "ET logique (les deux vrais).", example: "status == 'active' and priority > 3" },
      { syntax: "a or b", desc: "OU logique (au moins un vrai).", example: "tag == 'urgent' or starred" },
      { syntax: "not a", desc: "Négation booléenne.", example: "not archived" },
    ],
  },
  {
    title: "Comparaisons",
    entries: [
      { syntax: "a == b", desc: "Égal (note : double `=`, pas `===`)." },
      { syntax: "a != b", desc: "Différent." },
      { syntax: "a < b", desc: "Strictement inférieur." },
      { syntax: "a <= b", desc: "Inférieur ou égal." },
      { syntax: "a > b", desc: "Strictement supérieur." },
      { syntax: "a >= b", desc: "Supérieur ou égal." },
    ],
  },
  {
    title: "Arithmétique",
    entries: [
      { syntax: "a + b", desc: "Addition (ou concat. de chaînes si l'un est string)." },
      { syntax: "a - b", desc: "Soustraction." },
      { syntax: "a * b", desc: "Multiplication." },
      { syntax: "a / b", desc: "Division." },
      { syntax: "a % b", desc: "Modulo." },
      { syntax: "-a", desc: "Opposé (unaire)." },
    ],
  },
  {
    title: "Accès aux champs",
    note: "Une entité expose ses champs via `.`. Les valeurs absentes renvoient null (pas une erreur), et null se propage à travers les chaînes d'accès.",
    entries: [
      { syntax: "entity.fieldName", desc: "Lit un champ d'une entité.", example: "person.name" },
      { syntax: "@id", desc: "Référence directe à une entité par id.", example: "@person-123.name" },
      { syntax: "[[Titre]]", desc: "Référence par wikilink (titre/nom).", example: "[[Marie Curie]].lastInteraction" },
    ],
  },
  {
    title: "Variables disponibles",
    note: "Les variables exposées dépendent du contexte fourni par le moteur d'automation au moment de l'exécution. À ce jour, le moteur (packages/automations) accepte un évaluateur de formules optionnel — si aucun évaluateur n'est branché, la condition est ignorée et la routine s'exécute toujours.",
    entries: [
      { syntax: "now", desc: "Date/heure courante stable pour cette exécution (via la fonction Now())." },
      { syntax: "entity", desc: "Entité courante quand le déclencheur est lié à une entité (ex. trigger « alarm » sur un anniversaire)." },
    ],
  },
  {
    title: "Fonctions — Logique",
    entries: [
      { syntax: "If(cond, alors, sinon)", desc: "Choix ternaire." },
      { syntax: "IfElse(c1, v1, c2, v2, …, défaut)", desc: "Cascade de tests, valeur par défaut optionnelle." },
      { syntax: "And(a, b, …)", desc: "ET variadique." },
      { syntax: "Or(a, b, …)", desc: "OU variadique." },
      { syntax: "Not(a)", desc: "Négation." },
      { syntax: "Switch(val, c1, r1, c2, r2, …, défaut)", desc: "Aiguillage par égalité." },
    ],
  },
  {
    title: "Fonctions — Dates",
    note: "Unités acceptées par DateAdd : day, week, month, year, hour, minute. Pour DateDiff : ms, second, minute, hour, day, week.",
    entries: [
      { syntax: "Now()", desc: "Date/heure actuelle." },
      { syntax: "Today()", desc: "Aujourd'hui à minuit (heure locale)." },
      { syntax: "DateAdd(d, n, 'day')", desc: "Ajoute n unités à une date.", example: "DateAdd(Today(), 7, 'day')" },
      { syntax: "DateDiff(a, b, 'day')", desc: "Différence (a − b) entière en unités.", example: "DateDiff(Now(), entity.lastInteraction, 'day') > 30" },
      { syntax: "Year(d) / Month(d) / Day(d)", desc: "Composantes d'une date." },
      { syntax: "Hour(d) / Minute(d)", desc: "Heure / minute." },
      { syntax: "WeekOfYear(d)", desc: "Numéro de semaine ISO approximatif." },
      { syntax: "Format(d, 'YYYY-MM-DD')", desc: "Formate avec tokens YYYY, MM, DD, HH, mm, ss." },
      { syntax: "ParseDate('2026-01-15')", desc: "Parse une chaîne en date." },
    ],
  },
  {
    title: "Fonctions — Chaînes",
    entries: [
      { syntax: "Concat(a, b, …)", desc: "Concatène en chaîne." },
      { syntax: "Length(s)", desc: "Longueur." },
      { syntax: "Upper(s) / Lower(s)", desc: "Casse." },
      { syntax: "Trim(s)", desc: "Supprime les espaces aux bords." },
      { syntax: "Split(s, sep)", desc: "Découpe en liste." },
      { syntax: "Replace(s, de, vers)", desc: "Remplacement littéral (toutes occurrences)." },
      { syntax: "Contains(s, sub)", desc: "Vrai si `s` contient `sub`.", example: "Contains(entity.tags, 'urgent')" },
      { syntax: "StartsWith(s, prefix)", desc: "Préfixe." },
      { syntax: "EndsWith(s, suffix)", desc: "Suffixe." },
      { syntax: "Substring(s, start, end?)", desc: "Sous-chaîne (indices 0-based)." },
      { syntax: "RegexMatch(s, pattern)", desc: "Renvoie la 1re correspondance ou null." },
      { syntax: "Slugify(s)", desc: "Slug ASCII minuscule pour URL." },
    ],
  },
  {
    title: "Fonctions — Math",
    entries: [
      { syntax: "Sum(a, b, …)", desc: "Somme. Aplatie les listes." },
      { syntax: "Average(list)", desc: "Moyenne." },
      { syntax: "Min(list) / Max(list)", desc: "Min / Max." },
      { syntax: "Count(list)", desc: "Nombre d'éléments." },
      { syntax: "Abs(n) / Round(n, dec?) / Ceil(n) / Floor(n)", desc: "Arrondis classiques." },
      { syntax: "Pow(base, exp)", desc: "Puissance." },
      { syntax: "Sqrt(n)", desc: "Racine carrée." },
      { syntax: "Mod(a, b)", desc: "Modulo (toujours positif)." },
    ],
  },
  {
    title: "Fonctions — Listes",
    note: "Les fonctions d'ordre supérieur acceptent un lambda de la forme `x -> expression`.",
    entries: [
      { syntax: "Map(list, x -> expr)", desc: "Applique une transformation." },
      { syntax: "Filter(list, x -> cond)", desc: "Garde les éléments où cond est vraie." },
      { syntax: "Reduce(list, (acc, x) -> expr, init)", desc: "Pli avec accumulateur." },
      { syntax: "CountIf(list, x -> cond)", desc: "Compte les éléments matchant.", example: "CountIf(entity.tasks, t -> not t.done) > 0" },
      { syntax: "Sort(list, x -> clé?)", desc: "Tri (clé optionnelle)." },
      { syntax: "Reverse(list)", desc: "Inverse l'ordre." },
      { syntax: "Unique(list)", desc: "Élimine les doublons." },
      { syntax: "First(list) / Last(list) / Nth(list, n)", desc: "Accès par position." },
      { syntax: "Take(list, n) / Drop(list, n)", desc: "Préfixe / suffixe." },
      { syntax: "GroupBy(list, x -> clé)", desc: "Regroupe par clé." },
      { syntax: "Join(list, sep)", desc: "Concatène en chaîne." },
      { syntax: "ListConcat(a, b, …)", desc: "Concatène des listes." },
    ],
  },
  {
    title: "Fonctions — Entités",
    note: "Filter avec une chaîne en 1er argument interroge le graphe par type (ex. type d'entité « person »).",
    entries: [
      { syntax: "Filter('person', p -> p.active)", desc: "Liste les entités du type donné, filtrées." },
      { syntax: "Lookup(entity, 'relType'?)", desc: "Cibles des relations sortantes." },
      { syntax: "Backlinks(entity)", desc: "Sources des relations entrantes." },
      { syntax: "Tags(entity)", desc: "Liste des tags d'une entité." },
    ],
  },
];

const EXAMPLES: { code: string; desc: string }[] = [
  {
    code: "DateDiff(Now(), entity.lastInteraction, 'day') > 30",
    desc: "Vrai pour une entité non contactée depuis plus de 30 jours.",
  },
  {
    code: "entity.status == 'active' and not entity.archived",
    desc: "Active et non archivée.",
  },
  {
    code: "Contains(entity.tags, 'urgent') or entity.priority >= 4",
    desc: "Tag urgent ou priorité élevée.",
  },
  {
    code: "Hour(Now()) >= 8 and Hour(Now()) < 18",
    desc: "Restreint l'exécution aux heures ouvrées.",
  },
  {
    code: "CountIf(entity.tasks, t -> not t.done) > 0",
    desc: "L'entité a au moins une tâche en cours.",
  },
];

// ── Components ────────────────────────────────────────────────────────────

function CollapsibleSection({ section }: { section: DocSection }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-md border"
      style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold transition-colors hover:bg-[var(--surface-2)]"
        style={{ color: "var(--text-primary)" }}
      >
        <span className="flex items-center gap-2">
          {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
          {section.title}
        </span>
        <span className="text-[10px] font-normal" style={{ color: "var(--text-muted)" }}>
          {section.entries.length}
        </span>
      </button>
      {open && (
        <div className="border-t px-3 py-2" style={{ borderColor: "var(--border-subtle)" }}>
          {section.note && (
            <p className="mb-2 text-[11px] italic" style={{ color: "var(--text-muted)" }}>
              {section.note}
            </p>
          )}
          <ul className="space-y-1.5">
            {section.entries.map((entry, i) => (
              <li key={i} className="text-xs">
                <code
                  className="rounded px-1 py-0.5 font-mono text-[11px]"
                  style={{ backgroundColor: "var(--surface-3)", color: "var(--text-primary)" }}
                >
                  {entry.syntax}
                </code>
                <span className="ml-2" style={{ color: "var(--text-muted)" }}>
                  {entry.desc}
                </span>
                {entry.example && (
                  <div className="mt-0.5 pl-2">
                    <code
                      className="rounded px-1 py-0.5 font-mono text-[10.5px]"
                      style={{ backgroundColor: "var(--surface-1)", color: "var(--text-secondary)" }}
                    >
                      {entry.example}
                    </code>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ConditionDocsPanel({ open, onClose }: ConditionDocsPanelProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end"
      style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Documentation des conditions de routine"
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l shadow-xl"
        style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Formules de condition
            </h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Référence du langage @supernote/formulas
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 transition-colors hover:bg-[var(--surface-3)]"
            style={{ color: "var(--text-muted)" }}
            aria-label="Fermer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Status banner */}
          <div
            className="rounded-md border px-3 py-2 text-[11px]"
            style={{
              backgroundColor: "oklch(0.93 0.10 80 / 0.15)",
              borderColor: "oklch(0.85 0.15 80 / 0.4)",
              color: "var(--text-primary)",
            }}
          >
            <strong>Statut d'intégration :</strong> le langage de formules est implémenté dans
            <code className="mx-1 rounded px-1" style={{ backgroundColor: "var(--surface-3)" }}>
              @supernote/formulas
            </code>
            (parser + évaluateur + stdlib complète). Le moteur d'automations
            l'accepte via une interface
            <code className="mx-1 rounded px-1" style={{ backgroundColor: "var(--surface-3)" }}>
              FormulaEvaluator
            </code>
            optionnelle. Tant qu'aucun évaluateur n'est branché côté app, les conditions saisies
            sont stockées mais non évaluées (la routine s'exécute toujours). Les fonctions ci-dessous
            décrivent ce que le langage <em>sait</em> évaluer une fois branché.
          </div>

          {/* Quick syntax */}
          <div
            className="rounded-md border px-3 py-2 text-[11px]"
            style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
          >
            <p className="mb-1 font-semibold" style={{ color: "var(--text-primary)" }}>
              Bases du langage
            </p>
            <ul className="space-y-0.5" style={{ color: "var(--text-muted)" }}>
              <li>Littéraux : <code>42</code>, <code>3.14</code>, <code>&quot;texte&quot;</code>, <code>&apos;texte&apos;</code>, <code>true</code>, <code>false</code>, <code>null</code></li>
              <li>Listes : <code>[1, 2, 3]</code></li>
              <li>Lambdas : <code>x -&gt; x * 2</code></li>
              <li>Commentaires : <code>// jusqu'à fin de ligne</code></li>
              <li>Référence d'entité : <code>@id</code> ou <code>[[Titre]]</code></li>
              <li>Accès champ : <code>entity.field</code> (null se propage)</li>
            </ul>
          </div>

          {/* Sections */}
          <div className="space-y-2">
            {SECTIONS.map((s) => (
              <CollapsibleSection key={s.title} section={s} />
            ))}
          </div>

          {/* Examples */}
          <div
            className="rounded-md border p-3"
            style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
          >
            <p className="mb-2 text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
              Exemples concrets
            </p>
            <ul className="space-y-2">
              {EXAMPLES.map((ex, i) => (
                <li key={i}>
                  <code
                    className="block rounded px-2 py-1 font-mono text-[11px]"
                    style={{ backgroundColor: "var(--surface-3)", color: "var(--text-primary)" }}
                  >
                    {ex.code}
                  </code>
                  <p className="mt-0.5 pl-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {ex.desc}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {/* Footer note */}
          <p className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>
            Source : <code>packages/formulas/src/</code> (lexer, evaluator, stdlib). Si une fonction
            manque ici alors qu'elle existe dans le code, ouvre une issue — cette doc doit rester en
            phase avec l'implémentation.
          </p>
        </div>
      </div>
    </div>
  );
}
