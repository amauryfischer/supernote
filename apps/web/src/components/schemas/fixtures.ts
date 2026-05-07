import type { EntityType, RelationType, Field } from "@supernote/core";

// ---- Helper to build fields compactly ----
type FieldInput = Omit<Field, "required" | "unique"> & {
  required?: boolean;
  unique?: boolean;
};

function f(input: FieldInput): Field {
  return { required: false, unique: false, ...input } as Field;
}

// ---- Personne ----
const personneFields: Field[] = [
  f({ id: "per_name", name: "name", label: "Nom complet", kind: "text", required: true, unique: true }),
  f({ id: "per_email", name: "email", label: "Email", kind: "email", unique: true }),
  f({ id: "per_phone", name: "phone", label: "Téléphone", kind: "phone" }),
  f({ id: "per_company", name: "company", label: "Entreprise", kind: "text" }),
  f({ id: "per_role", name: "role", label: "Rôle", kind: "text" }),
  f({
    id: "per_status", name: "status", label: "Statut", kind: "select",
    options: [
      { value: "actif", label: "Actif", color: "#10B981" },
      { value: "inactif", label: "Inactif", color: "#94A3B8" },
      { value: "prospect", label: "Prospect", color: "#FBBF24" },
    ],
  } as FieldInput),
  f({ id: "per_linkedin", name: "linkedin", label: "LinkedIn", kind: "url" }),
  f({ id: "per_avatar", name: "avatar", label: "Photo", kind: "image" }),
  f({ id: "per_notes", name: "notes", label: "Notes", kind: "markdown" }),
  f({ id: "per_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" }),
  f({ id: "per_updated_at", name: "updatedAt", label: "Modifié le", kind: "updatedAt" }),
];

// ---- Organisation ----
const orgaFields: Field[] = [
  f({ id: "org_name", name: "name", label: "Nom", kind: "text", required: true, unique: true }),
  f({
    id: "org_type", name: "type", label: "Type", kind: "select",
    options: [
      { value: "startup", label: "Startup", color: "#A78BFA" },
      { value: "pme", label: "PME", color: "#60A5FA" },
      { value: "grand_groupe", label: "Grand groupe", color: "#34D399" },
      { value: "association", label: "Association", color: "#FBBF24" },
    ],
  } as FieldInput),
  f({ id: "org_website", name: "website", label: "Site web", kind: "url" }),
  f({ id: "org_sector", name: "sector", label: "Secteur", kind: "text" }),
  f({ id: "org_size", name: "size", label: "Taille", kind: "number" }),
  f({ id: "org_description", name: "description", label: "Description", kind: "longtext" }),
  f({ id: "org_logo", name: "logo", label: "Logo", kind: "image" }),
  f({ id: "org_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" }),
  f({ id: "org_updated_at", name: "updatedAt", label: "Modifié le", kind: "updatedAt" }),
];

// ---- Projet ----
const projetFields: Field[] = [
  f({ id: "proj_name", name: "name", label: "Nom", kind: "text", required: true }),
  f({
    id: "proj_status", name: "status", label: "Statut", kind: "status",
    options: [
      { value: "backlog", label: "Backlog", color: "#94A3B8" },
      { value: "en_cours", label: "En cours", color: "#60A5FA" },
      { value: "en_pause", label: "En pause", color: "#FBBF24" },
      { value: "termine", label: "Terminé", color: "#10B981" },
      { value: "annule", label: "Annulé", color: "#EF4444" },
    ],
  } as FieldInput),
  f({ id: "proj_start", name: "start_date", label: "Début", kind: "date" }),
  f({ id: "proj_end", name: "end_date", label: "Fin prévue", kind: "date" }),
  f({ id: "proj_priority", name: "priority", label: "Priorité", kind: "rating", min: 1, max: 5 } as FieldInput),
  f({ id: "proj_budget", name: "budget", label: "Budget", kind: "currency", currencyCode: "EUR" } as FieldInput),
  f({ id: "proj_progress", name: "progress", label: "Avancement", kind: "progress" }),
  f({ id: "proj_description", name: "description", label: "Description", kind: "markdown" }),
  f({ id: "proj_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" }),
  f({ id: "proj_updated_at", name: "updatedAt", label: "Modifié le", kind: "updatedAt" }),
];

// ---- Interaction ----
const interactionFields: Field[] = [
  f({ id: "int_title", name: "title", label: "Titre", kind: "text", required: true }),
  f({
    id: "int_type", name: "type", label: "Type", kind: "select",
    options: [
      { value: "email", label: "Email", color: "#60A5FA" },
      { value: "appel", label: "Appel", color: "#34D399" },
      { value: "reunion", label: "Réunion", color: "#A78BFA" },
      { value: "message", label: "Message", color: "#FBBF24" },
    ],
  } as FieldInput),
  f({ id: "int_date", name: "date", label: "Date", kind: "datetime" }),
  f({ id: "int_duration", name: "duration", label: "Durée (min)", kind: "number" }),
  f({ id: "int_summary", name: "summary", label: "Résumé", kind: "longtext" }),
  f({ id: "int_next_action", name: "next_action", label: "Prochaine action", kind: "text" }),
  f({ id: "int_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" }),
];

// ---- Note ----
const noteFields: Field[] = [
  f({ id: "note_title", name: "title", label: "Titre", kind: "text", required: true }),
  f({ id: "note_body", name: "body", label: "Contenu", kind: "markdown" }),
  f({
    id: "note_type", name: "type", label: "Type", kind: "select",
    options: [
      { value: "note", label: "Note", color: "#60A5FA" },
      { value: "ressource", label: "Ressource", color: "#34D399" },
      { value: "idee", label: "Idée", color: "#FBBF24" },
    ],
  } as FieldInput),
  f({ id: "note_pinned", name: "pinned", label: "Épinglée", kind: "bool" }),
  f({ id: "note_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" }),
  f({ id: "note_updated_at", name: "updatedAt", label: "Modifié le", kind: "updatedAt" }),
];

// ---- Daily ----
const dailyFields: Field[] = [
  f({ id: "daily_date", name: "date", label: "Date", kind: "date", required: true, unique: true }),
  f({ id: "daily_body", name: "body", label: "Journal", kind: "markdown" }),
  f({
    id: "daily_mood", name: "mood", label: "Humeur", kind: "rating", min: 1, max: 5,
  } as FieldInput),
  f({
    id: "daily_energy", name: "energy", label: "Energie", kind: "select",
    options: [
      { value: "high", label: "Haute", color: "#10B981" },
      { value: "medium", label: "Moyenne", color: "#FBBF24" },
      { value: "low", label: "Basse", color: "#EF4444" },
    ],
  } as FieldInput),
  f({ id: "daily_gratitude", name: "gratitude", label: "Gratitude", kind: "longtext" }),
  f({ id: "daily_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" }),
];

// ---- Tag ----
const tagFields: Field[] = [
  f({ id: "tag_name", name: "name", label: "Nom", kind: "text", required: true, unique: true }),
  f({ id: "tag_color", name: "color", label: "Couleur", kind: "color" }),
  f({ id: "tag_description", name: "description", label: "Description", kind: "text" }),
  f({ id: "tag_parent", name: "parent", label: "Parent", kind: "relation", targetTypeId: "tag", cardinality: "one_to_many" } as FieldInput),
];

// ---- Account (finance) ----
const accountFields: Field[] = [
  f({ id: "acc_name", name: "name", label: "Nom du compte", kind: "text", required: true }),
  f({
    id: "acc_kind", name: "kind", label: "Type", kind: "select",
    options: [
      { value: "checking", label: "Courant", color: "#60A5FA" },
      { value: "savings", label: "Épargne", color: "#34D399" },
      { value: "pea", label: "PEA", color: "#FBBF24" },
      { value: "crypto", label: "Crypto", color: "#F59E0B" },
    ],
  } as FieldInput),
  f({ id: "acc_balance", name: "current_balance", label: "Solde actuel", kind: "currency", currencyCode: "EUR" } as FieldInput),
  f({ id: "acc_iban", name: "iban", label: "IBAN", kind: "text" }),
  f({ id: "acc_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" }),
];

// ---- Asset (finance) ----
const assetFields: Field[] = [
  f({ id: "ast_name", name: "name", label: "Nom", kind: "text", required: true }),
  f({
    id: "ast_category", name: "category", label: "Catégorie", kind: "select",
    options: [
      { value: "immo", label: "Immobilier", color: "#7C3AED" },
      { value: "action", label: "Action", color: "#2563EB" },
      { value: "crypto", label: "Crypto", color: "#D97706" },
      { value: "fond", label: "Fonds", color: "#0891B2" },
    ],
  } as FieldInput),
  f({ id: "ast_value", name: "current_value", label: "Valeur actuelle", kind: "currency", currencyCode: "EUR" } as FieldInput),
  f({ id: "ast_acquisition", name: "acquisition_value", label: "Valeur d'acquisition", kind: "currency", currencyCode: "EUR" } as FieldInput),
  f({ id: "ast_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" }),
];

// ---- Loan (finance) ----
const loanFields: Field[] = [
  f({ id: "loan_name", name: "name", label: "Nom", kind: "text", required: true }),
  f({ id: "loan_amount", name: "amount", label: "Montant", kind: "currency", currencyCode: "EUR" } as FieldInput),
  f({ id: "loan_rate", name: "rate", label: "Taux (%)", kind: "percent" }),
  f({ id: "loan_start", name: "start_date", label: "Début", kind: "date" }),
  f({ id: "loan_end", name: "end_date", label: "Fin", kind: "date" }),
  f({ id: "loan_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" }),
];

// ---- Snapshot (finance) ----
const snapshotFields: Field[] = [
  f({ id: "snap_date", name: "date", label: "Date", kind: "date", required: true }),
  f({ id: "snap_net_worth", name: "net_worth", label: "Patrimoine net", kind: "currency", currencyCode: "EUR" } as FieldInput),
  f({ id: "snap_total_assets", name: "total_assets", label: "Total actifs", kind: "currency", currencyCode: "EUR" } as FieldInput),
  f({ id: "snap_total_debts", name: "total_debts", label: "Total dettes", kind: "currency", currencyCode: "EUR" } as FieldInput),
  f({ id: "snap_notes", name: "notes", label: "Notes", kind: "longtext" }),
  f({ id: "snap_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" }),
];

// ---- Goal (finance) ----
const goalFields: Field[] = [
  f({ id: "goal_name", name: "name", label: "Objectif", kind: "text", required: true }),
  f({ id: "goal_target", name: "target_amount", label: "Montant cible", kind: "currency", currencyCode: "EUR" } as FieldInput),
  f({ id: "goal_current", name: "current_amount", label: "Montant actuel", kind: "currency", currencyCode: "EUR" } as FieldInput),
  f({ id: "goal_deadline", name: "deadline", label: "Échéance", kind: "date" }),
  f({
    id: "goal_status", name: "status", label: "Statut", kind: "select",
    options: [
      { value: "en_cours", label: "En cours", color: "#60A5FA" },
      { value: "atteint", label: "Atteint", color: "#10B981" },
      { value: "abandonne", label: "Abandonné", color: "#EF4444" },
    ],
  } as FieldInput),
  f({ id: "goal_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" }),
];

// ---- EntityTypes ----
export const ENTITY_TYPES: EntityType[] = [
  {
    id: "personne",
    name: "Personne",
    plural: "Personnes",
    icon: "User",
    color: "#6366F1",
    fields: personneFields,
    defaultPath: "/Contacts",
    fileNamePattern: "{name}",
    defaultView: "table",
  },
  {
    id: "organisation",
    name: "Organisation",
    plural: "Organisations",
    icon: "Building2",
    color: "#0EA5E9",
    fields: orgaFields,
    defaultPath: "/Contacts/Organisations",
    fileNamePattern: "{name}",
    defaultView: "table",
  },
  {
    id: "projet",
    name: "Projet",
    plural: "Projets",
    icon: "Layers",
    color: "#8B5CF6",
    fields: projetFields,
    defaultPath: "/Projets",
    fileNamePattern: "{name}",
    defaultView: "kanban",
  },
  {
    id: "interaction",
    name: "Interaction",
    plural: "Interactions",
    icon: "MessageCircle",
    color: "#10B981",
    fields: interactionFields,
    defaultPath: "/Interactions",
    fileNamePattern: "{date}-{title}",
    defaultView: "table",
  },
  {
    id: "note",
    name: "Note",
    plural: "Notes",
    icon: "FileText",
    color: "#F59E0B",
    fields: noteFields,
    defaultPath: "/Notes",
    fileNamePattern: "{title}",
    defaultView: "table",
  },
  {
    id: "daily",
    name: "Daily",
    plural: "Dailies",
    icon: "Calendar",
    color: "#EC4899",
    fields: dailyFields,
    defaultPath: "/Daily",
    fileNamePattern: "{date}",
    defaultView: "calendar",
  },
  {
    id: "tag",
    name: "Tag",
    plural: "Tags",
    icon: "Tag",
    color: "#64748B",
    fields: tagFields,
    defaultPath: "/Tags",
    fileNamePattern: "{name}",
    defaultView: "table",
  },
  {
    id: "account",
    name: "Account",
    plural: "Accounts",
    icon: "Wallet",
    color: "#4F8EF7",
    fields: accountFields,
    defaultPath: "/Finance/Accounts",
    fileNamePattern: "{name}",
    defaultView: "table",
  },
  {
    id: "asset",
    name: "Asset",
    plural: "Assets",
    icon: "TrendingUp",
    color: "#10B981",
    fields: assetFields,
    defaultPath: "/Finance/Assets",
    fileNamePattern: "{name}",
    defaultView: "table",
  },
  {
    id: "loan",
    name: "Loan",
    plural: "Loans",
    icon: "CreditCard",
    color: "#EF4444",
    fields: loanFields,
    defaultPath: "/Finance/Loans",
    fileNamePattern: "{name}",
    defaultView: "table",
  },
  {
    id: "snapshot",
    name: "Snapshot",
    plural: "Snapshots",
    icon: "BarChart2",
    color: "#06B6D4",
    fields: snapshotFields,
    defaultPath: "/Finance/Snapshots",
    fileNamePattern: "{date}",
    defaultView: "table",
  },
  {
    id: "goal",
    name: "Goal",
    plural: "Goals",
    icon: "Target",
    color: "#F97316",
    fields: goalFields,
    defaultPath: "/Finance/Goals",
    fileNamePattern: "{name}",
    defaultView: "table",
  },
];

// ---- RelationTypes ----
export const RELATION_TYPES: RelationType[] = [
  {
    id: "rel_personne_org",
    forwardLabel: "travaille chez",
    inverseLabel: "emploie",
    sourceTypeId: "personne",
    targetTypeId: "organisation",
    cardinality: "many_to_many",
  },
  {
    id: "rel_personne_projet",
    forwardLabel: "contribue à",
    inverseLabel: "a pour contributeur",
    sourceTypeId: "personne",
    targetTypeId: "projet",
    cardinality: "many_to_many",
  },
  {
    id: "rel_interaction_personne",
    forwardLabel: "implique",
    inverseLabel: "a participé à",
    sourceTypeId: "interaction",
    targetTypeId: "personne",
    cardinality: "many_to_many",
  },
  {
    id: "rel_interaction_projet",
    forwardLabel: "concerne",
    inverseLabel: "a pour interaction",
    sourceTypeId: "interaction",
    targetTypeId: "projet",
    cardinality: "many_to_many",
  },
  {
    id: "rel_note_projet",
    forwardLabel: "associée à",
    inverseLabel: "a pour note",
    sourceTypeId: "note",
    targetTypeId: "projet",
    cardinality: "many_to_many",
  },
  {
    id: "rel_asset_account",
    forwardLabel: "détenu dans",
    inverseLabel: "contient",
    sourceTypeId: "asset",
    targetTypeId: "account",
    cardinality: "many_to_many",
  },
  {
    id: "rel_loan_asset",
    forwardLabel: "finance",
    inverseLabel: "financé par",
    sourceTypeId: "loan",
    targetTypeId: "asset",
    cardinality: "one_to_many",
  },
  {
    id: "rel_org_projet",
    forwardLabel: "sponsor de",
    inverseLabel: "sponsorisé par",
    sourceTypeId: "organisation",
    targetTypeId: "projet",
    cardinality: "many_to_many",
  },
];

// ---- Mock entity counts ----
export const ENTITY_COUNTS: Record<string, number> = {
  personne: 42,
  organisation: 18,
  projet: 12,
  interaction: 87,
  note: 156,
  daily: 94,
  tag: 23,
  account: 7,
  asset: 14,
  loan: 3,
  snapshot: 48,
  goal: 5,
};

// ---- Field kind metadata ----
export interface FieldKindMeta {
  kind: string;
  label: string;
  group: string;
  icon: string;
}

export const FIELD_KINDS: FieldKindMeta[] = [
  // Text
  { kind: "text", label: "Texte court", group: "Texte", icon: "Type" },
  { kind: "longtext", label: "Texte long", group: "Texte", icon: "AlignLeft" },
  { kind: "markdown", label: "Markdown", group: "Texte", icon: "FileText" },
  { kind: "url", label: "URL", group: "Texte", icon: "Link" },
  { kind: "email", label: "Email", group: "Texte", icon: "Mail" },
  { kind: "phone", label: "Téléphone", group: "Texte", icon: "Phone" },
  { kind: "color", label: "Couleur", group: "Texte", icon: "Palette" },
  // Numbers
  { kind: "number", label: "Nombre", group: "Nombres", icon: "Hash" },
  { kind: "currency", label: "Monnaie", group: "Nombres", icon: "DollarSign" },
  { kind: "percent", label: "Pourcentage", group: "Nombres", icon: "Percent" },
  { kind: "rating", label: "Note", group: "Nombres", icon: "Star" },
  { kind: "progress", label: "Progression", group: "Nombres", icon: "TrendingUp" },
  { kind: "duration", label: "Durée", group: "Nombres", icon: "Clock" },
  // Date/time
  { kind: "date", label: "Date", group: "Date & Heure", icon: "Calendar" },
  { kind: "datetime", label: "Date & Heure", group: "Date & Heure", icon: "CalendarClock" },
  // Boolean
  { kind: "bool", label: "Booléen", group: "Sélection", icon: "ToggleLeft" },
  { kind: "select", label: "Sélection", group: "Sélection", icon: "ListChecks" },
  { kind: "multiselect", label: "Multi-sélection", group: "Sélection", icon: "CheckSquare" },
  { kind: "status", label: "Statut", group: "Sélection", icon: "CircleDot" },
  // Media
  { kind: "file", label: "Fichier", group: "Médias", icon: "Paperclip" },
  { kind: "image", label: "Image", group: "Médias", icon: "Image" },
  // Computed
  { kind: "formula", label: "Formule", group: "Calculé", icon: "FunctionSquare" },
  { kind: "rollup", label: "Rollup", group: "Calculé", icon: "Sigma" },
  { kind: "lookup", label: "Lookup", group: "Calculé", icon: "Search" },
  // Auto
  { kind: "relation", label: "Relation", group: "Liaison", icon: "Link2" },
  { kind: "createdAt", label: "Date création", group: "Auto", icon: "CalendarPlus" },
  { kind: "updatedAt", label: "Date modif.", group: "Auto", icon: "CalendarCheck" },
  { kind: "createdBy", label: "Créé par", group: "Auto", icon: "UserPlus" },
  { kind: "autoNumber", label: "Auto-numéro", group: "Auto", icon: "ListOrdered" },
];

export function getEntityTypeById(id: string): EntityType | undefined {
  return ENTITY_TYPES.find((t) => t.id === id);
}

export function getRelationsForType(typeId: string): RelationType[] {
  return RELATION_TYPES.filter(
    (r) => r.sourceTypeId === typeId || r.targetTypeId === typeId
  );
}
