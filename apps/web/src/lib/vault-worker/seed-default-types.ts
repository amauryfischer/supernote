/**
 * seed-default-types — idempotent seeding of canonical entity types and
 * their default relations into the vault DB.
 *
 * Stable IDs (id = name) are used so the rest of the app can reference
 * `typeId: "note"` / `typeId: "personne"` literally without a prior lookup.
 * Default seeds are marked `isSystem = 1` but remain editable from the UI.
 *
 * Mirrored from `apps/web/src/components/schemas/fixtures.ts` to keep the
 * worker bundle self-contained (no @/ alias resolution into client code).
 */

import type { Database } from "./sqlite-adapter";

interface SeedField {
  id: string;
  name: string;
  label: string;
  kind: string;
  required?: boolean;
  unique?: boolean;
  options?: { value: string; label: string; color?: string }[];
  min?: number;
  max?: number;
  currencyCode?: string;
  targetTypeId?: string;
  cardinality?: string;
}

interface SeedEntityType {
  id: string;
  name: string;
  plural: string;
  icon: string;
  color: string;
  fields: SeedField[];
  defaultPath: string;
  fileNamePattern: string;
}

interface SeedRelationType {
  id: string;
  forwardLabel: string;
  inverseLabel: string;
  sourceTypeId: string;
  targetTypeId: string;
  cardinality: "one_to_one" | "one_to_many" | "many_to_many";
}

const personneFields: SeedField[] = [
  { id: "per_name", name: "name", label: "Nom complet", kind: "text", required: true, unique: true },
  { id: "per_email", name: "email", label: "Email", kind: "email", unique: true },
  { id: "per_phone", name: "phone", label: "Téléphone", kind: "phone" },
  { id: "per_company", name: "company", label: "Entreprise", kind: "text" },
  { id: "per_role", name: "role", label: "Rôle", kind: "text" },
  // Alias list, stored as a JSON-encoded string array (e.g. `["LD","Linh"]`).
  // Indexed alongside `name` so MiniSearch resolves "@LD" → this contact.
  { id: "per_aliases", name: "aliases", label: "Alias", kind: "longtext" },
  {
    id: "per_status", name: "status", label: "Statut", kind: "select",
    options: [
      { value: "actif", label: "Actif", color: "#10B981" },
      { value: "inactif", label: "Inactif", color: "#94A3B8" },
      { value: "prospect", label: "Prospect", color: "#FBBF24" },
    ],
  },
  { id: "per_linkedin", name: "linkedin", label: "LinkedIn", kind: "url" },
  // Date d'anniversaire — utilisée par la routine système "Rappel
  // anniversaires" (alarm trigger recurAnnually) pour notifier le jour-J.
  { id: "per_birthday", name: "birthday", label: "Anniversaire", kind: "date" },
  { id: "per_avatar", name: "avatar", label: "Photo", kind: "image" },
  { id: "per_notes", name: "notes", label: "Notes", kind: "markdown" },
  { id: "per_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
  { id: "per_updated_at", name: "updatedAt", label: "Modifié le", kind: "updatedAt" },
];

const orgaFields: SeedField[] = [
  { id: "org_name", name: "name", label: "Nom", kind: "text", required: true, unique: true },
  {
    id: "org_type", name: "type", label: "Type", kind: "select",
    options: [
      { value: "startup", label: "Startup", color: "#A78BFA" },
      { value: "pme", label: "PME", color: "#60A5FA" },
      { value: "grand_groupe", label: "Grand groupe", color: "#34D399" },
      { value: "association", label: "Association", color: "#FBBF24" },
    ],
  },
  { id: "org_website", name: "website", label: "Site web", kind: "url" },
  { id: "org_sector", name: "sector", label: "Secteur", kind: "text" },
  { id: "org_size", name: "size", label: "Taille", kind: "number" },
  { id: "org_description", name: "description", label: "Description", kind: "longtext" },
  { id: "org_logo", name: "logo", label: "Logo", kind: "image" },
  { id: "org_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
  { id: "org_updated_at", name: "updatedAt", label: "Modifié le", kind: "updatedAt" },
];

const interactionFields: SeedField[] = [
  { id: "int_title", name: "title", label: "Titre", kind: "text", required: true },
  {
    id: "int_type", name: "type", label: "Type", kind: "select",
    options: [
      { value: "email", label: "Email", color: "#60A5FA" },
      { value: "appel", label: "Appel", color: "#34D399" },
      { value: "reunion", label: "Réunion", color: "#A78BFA" },
      { value: "message", label: "Message", color: "#FBBF24" },
    ],
  },
  { id: "int_date", name: "date", label: "Date", kind: "datetime" },
  { id: "int_duration", name: "duration", label: "Durée (min)", kind: "number" },
  { id: "int_summary", name: "summary", label: "Résumé", kind: "longtext" },
  { id: "int_next_action", name: "next_action", label: "Prochaine action", kind: "text" },
  { id: "int_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
];

const noteFields: SeedField[] = [
  { id: "note_title", name: "title", label: "Titre", kind: "text", required: true },
  { id: "note_body", name: "body", label: "Contenu", kind: "markdown" },
  {
    id: "note_type", name: "type", label: "Type", kind: "select",
    options: [
      { value: "note", label: "Note", color: "#60A5FA" },
      { value: "ressource", label: "Ressource", color: "#34D399" },
      { value: "idee", label: "Idée", color: "#FBBF24" },
    ],
  },
  { id: "note_pinned", name: "pinned", label: "Épinglée", kind: "bool" },
  // Stores the JSON-serialized CanvasDocument for the canvas view of this
  // note. Canvas is a *view* of the note, not a separate entity, so the
  // doc lives alongside `body` on the same row. Empty/absent → render the
  // default canvas (a single block holding the note's body).
  { id: "note_canvas", name: "canvas", label: "Vue canvas", kind: "longtext" },
  // Cache of the AI-verified checklist extraction for this note. Internal
  // book-keeping for the smart-todos feature: re-running detection skips
  // the LLM call when the body hash is unchanged. JSON-encoded; see
  // `apps/web/src/hooks/useTodoSync.ts` for the schema.
  { id: "note_todo_cache", name: "todoCache", label: "Cache todos", kind: "longtext" },
  { id: "note_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
  { id: "note_updated_at", name: "updatedAt", label: "Modifié le", kind: "updatedAt" },
];

const dailyFields: SeedField[] = [
  { id: "daily_date", name: "date", label: "Date", kind: "date", required: true, unique: true },
  { id: "daily_body", name: "body", label: "Journal", kind: "markdown" },
  { id: "daily_mood", name: "mood", label: "Humeur", kind: "rating", min: 1, max: 5 },
  {
    id: "daily_energy", name: "energy", label: "Energie", kind: "select",
    options: [
      { value: "high", label: "Haute", color: "#10B981" },
      { value: "medium", label: "Moyenne", color: "#FBBF24" },
      { value: "low", label: "Basse", color: "#EF4444" },
    ],
  },
  { id: "daily_gratitude", name: "gratitude", label: "Gratitude", kind: "longtext" },
  { id: "daily_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
];

const tagFields: SeedField[] = [
  { id: "tag_name", name: "name", label: "Nom", kind: "text", required: true, unique: true },
  { id: "tag_color", name: "color", label: "Couleur", kind: "color" },
  { id: "tag_description", name: "description", label: "Description", kind: "text" },
  { id: "tag_parent", name: "parent", label: "Parent", kind: "relation", targetTypeId: "tag", cardinality: "one_to_many" },
];

const accountFields: SeedField[] = [
  { id: "acc_name", name: "name", label: "Nom du compte", kind: "text", required: true },
  {
    id: "acc_kind", name: "kind", label: "Type", kind: "select",
    options: [
      { value: "checking", label: "Courant", color: "#60A5FA" },
      { value: "savings", label: "Épargne", color: "#34D399" },
      { value: "pea", label: "PEA", color: "#FBBF24" },
      { value: "crypto", label: "Crypto", color: "#F59E0B" },
    ],
  },
  { id: "acc_balance", name: "current_balance", label: "Solde actuel", kind: "currency", currencyCode: "EUR" },
  { id: "acc_iban", name: "iban", label: "IBAN", kind: "text" },
  { id: "acc_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
];

const assetFields: SeedField[] = [
  { id: "ast_name", name: "name", label: "Nom", kind: "text", required: true },
  {
    id: "ast_category", name: "category", label: "Catégorie", kind: "select",
    options: [
      { value: "immo", label: "Immobilier", color: "#7C3AED" },
      { value: "action", label: "Action", color: "#2563EB" },
      { value: "crypto", label: "Crypto", color: "#D97706" },
      { value: "fond", label: "Fonds", color: "#0891B2" },
    ],
  },
  { id: "ast_value", name: "current_value", label: "Valeur actuelle", kind: "currency", currencyCode: "EUR" },
  { id: "ast_acquisition", name: "acquisition_value", label: "Valeur d'acquisition", kind: "currency", currencyCode: "EUR" },
  { id: "ast_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
];

const loanFields: SeedField[] = [
  { id: "loan_name", name: "name", label: "Nom", kind: "text", required: true },
  { id: "loan_amount", name: "amount", label: "Montant", kind: "currency", currencyCode: "EUR" },
  { id: "loan_rate", name: "rate", label: "Taux (%)", kind: "percent" },
  { id: "loan_start", name: "start_date", label: "Début", kind: "date" },
  { id: "loan_end", name: "end_date", label: "Fin", kind: "date" },
  { id: "loan_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
];

const snapshotFields: SeedField[] = [
  { id: "snap_date", name: "date", label: "Date", kind: "date", required: true },
  { id: "snap_net_worth", name: "net_worth", label: "Patrimoine net", kind: "currency", currencyCode: "EUR" },
  { id: "snap_total_assets", name: "total_assets", label: "Total actifs", kind: "currency", currencyCode: "EUR" },
  { id: "snap_total_debts", name: "total_debts", label: "Total dettes", kind: "currency", currencyCode: "EUR" },
  { id: "snap_notes", name: "notes", label: "Notes", kind: "longtext" },
  { id: "snap_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
];

const canvasFields: SeedField[] = [
  { id: "canvas_name", name: "name", label: "Nom", kind: "text", required: true },
  { id: "canvas_data", name: "data", label: "Données", kind: "longtext" },
  { id: "canvas_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
  { id: "canvas_updated_at", name: "updatedAt", label: "Modifié le", kind: "updatedAt" },
];

const routineFields: SeedField[] = [
  { id: "routine_name", name: "name", label: "Nom", kind: "text", required: true },
  { id: "routine_description", name: "description", label: "Description", kind: "longtext" },
  { id: "routine_cron", name: "cron", label: "Planification (cron)", kind: "text" },
  { id: "routine_actions", name: "actions", label: "Actions (JSON)", kind: "longtext" },
  { id: "routine_enabled", name: "enabled", label: "Activée", kind: "bool" },
  { id: "routine_template_key", name: "templateKey", label: "Modèle", kind: "text" },
  { id: "routine_trigger", name: "trigger", label: "Déclencheur (JSON)", kind: "longtext" },
  { id: "routine_conditions", name: "conditions", label: "Conditions", kind: "longtext" },
  { id: "routine_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
  { id: "routine_updated_at", name: "updatedAt", label: "Modifié le", kind: "updatedAt" },
];

const todoFields: SeedField[] = [
  { id: "todo_text", name: "text", label: "Texte", kind: "text", required: true },
  { id: "todo_done", name: "done", label: "Fait", kind: "bool" },
  // Source linkage — the note this todo was extracted from. Optional because
  // a todo can also be created standalone from the /todos page.
  { id: "todo_source_note", name: "sourceNoteId", label: "Note source", kind: "text" },
  // JSON-encoded `{ start, end, blockId? }` so we know where in the note's
  // markdown the corresponding `- [ ]` line lives. Used to flip the checkbox
  // back when the user toggles the todo from the TODO panel.
  { id: "todo_source_range", name: "sourceLineRange", label: "Plage source", kind: "longtext" },
  { id: "todo_due", name: "dueDate", label: "Échéance", kind: "date" },
  // Numeric priority 1-9 (lower = more urgent). Surfaced as a "P{n}" badge.
  // Defaults to 5 in UI when missing; not required at the storage level so
  // legacy todos created before this field existed still load.
  { id: "todo_priority", name: "priority", label: "Priorité (1-9)", kind: "number", min: 1, max: 9 },
  // Pastille importance — qualitative urgency. Distinct from `priority` (a
  // number for sorting); importance drives the colored dot at the row's
  // left edge and the "Mes priorités" widget filter.
  {
    id: "todo_importance", name: "importance", label: "Importance", kind: "select",
    options: [
      { value: "low", label: "Basse", color: "#22C55E" },
      { value: "medium", label: "Moyenne", color: "#FBBF24" },
      { value: "high", label: "Haute", color: "#F97316" },
      { value: "critical", label: "Critique", color: "#EF4444" },
    ],
  },
  // Rappel one-shot: l'engine génère automatiquement une AutomationConfig
  // `reminder:<id>` quand reminderAt est défini et reminderFiredAt vide. Une
  // fois fire, reminderFiredAt est écrit côté worker pour empêcher tout
  // rejeu (catch-up boot, hot reload, etc.).
  { id: "todo_reminder_at", name: "reminderAt", label: "Rappel — date/heure", kind: "datetime" },
  { id: "todo_reminder_text", name: "reminderText", label: "Rappel — message", kind: "longtext" },
  { id: "todo_reminder_fired_at", name: "reminderFiredAt", label: "Rappel envoyé le", kind: "datetime" },
  { id: "todo_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
  { id: "todo_updated_at", name: "updatedAt", label: "Modifié le", kind: "updatedAt" },
];

const goalFields: SeedField[] = [
  { id: "goal_name", name: "name", label: "Objectif", kind: "text", required: true },
  { id: "goal_target", name: "target_amount", label: "Montant cible", kind: "currency", currencyCode: "EUR" },
  { id: "goal_current", name: "current_amount", label: "Montant actuel", kind: "currency", currencyCode: "EUR" },
  { id: "goal_deadline", name: "deadline", label: "Échéance", kind: "date" },
  {
    id: "goal_status", name: "status", label: "Statut", kind: "select",
    options: [
      { value: "en_cours", label: "En cours", color: "#60A5FA" },
      { value: "atteint", label: "Atteint", color: "#10B981" },
      { value: "abandonne", label: "Abandonné", color: "#EF4444" },
    ],
  },
  { id: "goal_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
];

export const DEFAULT_ENTITY_TYPES: SeedEntityType[] = [
  { id: "personne", name: "Personne", plural: "Personnes", icon: "User", color: "#6366F1", fields: personneFields, defaultPath: "Contacts", fileNamePattern: "{name}" },
  { id: "organisation", name: "Organisation", plural: "Organisations", icon: "Building2", color: "#0EA5E9", fields: orgaFields, defaultPath: "Contacts/Organisations", fileNamePattern: "{name}" },
  { id: "interaction", name: "Interaction", plural: "Interactions", icon: "MessageCircle", color: "#10B981", fields: interactionFields, defaultPath: "Interactions", fileNamePattern: "{date}-{title}" },
  { id: "note", name: "Note", plural: "Notes", icon: "FileText", color: "#F59E0B", fields: noteFields, defaultPath: "Notes", fileNamePattern: "{title}" },
  { id: "daily", name: "Daily", plural: "Dailies", icon: "Calendar", color: "#EC4899", fields: dailyFields, defaultPath: "Daily", fileNamePattern: "{date}" },
  { id: "tag", name: "Tag", plural: "Tags", icon: "Tag", color: "#64748B", fields: tagFields, defaultPath: "Tags", fileNamePattern: "{name}" },
  { id: "account", name: "Account", plural: "Accounts", icon: "Wallet", color: "#4F8EF7", fields: accountFields, defaultPath: "Finance/Accounts", fileNamePattern: "{name}" },
  { id: "asset", name: "Asset", plural: "Assets", icon: "TrendingUp", color: "#10B981", fields: assetFields, defaultPath: "Finance/Assets", fileNamePattern: "{name}" },
  { id: "loan", name: "Loan", plural: "Loans", icon: "CreditCard", color: "#EF4444", fields: loanFields, defaultPath: "Finance/Loans", fileNamePattern: "{name}" },
  { id: "snapshot", name: "Snapshot", plural: "Snapshots", icon: "BarChart2", color: "#06B6D4", fields: snapshotFields, defaultPath: "Finance/Snapshots", fileNamePattern: "{date}" },
  { id: "goal", name: "Goal", plural: "Goals", icon: "Target", color: "#F97316", fields: goalFields, defaultPath: "Finance/Goals", fileNamePattern: "{name}" },
  { id: "canvas", name: "Canvas", plural: "Canvas", icon: "SquaresFour", color: "#0EA5E9", fields: canvasFields, defaultPath: "Canvas", fileNamePattern: "{name}" },
  { id: "routine", name: "Routine", plural: "Routines", icon: "Lightning", color: "#F59E0B", fields: routineFields, defaultPath: "Routines", fileNamePattern: "{name}" },
  { id: "todo", name: "Todo", plural: "Todos", icon: "CheckSquare", color: "#22C55E", fields: todoFields, defaultPath: "Todos", fileNamePattern: "{text}" },
];

export const DEFAULT_RELATION_TYPES: SeedRelationType[] = [
  { id: "rel_personne_org", forwardLabel: "travaille chez", inverseLabel: "emploie", sourceTypeId: "personne", targetTypeId: "organisation", cardinality: "many_to_many" },
  { id: "rel_interaction_personne", forwardLabel: "implique", inverseLabel: "a participé à", sourceTypeId: "interaction", targetTypeId: "personne", cardinality: "many_to_many" },
  { id: "rel_asset_account", forwardLabel: "détenu dans", inverseLabel: "contient", sourceTypeId: "asset", targetTypeId: "account", cardinality: "many_to_many" },
  { id: "rel_loan_asset", forwardLabel: "finance", inverseLabel: "financé par", sourceTypeId: "loan", targetTypeId: "asset", cardinality: "one_to_many" },
  { id: "rel_todo_note", forwardLabel: "extraite de", inverseLabel: "contient la todo", sourceTypeId: "todo", targetTypeId: "note", cardinality: "many_to_many" },
];

/**
 * Seed default entity types and relation types into the vault DB.
 * Idempotent: existing rows are left untouched (INSERT OR IGNORE).
 * Stable IDs (id = name) so callers can reference `typeId: "note"` directly.
 */
export function seedDefaults(db: Database, vaultId: string, ts: string): void {
  for (const t of DEFAULT_ENTITY_TYPES) {
    db.run(
      `INSERT OR IGNORE INTO entity_type
         (id, vaultId, name, plural, icon, color, fields,
          defaultPath, fileNamePattern,
          validations, workflowIds, isSystem, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 1, ?, ?)`,
      [
        t.id,
        vaultId,
        t.name,
        t.plural,
        t.icon,
        t.color,
        JSON.stringify(t.fields),
        t.defaultPath,
        t.fileNamePattern,
        ts,
        ts,
      ],
    );
  }

  for (const r of DEFAULT_RELATION_TYPES) {
    db.run(
      `INSERT OR IGNORE INTO relation_type
         (id, vaultId, forwardLabel, inverseLabel, sourceTypeId, targetTypeId,
          cardinality, fields, isSystem, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)`,
      [
        r.id,
        vaultId,
        r.forwardLabel,
        r.inverseLabel,
        r.sourceTypeId,
        r.targetTypeId,
        r.cardinality.toUpperCase(),
        ts,
        ts,
      ],
    );
  }
}
