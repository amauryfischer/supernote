/**
 * Demo fixtures for contacts — used by the "Charger des exemples (démo)" button in Settings > Backup.
 * These are NOT loaded by default. The app starts empty.
 */
import type { Contact, Organisation, Interaction } from "./fixtures";

export const DEMO_ORGANISATIONS: Organisation[] = [
  { id: "org-1", name: "Acme Corp", industry: "Technologie", website: "https://acme.example" },
  { id: "org-2", name: "Studio Lumière", industry: "Design & Créatif", website: "https://lumiere.example" },
  { id: "org-3", name: "BioSanté", industry: "Santé", website: "https://biosante.example" },
  { id: "org-4", name: "FinTech SA", industry: "Finance", website: "https://fintech.example" },
];

export const DEMO_CONTACTS: Contact[] = [
  {
    id: "c-001",
    name: "Alice Martin",
    emails: [{ value: "alice.martin@acme.example", label: "pro" }],
    phones: [{ value: "+33 6 12 34 56 78", label: "mobile" }],
    organisationId: "org-1",
    relationType: "collègue",
    birthday: "1988-04-15",
    tags: ["product", "ux"],
    aliases: [],
    social: { linkedin: "https://linkedin.com/in/alice-martin" },
    notes: "## Alice Martin\n\nResponsable produit chez Acme.",
    lastInteractionDate: "2026-04-28",
  },
  {
    id: "c-002",
    name: "Baptiste Leroy",
    emails: [{ value: "baptiste@freelance.fr", label: "perso" }],
    phones: [{ value: "+33 7 22 33 44 55", label: "mobile" }],
    organisationId: "org-2",
    relationType: "ami",
    birthday: "1990-07-22",
    tags: ["design", "freelance"],
    aliases: [],
    social: { twitter: "https://twitter.com/baptiste_l" },
    notes: "## Baptiste Leroy\n\nDesigner freelance.",
    lastInteractionDate: "2026-05-01",
  },
  {
    id: "c-003",
    name: "Camille Dupont",
    emails: [{ value: "c.dupont@biosante.fr", label: "pro" }],
    phones: [{ value: "+33 6 55 44 33 22", label: "mobile" }],
    organisationId: "org-3",
    relationType: "client",
    birthday: "1975-12-03",
    tags: ["healthcare", "b2b"],
    aliases: [],
    social: { linkedin: "https://linkedin.com/in/camille-dupont" },
    notes: "## Camille Dupont\n\nDSI de BioSanté.",
    lastInteractionDate: "2026-04-10",
  },
  {
    id: "c-004",
    name: "David Chen",
    emails: [{ value: "d.chen@fintech.sa", label: "pro" }],
    phones: [{ value: "+33 6 98 76 54 32", label: "mobile" }],
    organisationId: "org-4",
    relationType: "partenaire",
    birthday: "1983-09-08",
    tags: ["fintech", "investisseur"],
    aliases: [],
    social: { linkedin: "https://linkedin.com/in/david-chen-fin" },
    notes: "## David Chen\n\nDirecteur des partenariats chez FinTech SA.",
    lastInteractionDate: "2026-04-20",
  },
];

export const DEMO_INTERACTIONS: Interaction[] = [
  { id: "i-001", contactId: "c-001", date: "2026-04-28", kind: "réunion", title: "Revue roadmap Q3", notes: "Alignement sur les priorités UX pour Q3." },
  { id: "i-002", contactId: "c-002", date: "2026-05-01", kind: "déjeuner", title: "Déjeuner Bordeaux", notes: "Parlé du projet identité visuelle." },
  { id: "i-003", contactId: "c-003", date: "2026-04-10", kind: "réunion", title: "Point contrat annuel", notes: "Camille veut ajouter 2 licences." },
  { id: "i-004", contactId: "c-004", date: "2026-04-20", kind: "réunion", title: "Présentation due diligence", notes: "David a apprécié les métriques." },
];
