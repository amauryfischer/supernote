# Brief avant réunion : design

*2026-09-26 · sous-projet 2/4 de la série « prendre de l'avance » (1 engagements ✓ → 2 brief avant réunion → 3 assistant étendu au coffre → 4 dossiers vivants).*

## Intention

Avant une réunion, on veut savoir en 30 secondes où on en est avec chaque participant. Les clients mail et les agendas concurrents ne le savent pas, parce qu'ils ne voient ni les notes ni les engagements. Supernote a tout localement.

**Décision utilisateur (2026-09-26)** : option A. Le brief s'affiche dans la fiche de l'événement, il est mis en avant dans les 30 min qui précèdent, et une notification 15 min avant l'ouvre. **Pas d'IA** : c'est un pur assemblage de données locales, et il marche donc aussi sur mobile.

**Succès** : 15 min avant une réunion avec un client, la notification arrive. Un tap ouvre la fiche. Pour chaque participant externe, on voit sa fiche contact, les engagements ouverts dans les deux sens, les 3 derniers fils mail et les 3 dernières notes qui le mentionnent. Le tout s'affiche sans réseau si le coffre est synchronisé.

## Ce qui existe et qu'on réutilise

| Brique | Où | Rôle ici |
|---|---|---|
| `EventDetail` : participants → contacts, note de réunion | `components/agenda/EventDetail.tsx:39-77,167-178` | point d'insertion unique du brief, commun à `TodayPanel` et `/agenda` (desktop et `MobileSheet`) |
| `findContactMatch`, `contactEmails` | `lib/contact-from-email.ts:249,272` | participant → entité `personne` (déjà chargée par `EventDetail`) |
| Engagements | `useMailCommitments()` (`components/mail/useMailCommitments.ts`) | filtrés par `whoEmail`, statut ≠ `dismissed` |
| Miroir mail local | `mirrorSearchThreads(accountId, { from, to, limit })` (`lib/mail-mirror.ts:93`) | derniers fils avec la personne, hors ligne |
| Mentions | `entities.getBacklinks({ id })` (`worker-router.ts:1778`) | notes qui mentionnent le contact ; les notes de réunion écrivent `@Nom` (`lib/meeting-note.ts:15`) |
| Note de réunion de l'occurrence | `CalEventRow.noteId` | déjà affichée par `EventDetail` |
| Push d'événement | `lib/push/PushScheduleRunner.tsx:24,90` | délai 10 → 15 min, URL `/agenda` → lien profond vers l'événement |
| « Prochain » du panneau Aujourd'hui | `TodayPanel.tsx:~100-125` | la mise en avant à 30 min |

## Architecture

### 1. Données : `lib/meeting-brief.ts` (pur) + `components/agenda/useMeetingBrief.ts`

**Participants retenus** : `event.attendees` sans `self`, et sans les ressources (salles), repérées par une adresse `@resource.calendar.google.com`. Au plus **6**. Au-delà, « +N autres ».

Pour chaque participant, un `AttendeeBrief` :

```ts
interface AttendeeBrief {
  email: string;
  name: string;                    // nom du contact, sinon nom Google, sinon email
  contactId: string | null;        // entité `personne`
  commitments: { mine: Commitment[]; theirs: Commitment[] };  // statut suggested | accepted
  threads: { threadId: string; subject: string; date: number }[];   // 3 max, du plus récent
  notes: { id: string; title: string; context: string }[];          // 3 max
}
```

Sources, toutes locales :

- **contact** : `findContactMatch(personnes, email, name)`. La liste `personne` est déjà chargée par `EventDetail`, qui la passe en prop.
- **engagements** : `useMailCommitments().all`, filtré sur le compte connecté, puis `c.whoEmail` égal à l'email **ou** à l'un des `contactEmails` du contact. Une personne écrit souvent depuis deux adresses.
- **mails** : `mirrorSearchThreads(accountId, { from: [email], limit: 3 })` pour chaque adresse connue, fusion par `threadId`, 3 plus récents, avec un cache react-query de 60 s. **Expéditeur seulement** (révisé à la revue) : `to:` parcourt `mail_message.toJson` en entier, ce qui prend des secondes sur un gros miroir, et reste vide sur mobile.
- **notes** : `entities.getBacklinks({ id: contactId })`, 3 premiers, en excluant la note de réunion de l'occurrence courante (`event.noteId`, déjà affichée plus haut). Pas de contact, pas de notes.

`useMeetingBrief(event, personnes)` lance ces lectures quand la fiche s'ouvre, via des requêtes tRPC / react-query mises en cache par clé d'événement. Il renvoie `{ attendees: AttendeeBrief[]; loading: boolean }`.

### 2. Affichage : `components/agenda/MeetingBrief.tsx`

Inséré dans `EventDetail`, **à la place** de la liste actuelle des participants : le brief l'enrichit, il ne la double pas. Un bloc par participant.

- **En-tête** : nom (tronqué), statut de réponse, lien vers `/contacts/:id` si un contact correspond. « Créer le contact » a été retiré : aucune route ne préremplit un contact depuis une adresse.
- **Engagements** : « Je lui dois » / « Il me doit », avec la date. Le retard est en rouge. Un clic ouvre le fil.
- **Derniers échanges** : objet et date relative, un clic ouvre `/mail?thread=<id>`.
- **Notes** : titre et contexte d'une ligne, un clic ouvre la note.
- Une section vide ne s'affiche pas. Un participant sans aucune donnée garde une seule ligne (nom et statut), comme aujourd'hui.

Sur mobile : même composant dans la `MobileSheet`, colonnes empilées, cibles tactiles d'au moins 32 px, pas de débordement horizontal.

### 3. Mise en avant à 30 min

Dans la carte « Prochain » de `TodayPanel` : si `next.startAt - now ≤ 30 min` et que la réunion a des invités, un sous-titre compact s'affiche (à défaut : « Voir où tu en es avec les participants »). Il résume les engagements ouverts et les participants connus, par exemple « 2 engagements ouverts · Alice, Bob ». Un bouton « Brief » ouvre la fiche (`setSelectedId(next.id)`). Aucun basculement automatique du panneau : il déroberait la vue en pleine lecture.

### 4. Notification 15 min avant

`PushScheduleRunner` :

- `EVENT_LEAD_MS` passe de 10 à **15 min** ;
- l'URL d'un événement normal passe de `/agenda` à `/agenda?event=<id>&at=<startAt>`. Les blocs de tâche (`sourceRef`) gardent leur URL.

`/agenda` lit `event` et `at` au montage : `setAnchor(at)` pour que la plage contienne l'événement, puis `setSelectedId(event)`. Ensuite les deux paramètres sont retirés, comme `?new=1`. Le clic sur la notification recharge l'application (`WindowClient.navigate`), ce qui est acceptable puisque le brief est local.

## Persistance (trouvé à l'implémentation)

Le balayage « fantômes » de `vault.reindex` (au démarrage, puis toutes les 30 s) supprimait toute entité sans fichier sur disque, donc `mail_commitment` et `email_ai_cache`. Désormais les chemins `@system/%` sont exclus. Après un `resetStorage` (changement de coffre), la base est reconstruite depuis les fichiers : les engagements reviennent par le salon de synchro s'il y en a un, sinon ils sont recalculés au statut `suggested`.

## Erreurs

| Cas | Comportement |
|---|---|
| Événement sans participants | pas de brief, fiche inchangée |
| Miroir mail indisponible (mode dégradé, pas de worker) | section Mails masquée, le reste s'affiche |
| Événement introuvable au lien profond (supprimé, hors synchro) | `/agenda` s'ouvre sur la date `at`, sans sélection |
| Grosse réunion (> 6 externes) | 6 blocs + « +N autres » |

## Hors périmètre

Résumé IA, réunions passées de la même série (`recurringEventId` non stocké), todos liés à un contact (le lien n'existe pas), recherche Gmail réseau pour les fils hors miroir.

## Vérification

- `pnpm typecheck`.
- 1 e2e Playwright : un événement mocké avec un participant `alice@exemple.fr`, un fil d'Alice dans le miroir, un engagement `mail_commitment` d'Alice écrit via `mail.setCommitments`. On ouvre la fiche et on vérifie que le brief montre l'engagement et le fil. Variante mobile : sans débordement horizontal.
- `?event=&at=` sur `/agenda` ouvre la fiche : couvert dans le même e2e.
