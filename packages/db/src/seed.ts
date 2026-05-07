/**
 * Seed script — creates default EntityType seeds for a fresh vault.
 *
 * Usage: pnpm --filter @supernote/db db:seed
 *
 * The seed is intentionally minimal; field definitions will be refined
 * during iterative development (see spec section 12 — Décisions ouvertes).
 */
import { ulid } from "ulid";
import { createClient } from "./client.js";

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "file:./prisma/dev.db";

const DEFAULT_VAULT_ID = "01SEED_VAULT_000000000000";

/** Placeholder for a field definition. Full FieldDefinition type TBD in core. */
interface SimpleField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
}

interface SeedEntityType {
  name: string;
  plural: string;
  icon: string;
  color: string;
  defaultPath: string;
  fields: SimpleField[];
}

const SEED_ENTITY_TYPES: SeedEntityType[] = [
  {
    name: "Note",
    plural: "Notes",
    icon: "file-text",
    color: "#6366f1",
    defaultPath: "Notes/",
    fields: [
      { key: "title", label: "Titre", type: "text", required: true },
      { key: "summary", label: "Résumé", type: "longtext" },
    ],
  },
  {
    name: "Personne",
    plural: "Personnes",
    icon: "user",
    color: "#10b981",
    defaultPath: "Contacts/",
    fields: [
      { key: "name", label: "Nom", type: "text", required: true },
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Téléphone", type: "phone" },
      { key: "birthday", label: "Date de naissance", type: "date" },
      { key: "employer", label: "Employeur", type: "relation" },
    ],
  },
  {
    name: "Organisation",
    plural: "Organisations",
    icon: "building",
    color: "#f59e0b",
    defaultPath: "Organisations/",
    fields: [
      { key: "name", label: "Nom", type: "text", required: true },
      { key: "website", label: "Site web", type: "url" },
      { key: "industry", label: "Secteur", type: "text" },
    ],
  },
  {
    name: "Projet",
    plural: "Projets",
    icon: "folder",
    color: "#3b82f6",
    defaultPath: "Projets/",
    fields: [
      { key: "name", label: "Nom", type: "text", required: true },
      { key: "status", label: "Statut", type: "status" },
      { key: "startDate", label: "Début", type: "date" },
      { key: "dueDate", label: "Échéance", type: "date" },
    ],
  },
  {
    name: "Interaction",
    plural: "Interactions",
    icon: "message-circle",
    color: "#8b5cf6",
    defaultPath: "Interactions/",
    fields: [
      { key: "title", label: "Titre", type: "text", required: true },
      { key: "date", label: "Date", type: "datetime", required: true },
      { key: "kind", label: "Type", type: "select" },
      { key: "participants", label: "Participants", type: "relation" },
    ],
  },
  {
    name: "Daily",
    plural: "Dailies",
    icon: "calendar",
    color: "#ec4899",
    defaultPath: "Daily/",
    fields: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "mood", label: "Humeur", type: "rating" },
    ],
  },
  {
    name: "Tag",
    plural: "Tags",
    icon: "tag",
    color: "#64748b",
    defaultPath: ".supernote/tags/",
    fields: [
      { key: "path", label: "Chemin", type: "text", required: true },
      { key: "description", label: "Description", type: "longtext" },
    ],
  },
];

async function seed(): Promise<void> {
  const client = createClient(DATABASE_URL);

  try {
    // Upsert the default vault so seed can run standalone
    await client.vault.upsert({
      where: { id: DEFAULT_VAULT_ID },
      update: {},
      create: {
        id: DEFAULT_VAULT_ID,
        name: "Mon vault",
        rootPath: process.env["VAULT_ROOT"] ?? "~/Notes",
      },
    });

    for (const seed of SEED_ENTITY_TYPES) {
      const existing = await client.entityType.findFirst({
        where: { vaultId: DEFAULT_VAULT_ID, name: seed.name },
      });

      if (existing) {
        console.log(`  [skip] EntityType "${seed.name}" already exists`);
        continue;
      }

      await client.entityType.create({
        data: {
          id: ulid(),
          vaultId: DEFAULT_VAULT_ID,
          name: seed.name,
          plural: seed.plural,
          icon: seed.icon,
          color: seed.color,
          defaultPath: seed.defaultPath,
          fields: JSON.stringify(seed.fields),
          isSystem: true,
        },
      });
      console.log(`  [created] EntityType "${seed.name}"`);
    }

    console.log("Seed completed successfully.");
  } finally {
    await client.$disconnect();
  }
}

seed().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
