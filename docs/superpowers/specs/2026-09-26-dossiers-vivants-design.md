# Dossiers vivants : design

*2026-09-26 · sous-projet 4/4 de la série « prendre de l'avance » (1 engagements ✓ → 2 brief avant réunion ✓ → 3 assistant du coffre ✓ → 4 dossiers vivants).*

## Intention

Sur la fiche d'une personne ou d'une organisation, **un seul fil chronologique** qui se remplit seul : mails, notes qui la mentionnent, rendez-vous, engagements, todos qui en découlent et interactions saisies à la main. Aujourd'hui, ces éléments sont dispersés entre six onglets et l'agenda. L'onglet Timeline ne montre que les interactions saisies à la main.

**Décision utilisateur (2026-09-26)** : option A. Le périmètre couvre l'**organisation et le contact**. Pour Acme, on agrège toutes les personnes rattachées plus les mails du domaine. C'est une **vue calculée** : jamais périmée, et sans écriture, donc sans bruit dans la synchro.

**Succès** : sur la fiche d'Acme, on voit en ordre antichronologique le fil « Devis Acme », la note de réunion qui mentionne Alice, le rendez-vous « Point client Acme » et l'engagement « Envoyer le devis signé ». Chaque ligne s'ouvre d'un clic. Sur mobile, le fil tient sans débordement.

## L'existant

| Brique | Où | Rôle ici |
|---|---|---|
| Fiche contact, onglets | `app/contacts/[id]/page.tsx` (`Tab`, `TimelineTab` = entités `interaction`) | `TimelineTab` devient `DossierTab`, en onglet par défaut |
| Rattachement personne → organisation | champ `personne.organisationId` (`lib/contact-from-email.ts:300`) | membres d'une organisation |
| Adresses d'un contact | `contactEmails(fields)` | clés de recherche mail, agenda et engagements |
| Miroir mail | `mirrorSearchThreads(accountId, { from: [x] })` | fils, par adresse et par domaine (`LIKE %acme.fr%`) |
| Mentions | `entities.getBacklinks({ id })` | notes qui citent la personne ou l'organisation |
| Agenda | `calendar.listEvents({ accountId, from, to })` | rendez-vous dont un participant correspond |
| Engagements | `useMailCommitments()` + `whoEmail` | promesses liées à la personne ou au domaine |
| Todos issus d'un mail | champ `mailThreadId` des todos (réveillé par les engagements) | todos rattachés aux fils du dossier |
| Brief de réunion | `lib/meeting-brief.ts` (`mergeThreads`, `localDay`) | réutilisé pour la fusion des fils |

## Architecture

### 1. Périmètre : `dossierScope(entity, personnes, org?)` dans `lib/dossier.ts` (pur)

```ts
interface DossierScope {
  entityIds: string[];   // la fiche + ses membres (organisation) → mentions
  emails: string[];      // adresses exactes, en minuscules
  domain: string | null; // organisation : domaine du site web, sans « www. » ; jamais un webmail
}
```

- **Personne** : `entityIds = [id]`, `emails = contactEmails(fields)`, `domain = null`.
- **Organisation** : `entityIds = [id, ...membres]`, où un membre est une `personne` dont `organisationId === id`. `emails` = l'union des adresses des membres. `domain` = nom d'hôte de `website`, sans le `www.`. Il vaut `null` pour un webmail courant (`gmail.com`, `outlook.*`, `hotmail.*`, `yahoo.*`, `orange.fr`, `free.fr`, `icloud.com`, `laposte.net`, `wanadoo.fr`), sinon le dossier avalerait toute la boîte.
- **Correspondance** d'une adresse : `emails.includes(a)`, ou `domain` non nul et `a.endsWith("@" + domain)`.

### 2. Éléments : `DossierItem` et `buildDossier(parts)` (pur)

```ts
type DossierKind = "mail" | "note" | "event" | "commitment" | "todo" | "interaction";
interface DossierItem {
  key: string;
  kind: DossierKind;
  at: number;        // epoch ms, pour le tri
  title: string;
  meta: string;      // expéditeur, participants, « Je dois / On me doit », échéance…
  url: string | null;
  upcoming?: boolean; // rendez-vous ou échéance à venir
}
```

`buildDossier` fusionne les éléments, dédoublonne par `key` et trie par date décroissante. Les éléments **à venir** (rendez-vous futurs, échéances futures) forment une section « À venir » en tête, triée par date croissante. Le reste est groupé **par mois** (« septembre 2026 »). Au plus 200 éléments.

### 3. Sources : `components/contacts/useDossier.ts`

Toutes locales, lancées quand l'onglet s'ouvre, avec un cache react-query de 60 s par fiche :

| Source | Requête | Élément |
|---|---|---|
| Mails | `from: [adresse]` (20) et `to: [adresse]` (10) par adresse (8 max), plus `from: [@domaine]` (30). Les résultats `from` sont revérifiés par `matchesScope` sur l'expéditeur exact, car le miroir fait un `LIKE` sur l'adresse et sur le nom. `to` est nécessaire parce que `from` ne voit que le dernier expéditeur du fil. | `mail`, date du fil, objet, expéditeur, `/mail?thread=` |
| Notes | `getBacklinks({ id })` par `entityIds` (10 max), notes seulement | `note`, `updatedAt` de la note (via `entities.get` si absent), titre, `/notes/:id` |
| Rendez-vous | `calendar.listEvents` de J-180 à J+60, filtré sur les participants | `event`, `startAt`, titre, participants, `/agenda?event=&at=` |
| Engagements | `useMailCommitments().all`, `whoEmail` qui correspond, statut ≠ `dismissed` | `commitment`, échéance sinon date du fil sinon section « Sans date », texte, sens, `/mail?thread=` |
| Todos | `entities.list({ typeId: "todo" })` dont `mailThreadId` ∈ fils trouvés | `todo`, `dueDate` sinon `updatedAt`, texte, fait / à faire, `/todos` |
| Interactions | entités `interaction` existantes (`participants` ou `contactId` ∈ `entityIds`) | `interaction`, `date`, titre, `kind` |

### 4. Affichage : `DossierTab`

- Remplace `TimelineTab`. L'onglet « Timeline » devient **« Dossier »** et devient l'onglet ouvert par défaut.
- Section « À venir », puis sections mensuelles. Une ligne : icône du type (phosphor), titre tronqué, méta sur une ligne, date. Un clic ouvre `url`. Les lignes sont des `Button` ghost pleine largeur, avec les classes suffixées `!` à cause du piège HeroUI hors `@layer`, comme dans `MeetingBrief`.
- Filtre en tête : pastilles Tout / Mails / Notes / Rendez-vous / Engagements, en `Chip` cliquables avec hit-target ≥ 32 px.
- Vide : « Rien encore avec {nom}. Les mails, notes et rendez-vous apparaîtront ici. »
- **Organisation accessible** : dans l'onglet Liens d'une personne, le nom de l'organisation devient un lien vers `/contacts/:orgId`. La page est la même : `entities.get` gère n'importe quel type, et le dossier détecte `typeId === "organisation"`.

Mobile : la même vue, colonnes empilées (méta sous le titre), sans débordement horizontal.

## Erreurs

| Cas | Comportement |
|---|---|
| Miroir mail ou agenda indisponible | source ignorée, les autres s'affichent |
| Organisation sans site ni membre | dossier limité aux mentions et aux interactions |
| Site web sur un webmail | pas de filtre par domaine |

## Hors périmètre

Dossiers par projet ou par tag (option C), écriture d'une note-dossier, résumé IA du dossier, recherche Gmail par le réseau (l'onglet Emails existant la garde).

## Vérification

- `pnpm typecheck`.
- 1 e2e Playwright :
  - données : une organisation Acme (site `acme.fr`) et une personne Alice (`alice@acme.fr`, `organisationId` = Acme), créées dans le coffre de test ; un fil d'Alice dans le miroir ; un rendez-vous avec Alice ;
  - assertion : la fiche d'Alice puis celle d'Acme montrent le fil et le rendez-vous, et un clic ouvre le fil ;
  - variante mobile : sans débordement.
