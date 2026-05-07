import type { SearchResult } from "@supernote/ipc";

// ---------------------------------------------------------------------------
// 80 synthetic search fixtures mixing all entity types
// ---------------------------------------------------------------------------

const TYPES = [
  { typeId: "note", typeName: "Note" },
  { typeId: "personne", typeName: "Personne" },
  { typeId: "projet", typeName: "Projet" },
  { typeId: "ressource", typeName: "Ressource" },
  { typeId: "journal", typeName: "Journal" },
] as const;

const TAGS_POOL = [
  "client", "urgent", "archive", "dev", "design", "IA", "finance",
  "réunion", "lecture", "idée", "productivité", "blog", "veille",
  "local-first", "typescript", "architecture", "confidentiel",
];

function pick<T>(arr: readonly T[], i: number): T {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return arr[i % arr.length]!;
}

function randomTags(seed: number): string[] {
  const count = seed % 3;
  return Array.from({ length: count }, (_, j) => pick(TAGS_POOL, seed + j * 7));
}

const TITLES: string[] = [
  "Réunion Q2 — Résumé",
  "Pierre Martin — Contact investisseur",
  "Projet Falcon — Brief produit",
  "Architecture Supernote v2",
  "Daily 2026-05-07",
  "Idées pour le blog PKM",
  "Veille IA — Mai 2026",
  "Sophie Durand — Designer UX",
  "Roadmap Q3 2026",
  "Notes conf LocalFirst",
  "Lecture : Deep Work",
  "Design system tokens",
  "Thomas Leclerc — Dev backend",
  "Projet Atlas — MVP",
  "Daily 2026-05-06",
  "Ressources TypeScript avancé",
  "Jean Dupont — CTO Startup",
  "Sprint planning semaine 19",
  "Budget marketing Q2",
  "Daily 2026-05-05",
  "Commandes Git utiles",
  "Marie Lambert — RH",
  "Projet Nexus — Phase 2",
  "Conférence WebSummit 2026",
  "Daily 2026-05-04",
  "Shortcodes Tailwind v4",
  "Antoine Moreau — Commercial",
  "Prototype interface 3D",
  "Analyse concurrentielle",
  "Daily 2026-05-03",
  "Recette : risotto champignons",
  "Laura Petit — Marketing",
  "Projet Genesis — Architecture",
  "Revue de code — PR #142",
  "Daily 2026-05-02",
  "Outils de productivité 2026",
  "François Bernard — Investisseur",
  "Atelier design thinking",
  "OKRs équipe produit",
  "Daily 2026-05-01",
  "Rétrospective sprint 18",
  "Clara Fontaine — Avocate",
  "Projet Horizon — Planning",
  "Notes lecture : Atomic Habits",
  "Daily 2026-04-30",
  "Raccourcis clavier Supernote",
  "Marc Leroy — Comptable",
  "Pitch deck Falcon v3",
  "Veille sécurité — Avril 2026",
  "Daily 2026-04-29",
  "API design patterns REST",
  "Isabelle Morin — Coach",
  "Projet Vega — KPIs",
  "Benchmark performances SQLite",
  "Daily 2026-04-28",
  "Landing page copy — Supernote",
  "Nicolas Girard — Product",
  "Projet Orion — Brief",
  "Tests e2e Playwright setup",
  "Daily 2026-04-27",
  "Stratégie contenu Q3",
  "Camille Roux — Designer",
  "Projet Polaris — Roadmap",
  "Migration base de données",
  "Daily 2026-04-26",
  "Revue contrats fournisseurs",
  "Julien Blanc — Dev fullstack",
  "Projet Sirius — Kick-off",
  "Documentation API interne",
  "Daily 2026-04-25",
  "Formation React avancé",
  "Amélie Dupuis — Commerciale",
  "Projet Luna — MVP spec",
  "Optimisation bundle Next.js",
  "Daily 2026-04-24",
  "Checklist lancement produit",
  "Romain Dubois — Investisseur",
  "Projet Sol — Brainstorm",
  "Monitoring & alerting setup",
  "Daily 2026-04-23",
];

const EXCERPTS: string[] = [
  "Objectifs du trimestre validés. Budget marketing augmenté de 15%.",
  "Contact établi lors du salon VivaTech. À relancer avant fin mai.",
  "Application de gestion de notes d'équipe. MVP en 3 mois.",
  "Monorepo Turborepo. Pattern vault-first : toutes les données sont des fichiers.",
  "Priorité 1 : finir la page notes. Soir : appel avec Marie.",
  "Sujets potentiels : second cerveau, outils de PKM, comparatif Obsidian vs Roam.",
  "Claude 4 toujours en tête sur les tâches de code. GPT-5 très fort.",
  "Spécialisée en design de systèmes complexes. Intéressée par la collaboration.",
  "Nouvelles fonctionnalités prévues : mode collaboratif, plugins API, export PDF.",
  "CRDTs vs OT : Automerge v3 stable. Talk de Martin Kleppmann sur les conflits.",
];

const FOLDERS = [
  "Inbox", "Notes/Projets", "Notes/Ressources", "Daily",
  "Contacts", "Projets", "Ressources",
];

export const FIXTURE_RESULTS: SearchResult[] = Array.from({ length: 80 }, (_, i) => {
  const typeEntry = pick(TYPES, i * 3 + 1);
  const title = TITLES[i] ?? `Entité ${i + 1}`;
  const excerpt = pick(EXCERPTS, i);
  const folder = pick(FOLDERS, i * 2 + 1);
  const score = Math.round((0.95 - (i * 0.008)) * 100) / 100;

  return {
    entityId: `entity-${i + 1}`,
    typeId: typeEntry.typeId,
    typeName: typeEntry.typeName,
    filePath: `${folder}/${title.replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, "").trim().slice(0, 30)}.md`,
    title,
    excerpts: [excerpt],
    score: Math.max(0.1, score),
    semantic: i % 5 === 0,
    tags: randomTags(i),
  };
});

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  note: "Notes",
  personne: "Personnes",
  projet: "Projets",
  ressource: "Ressources",
  journal: "Journal",
};
