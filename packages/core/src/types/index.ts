// ============================================================
// Core data model types for Supernote
// ============================================================

// ------ Field kinds ------------------------------------------

export type FieldKind =
  | "text"
  | "longtext"
  | "number"
  | "currency"
  | "percent"
  | "rating"
  | "progress"
  | "date"
  | "datetime"
  | "duration"
  | "bool"
  | "url"
  | "email"
  | "phone"
  | "select"
  | "multiselect"
  | "file"
  | "image"
  | "color"
  | "markdown"
  | "relation"
  | "formula"
  | "rollup"
  | "lookup"
  | "createdAt"
  | "updatedAt"
  | "createdBy"
  | "autoNumber"
  | "status";

// ------ Select option ----------------------------------------

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly color?: string;
}

// ------ Discriminated Field union ----------------------------

interface FieldBase {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
  readonly unique: boolean;
  readonly helpText?: string;
  readonly group?: string;
  readonly defaultValue?: FieldValue;
}

export interface TextField extends FieldBase {
  readonly kind: "text" | "longtext" | "url" | "email" | "phone" | "color" | "markdown";
}

export interface NumberField extends FieldBase {
  readonly kind: "number" | "currency" | "percent" | "rating" | "progress" | "duration" | "autoNumber";
  readonly min?: number;
  readonly max?: number;
  readonly precision?: number;
  readonly currencyCode?: string;
}

export interface DateField extends FieldBase {
  readonly kind: "date" | "datetime";
  readonly format?: string;
}

export interface BoolField extends FieldBase {
  readonly kind: "bool";
}

export interface SelectField extends FieldBase {
  readonly kind: "select" | "multiselect";
  readonly options: SelectOption[];
}

export interface FileField extends FieldBase {
  readonly kind: "file" | "image";
  readonly accept?: string[];
  readonly maxSize?: number;
}

export interface RelationField extends FieldBase {
  readonly kind: "relation";
  readonly targetTypeId: string;
  readonly cardinality: Cardinality;
  readonly relationTypeId?: string;
}

export interface FormulaField extends FieldBase {
  readonly kind: "formula";
  readonly expression: string;
  readonly outputKind: Exclude<FieldKind, "formula" | "rollup" | "lookup">;
  /** Pattern d'affichage : "number" → decimals, "currency" → EUR, "percent", "date:YYYY-MM-DD". */
  readonly outputFormat?: string;
}

export interface RollupField extends FieldBase {
  readonly kind: "rollup";
  readonly relationFieldId: string;
  readonly targetFieldId: string;
  readonly aggregation: "count" | "sum" | "avg" | "min" | "max" | "all" | "any";
}

export interface LookupField extends FieldBase {
  readonly kind: "lookup";
  readonly relationFieldId: string;
  readonly targetFieldId: string;
}

export interface AutoField extends FieldBase {
  readonly kind: "createdAt" | "updatedAt" | "createdBy";
}

export interface StatusField extends FieldBase {
  readonly kind: "status";
  readonly workflowId?: string;
  readonly options: SelectOption[];
}

/** Discriminated union of all field definitions */
export type Field =
  | TextField
  | NumberField
  | DateField
  | BoolField
  | SelectField
  | FileField
  | RelationField
  | FormulaField
  | RollupField
  | LookupField
  | AutoField
  | StatusField;

// ------ FieldValue -------------------------------------------

export type FieldValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | Date
  | undefined;

// ------ Cardinality ------------------------------------------

export type Cardinality = "one_to_one" | "one_to_many" | "many_to_many";

// ------ EntityType -------------------------------------------

export interface WorkflowState {
  readonly id: string;
  readonly name: string;
  readonly color?: string;
  readonly isInitial?: boolean;
  readonly isFinal?: boolean;
}

export interface WorkflowTransition {
  readonly fromStateId: string;
  readonly toStateId: string;
  readonly label?: string;
}

export interface Workflow {
  readonly id: string;
  readonly name: string;
  readonly states: WorkflowState[];
  readonly transitions: WorkflowTransition[];
}

export interface EntityType {
  readonly id: string;
  readonly name: string;
  readonly plural: string;
  readonly icon?: string;
  readonly color?: string;
  readonly fields: Field[];
  readonly defaultPath: string;
  readonly fileNamePattern: string;
  readonly validations?: ValidationRule[];
  readonly workflows?: Workflow[];
}

export interface ValidationRule {
  readonly fieldId: string;
  readonly rule: string;
  readonly message: string;
}

// ------ Entity -----------------------------------------------

export interface Entity {
  readonly id: string;
  readonly typeId: string;
  readonly filePath: string;
  readonly fields: Record<string, FieldValue>;
  readonly body: string;
  readonly fileHash?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lastEditedBy?: string;
  readonly tags?: string[];
}

export interface ValidEntity extends Entity {
  readonly _validated: true;
}

// ------ RelationType -----------------------------------------

export interface RelationType {
  readonly id: string;
  readonly forwardLabel: string;
  readonly inverseLabel: string;
  readonly sourceTypeId: string;
  readonly targetTypeId: string;
  readonly cardinality: Cardinality;
  readonly fields?: Field[];
}

// ------ RelationEdge -----------------------------------------

export interface RelationEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationTypeId: string;
  readonly fields?: Record<string, FieldValue>;
  readonly createdAt: Date;
}

// ------ Tags -------------------------------------------------

export interface Tag {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  /** Full hierarchical path, e.g. "client/important" */
  readonly path: string;
}

// ------ Mentions ---------------------------------------------

export type MentionType = "WIKILINK" | "EMBED" | "MENTION_ENTITY" | "TAG";

export interface Mention {
  readonly type: MentionType;
  /** Raw matched text, e.g. "[[01HX...]]" */
  readonly raw: string;
  /** Target ID or name */
  readonly target: string;
  /** Optional display alias, e.g. [[id|My Label]] */
  readonly alias?: string;
  /** Character offset in the body */
  readonly position?: { readonly start: number; readonly end: number };
}

// ------ Validation errors ------------------------------------

export interface ValidationError {
  readonly fieldId: string;
  readonly message: string;
  readonly received?: unknown;
}

// ------ Views (Coda/Notion-style projections of a Base) ------

export type ViewKind = "table" | "board" | "gallery" | "calendar" | "list";

export type RowHeight = "short" | "normal" | "tall";

export type FilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "is_empty"
  | "is_not_empty"
  | "in"
  | "not_in";

export interface FilterClause {
  readonly fieldId: string;
  readonly op: FilterOp;
  readonly value?: unknown;
}

export interface SortClause {
  readonly fieldId: string;
  readonly direction: "asc" | "desc";
}

/**
 * Saved or inline view of a Base (EntityType). Persisted in the `view`
 * SQLite table when named, embedded as JSON in a BlockNote `databaseView`
 * block when inline / ad-hoc.
 *
 * `visibleFields` is an ordered list of fieldIds that are shown — order
 * matters (defines column order in a table view). When empty, every field
 * of the EntityType is shown in its declaration order, minus those in
 * `hiddenFields`.
 */
export interface ViewDefinition {
  readonly id: string;
  readonly typeId: string;
  readonly name: string;
  readonly icon?: string;
  readonly kind: ViewKind;
  readonly filters: FilterClause[];
  readonly sorts: SortClause[];
  readonly visibleFields: string[];
  readonly hiddenFields: string[];
  readonly groupByField?: string;
  readonly rowHeight: RowHeight;
  readonly isSystem: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
