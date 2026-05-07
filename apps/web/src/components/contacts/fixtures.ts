/**
 * Mock data for the Contacts CRM page.
 * 25 contacts, 8 organisations, 30 interactions.
 */

export type RelationType =
  | "ami"
  | "famille"
  | "collègue"
  | "client"
  | "mentor"
  | "connaissance"
  | "partenaire";

export type InteractionKind =
  | "réunion"
  | "appel"
  | "email"
  | "déjeuner"
  | "message"
  | "note";

export interface Organisation {
  id: string;
  name: string;
  industry: string;
  website?: string;
}

export interface Email {
  value: string;
  label: "pro" | "perso" | "autre";
}

export interface Phone {
  value: string;
  label: "mobile" | "fixe" | "pro";
}

export interface SocialLinks {
  linkedin?: string;
  twitter?: string;
  github?: string;
}

export interface Interaction {
  id: string;
  contactId: string;
  date: string;
  kind: InteractionKind;
  title: string;
  notes?: string;
}

export interface Contact {
  id: string;
  name: string;
  photoUrl?: string;
  emails: Email[];
  phones: Phone[];
  organisationId?: string;
  relationType: RelationType;
  birthday?: string;
  tags: string[];
  social: SocialLinks;
  notes: string;
  lastInteractionDate?: string;
}

export const ORGANISATIONS: Organisation[] = [
  { id: "org-1", name: "Acme Corp", industry: "Technologie", website: "https://acme.example" },
  { id: "org-2", name: "Studio Lumière", industry: "Design & Créatif", website: "https://lumiere.example" },
  { id: "org-3", name: "BioSanté", industry: "Santé", website: "https://biosante.example" },
  { id: "org-4", name: "FinTech SA", industry: "Finance", website: "https://fintech.example" },
  { id: "org-5", name: "EduLearn", industry: "Éducation", website: "https://edulearn.example" },
  { id: "org-6", name: "GreenTech", industry: "Environnement", website: "https://greentech.example" },
  { id: "org-7", name: "MediaPlus", industry: "Médias", website: "https://mediaplus.example" },
  { id: "org-8", name: "ConseilPro", industry: "Conseil", website: "https://conseipro.example" },
];

export const CONTACTS: Contact[] = [
  {
    id: "c-001",
    name: "Alice Martin",
    emails: [{ value: "alice.martin@acme.example", label: "pro" }, { value: "alice@perso.fr", label: "perso" }],
    phones: [{ value: "+33 6 12 34 56 78", label: "mobile" }],
    organisationId: "org-1",
    relationType: "collègue",
    birthday: "1988-04-15",
    tags: ["product", "ux", "paris"],
    social: { linkedin: "https://linkedin.com/in/alice-martin", twitter: "https://twitter.com/alicemtn" },
    notes: "## Alice Martin\n\nAlice est responsable produit chez Acme. On collabore sur la roadmap Q3.\n\n**Points importants :**\n- Préfère les appels le matin\n- Fan de design systems",
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
    tags: ["design", "freelance", "bordeaux"],
    social: { twitter: "https://twitter.com/baptiste_l", github: "https://github.com/bptle" },
    notes: "## Baptiste Leroy\n\nDesigner freelance, on se retrouve régulièrement à Bordeaux.\n\nCollabore avec Studio Lumière sur des projets d'identité visuelle.",
    lastInteractionDate: "2026-05-01",
  },
  {
    id: "c-003",
    name: "Camille Dupont",
    emails: [{ value: "c.dupont@biosante.fr", label: "pro" }],
    phones: [{ value: "+33 6 55 44 33 22", label: "mobile" }, { value: "+33 1 40 22 33 44", label: "fixe" }],
    organisationId: "org-3",
    relationType: "client",
    birthday: "1975-12-03",
    tags: ["healthcare", "b2b", "décideur"],
    social: { linkedin: "https://linkedin.com/in/camille-dupont" },
    notes: "## Camille Dupont\n\nDSI de BioSanté. Client depuis 2023.\n\n**Contrat** : 45k€/an, renouvellement en décembre.",
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
    tags: ["fintech", "investisseur", "vip"],
    social: { linkedin: "https://linkedin.com/in/david-chen-fin", twitter: "https://twitter.com/dchen_fin" },
    notes: "## David Chen\n\nDirecteur des partenariats chez FinTech SA. Investisseur potentiel pour la série A.",
    lastInteractionDate: "2026-04-20",
  },
  {
    id: "c-005",
    name: "Emma Rousseau",
    emails: [{ value: "emma.r@gmail.com", label: "perso" }],
    phones: [{ value: "+33 6 11 22 33 44", label: "mobile" }],
    relationType: "famille",
    birthday: "1995-01-30",
    tags: ["famille", "nantes"],
    social: {},
    notes: "## Emma Rousseau\n\nMa cousine. Architecte à Nantes.",
    lastInteractionDate: "2026-03-15",
  },
  {
    id: "c-006",
    name: "François Petit",
    emails: [{ value: "f.petit@edulearn.fr", label: "pro" }],
    phones: [{ value: "+33 7 33 44 55 66", label: "mobile" }],
    organisationId: "org-5",
    relationType: "mentor",
    birthday: "1965-06-18",
    tags: ["edtech", "mentor", "conférence"],
    social: { linkedin: "https://linkedin.com/in/francois-petit-edu", twitter: "https://twitter.com/fpetit_edu" },
    notes: "## François Petit\n\nEx-prof à l'INRIA, fondateur d'EduLearn. Mon mentor depuis 2020.\n\nOn se voit une fois par trimestre.",
    lastInteractionDate: "2026-02-14",
  },
  {
    id: "c-007",
    name: "Gabrielle Moreau",
    emails: [{ value: "gab@greentech.io", label: "pro" }, { value: "gabrielle.moreau@gmail.com", label: "perso" }],
    phones: [{ value: "+33 6 77 88 99 00", label: "mobile" }],
    organisationId: "org-6",
    relationType: "collègue",
    birthday: "1991-03-25",
    tags: ["greentech", "impact", "startup"],
    social: { linkedin: "https://linkedin.com/in/gabrielle-moreau", github: "https://github.com/gabmoreau" },
    notes: "## Gabrielle Moreau\n\nCTO de GreenTech. On a parlé d'une collaboration sur les APIs carbone.",
    lastInteractionDate: "2026-05-03",
  },
  {
    id: "c-008",
    name: "Hugo Bernard",
    emails: [{ value: "hugo.bernard@mediaplus.fr", label: "pro" }],
    phones: [{ value: "+33 6 44 55 66 77", label: "mobile" }],
    organisationId: "org-7",
    relationType: "connaissance",
    tags: ["media", "journalisme", "podcast"],
    social: { twitter: "https://twitter.com/hugobernard" },
    notes: "## Hugo Bernard\n\nJournaliste tech chez MediaPlus. A fait un article sur Supernote.",
    lastInteractionDate: "2026-04-05",
  },
  {
    id: "c-009",
    name: "Inès Fontaine",
    emails: [{ value: "ines.fontaine@conseipro.fr", label: "pro" }],
    phones: [{ value: "+33 7 55 66 77 88", label: "mobile" }, { value: "+33 1 44 55 66 77", label: "fixe" }],
    organisationId: "org-8",
    relationType: "client",
    birthday: "1978-11-12",
    tags: ["conseil", "rh", "formation"],
    social: { linkedin: "https://linkedin.com/in/ines-fontaine-conseil" },
    notes: "## Inès Fontaine\n\nDRH chez ConseilPro. Cliente pour la formation des équipes sur les outils PKM.",
    lastInteractionDate: "2026-04-22",
  },
  {
    id: "c-010",
    name: "Jules Mercier",
    emails: [{ value: "jules.mercier@acme.example", label: "pro" }],
    phones: [{ value: "+33 6 22 33 44 55", label: "mobile" }],
    organisationId: "org-1",
    relationType: "collègue",
    birthday: "1992-08-07",
    tags: ["engineering", "backend", "go"],
    social: { github: "https://github.com/jmercier", linkedin: "https://linkedin.com/in/jules-mercier" },
    notes: "## Jules Mercier\n\nEngineer senior chez Acme. Expert Go et Kubernetes.",
    lastInteractionDate: "2026-05-06",
  },
  {
    id: "c-011",
    name: "Karine Simon",
    emails: [{ value: "karine@perso.net", label: "perso" }],
    phones: [{ value: "+33 6 88 77 66 55", label: "mobile" }],
    relationType: "ami",
    birthday: "1987-02-14",
    tags: ["art", "photographie", "lyon"],
    social: { twitter: "https://twitter.com/karines_photo", instagram: "https://instagram.com/karine.simon.photo" } as SocialLinks,
    notes: "## Karine Simon\n\nPhotographe indépendante à Lyon. Amie depuis Sciences Po.",
    lastInteractionDate: "2026-03-28",
  },
  {
    id: "c-012",
    name: "Laurent Dubois",
    emails: [{ value: "l.dubois@fintech.sa", label: "pro" }],
    phones: [{ value: "+33 7 99 88 77 66", label: "mobile" }],
    organisationId: "org-4",
    relationType: "partenaire",
    birthday: "1980-05-20",
    tags: ["fintech", "compliance", "vip"],
    social: { linkedin: "https://linkedin.com/in/laurent-dubois-fin" },
    notes: "## Laurent Dubois\n\nResponsable conformité chez FinTech SA. Clé pour le partenariat RGPD.",
    lastInteractionDate: "2026-04-15",
  },
  {
    id: "c-013",
    name: "Marie-Anne Leclerc",
    emails: [{ value: "ma.leclerc@biosante.fr", label: "pro" }, { value: "marie.leclerc@hotmail.fr", label: "perso" }],
    phones: [{ value: "+33 6 33 44 55 66", label: "mobile" }],
    organisationId: "org-3",
    relationType: "client",
    birthday: "1972-10-30",
    tags: ["healthcare", "r&d", "biotech"],
    social: { linkedin: "https://linkedin.com/in/marie-anne-leclerc" },
    notes: "## Marie-Anne Leclerc\n\nDirectrice R&D chez BioSanté. Contact stratégique pour le projet ARIA.",
    lastInteractionDate: "2026-04-18",
  },
  {
    id: "c-014",
    name: "Nicolas Garnier",
    emails: [{ value: "nicolas.garnier@gmail.com", label: "perso" }],
    phones: [{ value: "+33 6 44 33 22 11", label: "mobile" }],
    relationType: "ami",
    birthday: "1989-12-25",
    tags: ["musique", "tech", "montpellier"],
    social: { github: "https://github.com/ngarnier", twitter: "https://twitter.com/nicos_beats" },
    notes: "## Nicolas Garnier\n\nDev et musicien à Montpellier. Contribue à des projets open-source.",
    lastInteractionDate: "2026-04-30",
  },
  {
    id: "c-015",
    name: "Olivia Blanchard",
    emails: [{ value: "o.blanchard@edulearn.fr", label: "pro" }],
    phones: [{ value: "+33 7 66 55 44 33", label: "mobile" }],
    organisationId: "org-5",
    relationType: "collègue",
    birthday: "1993-07-04",
    tags: ["edtech", "pédagogie", "remote"],
    social: { linkedin: "https://linkedin.com/in/olivia-blanchard-edu" },
    notes: "## Olivia Blanchard\n\nPédagogue chez EduLearn. Travaille sur la plateforme adaptive learning.",
    lastInteractionDate: "2026-05-02",
  },
  {
    id: "c-016",
    name: "Pierre-Emmanuel Vidal",
    emails: [{ value: "pe.vidal@acme.example", label: "pro" }],
    phones: [{ value: "+33 6 55 66 77 88", label: "pro" }],
    organisationId: "org-1",
    relationType: "client",
    birthday: "1970-03-17",
    tags: ["c-suite", "entreprise", "vip"],
    social: { linkedin: "https://linkedin.com/in/pe-vidal" },
    notes: "## Pierre-Emmanuel Vidal\n\nCDO d'Acme Corp. Décideur final pour le contrat annuel.",
    lastInteractionDate: "2026-04-25",
  },
  {
    id: "c-017",
    name: "Quentin Roux",
    emails: [{ value: "q.roux@greentech.io", label: "pro" }],
    phones: [{ value: "+33 6 11 00 99 88", label: "mobile" }],
    organisationId: "org-6",
    relationType: "collègue",
    tags: ["climat", "data", "python"],
    social: { github: "https://github.com/qroux", linkedin: "https://linkedin.com/in/quentin-roux-gt" },
    notes: "## Quentin Roux\n\nData scientist chez GreenTech. Modèles prédictifs de consommation énergétique.",
    lastInteractionDate: "2026-04-08",
  },
  {
    id: "c-018",
    name: "Rémy Lefebvre",
    emails: [{ value: "remy.lefebvre@perso.fr", label: "perso" }],
    phones: [{ value: "+33 7 22 11 00 99", label: "mobile" }],
    relationType: "famille",
    birthday: "1960-08-14",
    tags: ["famille", "paris"],
    social: {},
    notes: "## Rémy Lefebvre\n\nMon oncle. Retraité de l'enseignement.",
    lastInteractionDate: "2026-01-20",
  },
  {
    id: "c-019",
    name: "Sophie Andersen",
    emails: [{ value: "s.andersen@mediaplus.fr", label: "pro" }, { value: "sophie.and@gmail.com", label: "perso" }],
    phones: [{ value: "+33 6 33 22 11 00", label: "mobile" }],
    organisationId: "org-7",
    relationType: "connaissance",
    birthday: "1985-05-09",
    tags: ["media", "communication", "anglophone"],
    social: { twitter: "https://twitter.com/sophieand_media", linkedin: "https://linkedin.com/in/sophie-andersen" },
    notes: "## Sophie Andersen\n\nRédactrice en chef adjointe chez MediaPlus. Rencontrée à la conférence LeWeb.",
    lastInteractionDate: "2026-03-05",
  },
  {
    id: "c-020",
    name: "Thomas Klein",
    emails: [{ value: "t.klein@conseipro.fr", label: "pro" }],
    phones: [{ value: "+33 7 44 55 66 77", label: "mobile" }],
    organisationId: "org-8",
    relationType: "partenaire",
    birthday: "1977-01-28",
    tags: ["conseil", "stratégie", "vip"],
    social: { linkedin: "https://linkedin.com/in/thomas-klein-conseil" },
    notes: "## Thomas Klein\n\nAssocié senior chez ConseilPro. Partenaire pour les projets de transformation digitale.",
    lastInteractionDate: "2026-04-12",
  },
  {
    id: "c-021",
    name: "Ulysse Morel",
    emails: [{ value: "ulysse.morel@gmail.com", label: "perso" }],
    phones: [{ value: "+33 6 77 66 55 44", label: "mobile" }],
    relationType: "ami",
    birthday: "1994-06-11",
    tags: ["sport", "trail", "grenoble"],
    social: { twitter: "https://twitter.com/ulysse_trail" },
    notes: "## Ulysse Morel\n\nAmi de fac. Coureur de trail à Grenoble. On fait une course ensemble en octobre.",
    lastInteractionDate: "2026-05-05",
  },
  {
    id: "c-022",
    name: "Valérie Schneider",
    emails: [{ value: "v.schneider@biosante.fr", label: "pro" }],
    phones: [{ value: "+33 6 88 99 00 11", label: "pro" }],
    organisationId: "org-3",
    relationType: "client",
    birthday: "1968-09-22",
    tags: ["healthcare", "direction", "alsace"],
    social: { linkedin: "https://linkedin.com/in/valerie-schneider-bio" },
    notes: "## Valérie Schneider\n\nDirectrice générale de BioSanté. Contact de haut niveau pour la négociation du renouvellement.",
    lastInteractionDate: "2026-03-20",
  },
  {
    id: "c-023",
    name: "William Tran",
    emails: [{ value: "w.tran@acme.example", label: "pro" }, { value: "will.tran@gmail.com", label: "perso" }],
    phones: [{ value: "+33 7 55 44 33 22", label: "mobile" }],
    organisationId: "org-1",
    relationType: "collègue",
    birthday: "1996-02-29",
    tags: ["frontend", "react", "typescript"],
    social: { github: "https://github.com/wtran", twitter: "https://twitter.com/will_tran_dev" },
    notes: "## William Tran\n\nFrontend engineer chez Acme. Expert React et TypeScript. Mentoré informellement.",
    lastInteractionDate: "2026-05-07",
  },
  {
    id: "c-024",
    name: "Xénia Volkov",
    emails: [{ value: "xenia.volkov@studio-l.fr", label: "pro" }],
    phones: [{ value: "+33 6 99 00 11 22", label: "mobile" }],
    organisationId: "org-2",
    relationType: "partenaire",
    birthday: "1986-04-03",
    tags: ["design", "motion", "illustration"],
    social: { twitter: "https://twitter.com/xenia_design", linkedin: "https://linkedin.com/in/xenia-volkov" },
    notes: "## Xénia Volkov\n\nDirectrice artistique chez Studio Lumière. Partenaire pour les projets visuels.",
    lastInteractionDate: "2026-04-28",
  },
  {
    id: "c-025",
    name: "Yannick Forestier",
    emails: [{ value: "y.forestier@greentech.io", label: "pro" }, { value: "yannick.f@free.fr", label: "perso" }],
    phones: [{ value: "+33 7 11 22 33 44", label: "mobile" }],
    organisationId: "org-6",
    relationType: "mentor",
    birthday: "1962-11-07",
    tags: ["énergie", "vc", "mentor"],
    social: { linkedin: "https://linkedin.com/in/yannick-forestier" },
    notes: "## Yannick Forestier\n\nFondateur de GreenTech, ancien partner chez un VC. Mentor pour les aspects levée de fonds.",
    lastInteractionDate: "2026-04-01",
  },
  {
    id: "c-026",
    name: "Linh-Dan Tran",
    emails: [{ value: "linh.tran@acme.example", label: "pro" }, { value: "linhdan.tran@gmail.com", label: "perso" }],
    phones: [{ value: "+33 6 50 61 72 83", label: "mobile" }],
    organisationId: "org-1",
    relationType: "collègue",
    birthday: "1994-03-12",
    tags: ["product", "data", "vietnam"],
    social: { linkedin: "https://linkedin.com/in/linh-dan-tran", github: "https://github.com/ldtran" },
    notes: "## Linh-Dan Tran\n\nProduct analyst chez Acme. Spécialiste données produit et cohortes.",
    lastInteractionDate: "2026-05-04",
  },
];

export const INTERACTIONS: Interaction[] = [
  { id: "i-001", contactId: "c-001", date: "2026-04-28", kind: "réunion", title: "Revue roadmap Q3", notes: "Alignement sur les priorités UX pour Q3. Alice va préparer un doc de synthèse." },
  { id: "i-002", contactId: "c-001", date: "2026-04-10", kind: "email", title: "Feedback sur le prototype", notes: "Alice a envoyé ses retours sur le prototype v2." },
  { id: "i-003", contactId: "c-001", date: "2026-03-20", kind: "appel", title: "Point hebdo 15min", notes: "Point rapide sur les blocages." },
  { id: "i-004", contactId: "c-002", date: "2026-05-01", kind: "déjeuner", title: "Déjeuner à Bordeaux", notes: "On a parlé du projet identité visuelle Supernote." },
  { id: "i-005", contactId: "c-002", date: "2026-04-02", kind: "message", title: "Partage de ressources design", notes: "Baptiste a partagé des références Figma intéressantes." },
  { id: "i-006", contactId: "c-003", date: "2026-04-10", kind: "réunion", title: "Point contrat annuel", notes: "Camille veut ajouter 2 licences supplémentaires. À formaliser." },
  { id: "i-007", contactId: "c-003", date: "2026-03-05", kind: "email", title: "Renouvellement contrat", notes: "Envoi du devis de renouvellement. En attente de validation." },
  { id: "i-008", contactId: "c-004", date: "2026-04-20", kind: "réunion", title: "Présentation due diligence", notes: "David a apprécié les métriques. Prochaine étape : appel avec ses associés." },
  { id: "i-009", contactId: "c-004", date: "2026-03-15", kind: "email", title: "Envoi du deck série A", notes: "David a demandé des clarifications sur la partie monétisation." },
  { id: "i-010", contactId: "c-005", date: "2026-03-15", kind: "appel", title: "Appel famille", notes: "Nouvelles d'Emma, elle a eu une promotion dans son cabinet." },
  { id: "i-011", contactId: "c-006", date: "2026-02-14", kind: "déjeuner", title: "Session mentorat trimestrielle", notes: "François m'a conseillé de me concentrer sur un seul marché en 2026." },
  { id: "i-012", contactId: "c-006", date: "2025-11-20", kind: "réunion", title: "Session mentorat", notes: "Review de la stratégie go-to-market." },
  { id: "i-013", contactId: "c-007", date: "2026-05-03", kind: "appel", title: "Appel technique APIs carbone", notes: "Gabrielle propose d'utiliser le standard GHG Protocol pour les calculs." },
  { id: "i-014", contactId: "c-007", date: "2026-04-15", kind: "email", title: "Intérêt pour une API commune", notes: "GreenTech est intéressé par co-développer une API de suivi carbone." },
  { id: "i-015", contactId: "c-008", date: "2026-04-05", kind: "réunion", title: "Interview pour article Tech", notes: "Article publié dans MediaPlus : 'Les outils PKM en 2026'." },
  { id: "i-016", contactId: "c-009", date: "2026-04-22", kind: "réunion", title: "Formation équipe RH", notes: "Formation de 2h sur Supernote pour 8 personnes. Très bon retour." },
  { id: "i-017", contactId: "c-009", date: "2026-04-01", kind: "email", title: "Devis formation", notes: "Envoi du devis formation × 3 sessions." },
  { id: "i-018", contactId: "c-010", date: "2026-05-06", kind: "message", title: "Review PR backend", notes: "Jules a reviewé la PR #342, quelques suggestions d'optimisation." },
  { id: "i-019", contactId: "c-010", date: "2026-04-28", kind: "réunion", title: "Architecture review", notes: "Discussion sur la migration vers gRPC." },
  { id: "i-020", contactId: "c-012", date: "2026-04-15", kind: "appel", title: "Point partenariat RGPD", notes: "Laurent confirme que le DPA est signé côté FinTech." },
  { id: "i-021", contactId: "c-013", date: "2026-04-18", kind: "réunion", title: "Projet ARIA – kick-off", notes: "Démarrage officiel du projet. Équipe de 4 personnes côté BioSanté." },
  { id: "i-022", contactId: "c-014", date: "2026-04-30", kind: "message", title: "Partage playlist", notes: "Nicolas a partagé sa dernière mixtape. Top." },
  { id: "i-023", contactId: "c-015", date: "2026-05-02", kind: "email", title: "Collaboration contenu pédagogique", notes: "Olivia propose de co-créer du contenu sur la prise de notes adaptée." },
  { id: "i-024", contactId: "c-016", date: "2026-04-25", kind: "réunion", title: "Négociation contrat enterprise", notes: "PE Vidal veut un SLA à 99.9%. On a discuté des conditions." },
  { id: "i-025", contactId: "c-019", date: "2026-03-05", kind: "appel", title: "Suivi après la conférence", notes: "Sophie intéressée par un article sur Supernote." },
  { id: "i-026", contactId: "c-020", date: "2026-04-12", kind: "réunion", title: "Kick-off transformation digitale", notes: "Thomas présente son approche méthodologique pour les projets de transformation." },
  { id: "i-027", contactId: "c-021", date: "2026-05-05", kind: "message", title: "Inscription course Trail des Écrins", notes: "On s'est inscrits pour le 15 octobre !" },
  { id: "i-028", contactId: "c-023", date: "2026-05-07", kind: "message", title: "Question sur useCallback", notes: "William a posé une question sur l'optimisation React. Répondu avec exemples." },
  { id: "i-029", contactId: "c-024", date: "2026-04-28", kind: "réunion", title: "Validation moodboard", notes: "Xénia a présenté 3 directions visuelles. On a retenu la direction 'Éther'." },
  { id: "i-030", contactId: "c-025", date: "2026-04-01", kind: "déjeuner", title: "Session mentorat levée de fonds", notes: "Yannick recommande de viser des VCs spécialisés SaaS B2B en France." },
];
