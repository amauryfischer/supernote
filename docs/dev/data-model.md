# Data model

## Vue d'ensemble

Le schéma Prisma est défini dans `packages/db/prisma/schema.prisma`. Toutes les tables vivent dans `index.db` (SQLite), dans le vault de l'utilisateur.

---

## Tables principales

### Vault

Configuration du vault ouvert. Une seule ligne active.

```prisma
model Vault {
  id          String   @id @default(cuid())
  path        String   @unique          // chemin absolu du vault
  name        String
  createdAt   DateTime @default(now())
  lastOpenedAt DateTime @updatedAt
}
```

---

### EntityType — Le schéma d'un type d'entité

```prisma
model EntityType {
  id              String    @id @default(cuid())
  name            String    @unique          // "personne", "projet"...
  plural          String                     // "personnes", "projets"
  icon            String?                    // nom d'icône Lucide
  color           String?                    // couleur hex
  defaultPath     String?                    // "Contacts/"
  fileNamePattern String?                    // "{{name}}.md"
  defaultView     String?                    // "table" | "gallery" | ...
  fields          Field[]
  entities        Entity[]
  sourceRelations RelationType[] @relation("SourceType")
  targetRelations RelationType[] @relation("TargetType")
  workflows       Workflow[]
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

---

### Field — Un champ d'un EntityType

```prisma
model Field {
  id           String    @id @default(cuid())
  entityTypeId String
  entityType   EntityType @relation(fields: [entityTypeId], references: [id])
  name         String
  label        String                        // affiché en UI
  type         FieldType
  options      Json?                         // pour select: [{value, label, color}]
  defaultValue Json?
  required     Boolean   @default(false)
  unique       Boolean   @default(false)
  helpText     String?
  group        String?                       // groupement dans l'UI
  order        Int       @default(0)
  hidden       Boolean   @default(false)
  formulaExpr  String?                       // pour type = formula
  rollupConfig Json?                         // pour type = rollup
  validation   Json?                         // rules: [{rule, message}]
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}

enum FieldType {
  text
  longtext
  number
  currency
  percent
  rating
  progress
  date
  datetime
  duration
  bool
  url
  email
  phone
  select
  multiselect
  file
  image
  color
  markdown
  relation
  formula
  rollup
  lookup
  createdAt
  updatedAt
  createdBy
  autoNumber
  status
}
```

---

### RelationType — Un type de relation entre EntityTypes

```prisma
model RelationType {
  id            String    @id @default(cuid())
  forwardLabel  String                    // "travaille chez"
  inverseLabel  String                    // "emploie"
  sourceTypeId  String
  sourceType    EntityType @relation("SourceType", ...)
  targetTypeId  String
  targetType    EntityType @relation("TargetType", ...)
  cardinality   Cardinality               // ONE_TO_ONE | ONE_TO_MANY | MANY_TO_MANY
  fields        Json?                     // champs portés par la relation
  edges         RelationEdge[]
  createdAt     DateTime  @default(now())
}

enum Cardinality {
  ONE_TO_ONE
  ONE_TO_MANY
  MANY_TO_MANY
}
```

---

### Entity — Une instance d'entité

```prisma
model Entity {
  id           String    @id                // ULID
  typeId       String
  type         EntityType @relation(...)
  filePath     String    @unique            // chemin relatif dans le vault
  fields       Json                         // valeurs des champs dynamiques
  body         String    @default("")       // corps markdown
  fileHash     String?                      // SHA256 du fichier pour sync
  astCache     Json?                        // AST parsé (invalidé à chaque save)
  lastEditedBy String?                      // "user" | "external" | "automation"
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  tags         EntityTag[]
  mentions     Mention[]  @relation("SourceMentions")
  mentionedBy  Mention[]  @relation("TargetMentions")
  sourceEdges  RelationEdge[] @relation("SourceEdges")
  targetEdges  RelationEdge[] @relation("TargetEdges")
  embedding    Embedding?
  gitCommits   GitCommit[]
}
```

**Notes :**
- `id` est un ULID (pas un UUID) — lexicographiquement trié, plus court
- `fields` est un JSON — structure validée par le `EntityType` au save
- Le fichier `.md` est la source de vérité. `Entity` est un miroir.

---

### RelationEdge — Une instance de relation

```prisma
model RelationEdge {
  id             String    @id @default(cuid())
  sourceId       String
  source         Entity    @relation("SourceEdges", ...)
  targetId       String
  target         Entity    @relation("TargetEdges", ...)
  relationTypeId String
  relationType   RelationType @relation(...)
  fields         Json?                  // champs portés (ex: "depuis" sur "travaille chez")
  createdAt      DateTime  @default(now())

  @@unique([sourceId, targetId, relationTypeId])
}
```

---

### Mention — Liens détectés dans le body

```prisma
model Mention {
  id          String      @id @default(cuid())
  sourceId    String                            // entité qui contient la mention
  source      Entity      @relation("SourceMentions", ...)
  targetId    String?                           // entité mentionnée (si résolue)
  target      Entity?     @relation("TargetMentions", ...)
  targetPath  String?                           // path brut si non-résolu
  type        MentionType
  line        Int?
  col         Int?

  @@index([targetId])
}

enum MentionType {
  wikilink      // [[Note]]
  embed         // ![[Note]]
  mention       // @Personne
  tag           // #tag
  blockRef      // ^block-id
}
```

---

### Embedding — Vecteurs sémantiques

```prisma
model Embedding {
  entityId    String  @id
  entity      Entity  @relation(...)
  vector      Bytes                    // JSON array sérialisé (384 dims)
  model       String  @default("all-MiniLM-L6-v2")
  contentHash String                   // hash du contenu au moment du calcul
  updatedAt   DateTime @updatedAt
}
```

Stocké en JSON BLOB. Cosine similarity calculée en JS dans le worker (pas d'extension sqlite-vec nécessaire pour <50k entités).

---

### Automation et AutomationRun

```prisma
model Automation {
  id          String   @id @default(cuid())
  name        String
  description String?
  filePath    String   @unique          // .supernote/automations/xxx.yaml
  enabled     Boolean  @default(true)
  trigger     Json                      // { type, ...config }
  conditions  Json     @default("[]")
  actions     Json                      // [{ type, ...config }]
  lastRunAt   DateTime?
  runs        AutomationRun[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model AutomationRun {
  id           String    @id @default(cuid())
  automationId String
  automation   Automation @relation(...)
  triggeredAt  DateTime
  status       RunStatus
  durationMs   Int?
  payload      Json?
  error        String?
}

enum RunStatus {
  success
  failure
  skipped
}
```

---

### View — Vue sauvegardée

```prisma
model View {
  id          String   @id @default(cuid())
  name        String
  entityTypeId String?                   // null = requête cross-type
  type        ViewType
  filters     Json     @default("[]")
  sort        Json?
  groupBy     String?
  columns     Json?
  filePath    String   @unique           // .supernote/views/xxx.json
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum ViewType {
  table
  kanban
  gallery
  calendar
  timeline
  graph
  map
  dashboard
}
```

---

## Schéma dynamique

La particularité de Supernote est que le schéma des entités est **entièrement défini par l'utilisateur** via `EntityType` et `Field`. Le champ `Entity.fields` est un JSON libre, validé au runtime par Zod.

Le `SchemaEngine` dans `@supernote/core` :
1. Charge les `EntityType` + `Field` depuis la DB
2. Génère un schéma Zod dynamique pour chaque type
3. Valide `entity.fields` à chaque save
4. En cas d'échec de validation : propose un "auto-fix" (ex : cast de type, valeur par défaut)

### Registry de types de champs

```typescript
// packages/core/src/field-registry.ts
const FIELD_TYPE_REGISTRY: Record<FieldType, FieldTypeDefinition> = {
  text: {
    serialize: (v) => String(v),
    deserialize: (v) => String(v),
    validate: z.string(),
    filterOperators: ['eq', 'neq', 'contains', 'startsWith', 'isEmpty'],
    sortComparator: (a, b) => a.localeCompare(b),
  },
  // ... un entry par FieldType
};
```

Ce registry est la source canonique. Ajouter un nouveau type de champ = ajouter une entrée ici.

---

## Migration de schéma

Quand un `Field` est supprimé d'un `EntityType`, les valeurs existantes dans `Entity.fields` sont conservées comme "champs orphelins" (affichés en JSON brut, réattachables). Jamais de suppression silencieuse.

Quand un `Field` est renommé : utilise l'outil "Renommer un champ" dans le Schema Editor — Supernote met à jour `Entity.fields` pour toutes les entités du type.

Migration Prisma pour les colonnes structurelles :

```bash
pnpm --filter @supernote/db prisma migrate dev --name "add_gitcommit_table"
```
