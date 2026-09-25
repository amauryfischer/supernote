# Assistant étendu au coffre : design

*2026-09-26 · sous-projet 3/4 de la série « prendre de l'avance » (1 engagements ✓ → 2 brief avant réunion ✓ → 3 assistant étendu au coffre → 4 dossiers vivants).*

## Intention

Poser **une** question (« où en est le devis Acme ? ») et obtenir une réponse qui croise le fil mail, la note de réunion, l'engagement et le rendez-vous, avec des sources cliquables. Les assistants concurrents ne voient que le mail, ou que les documents.

**Décision (2026-09-26, laissée à Claude par l'utilisateur)** : option A. On garde **un seul** assistant, le chat `/ai` existant, qui reçoit les outils mail, engagements, agenda et contacts. L'assistant de boîte mail de `/mail` devient un raccourci vers ce chat.

**Succès** :
- « Où en est le devis Acme ? » appelle au moins un outil mail et un outil notes ou engagements, puis répond en citant ses sources.
- Chaque source s'ouvre d'un clic : fil, note, événement ou contact.
- Depuis `/mail`, le bouton de l'assistant ouvre `/ai`, et une suggestion préremplit la question.

## L'existant

| Brique | Où | Rôle ici |
|---|---|---|
| Chat à outils (Ollama, `runAgent`) | `components/ai/ChatPanel.tsx`, `lib/ai/tools.ts` (`DEFAULT_TOOLS` : semanticSearch, searchNotes, listNotes, getNote, createNote, updateNote) | on ajoute des outils au même tableau |
| Assistant de boîte | `lib/mail-assistant.ts` (`extractKeywords`, `detectTimeWindow`, `askMailbox`), `components/mail/MailAssistantPanel.tsx` | ses helpers purs servent à l'outil `searchMail` ; le panneau disparaît |
| Miroir mail | `mirrorSearchThreads`, `mirrorGetThread` (`lib/mail-mirror.ts`) | outils mail, locaux |
| Engagements | `MAIL_COMMITMENT_TYPE_ID`, `fromEntity` (`lib/mail-commitments.ts`) | outil `listCommitments` |
| Agenda | `calendar.listEvents({ accountId, from, to })`, `calendarAccount(settings)` | outil `listEvents` |
| Contacts | `entities.listSummaries({ typeId: "personne" })`, `contactEmails` | outil `findContact` |

## Architecture

### 1. Outils : `lib/ai/vault-tools.ts`

Même forme que `lib/ai/tools.ts` (`AgentTool = { definition, execute }`). Chaque élément renvoyé porte un `url` interne, pour que la réponse et l'interface puissent citer la source.

| Outil | Paramètres | Retour (par élément) |
|---|---|---|
| `searchMail` | `query`, `days?` | `threadId, subject, from, date, snippet, url=/mail?thread=` (8 max). Mots-clés par `extractKeywords`, fenêtre par `detectTimeWindow` quand `days` est absent. |
| `getMailThread` | `threadId` | messages (de, date, corps texte tronqué à 1 500 car.), `url` |
| `listCommitments` | `person?`, `direction?` (`moi`/`eux`), `includeDone?` | `text, direction, who, due, status, subject, url=/mail?thread=` |
| `listEvents` | `query?`, `fromDays?` (défaut −30), `toDays?` (défaut +30) | `summary, start, attendees, noteId, url=/agenda?event=&at=` (15 max) |
| `findContact` | `query` (nom, email ou société) | `id, name, emails, company, url=/contacts/:id` (5 max) |

Les outils existants gagnent le même champ `url` (`/notes/:id`) sur leurs éléments.

Tout se lit localement, rien ne part sur le réseau. Seul l'appel à Ollama passe par `127.0.0.1`, comme aujourd'hui.

### 2. Chat : `components/ai/ChatPanel.tsx`

- `tools: [...DEFAULT_TOOLS, ...VAULT_TOOLS]`.
- `SYSTEM_PROMPT` étendu. Il décrit les nouveaux outils et fixe deux règles :
  1. pour une question sur une affaire, une personne ou un dossier, **croiser** au moins le mail et les notes ou les engagements ;
  2. citer les sources par leur titre.
- **Sources cliquables** : sous chaque carte d'outil (`ToolCallCard`), les éléments du résultat qui portent `url` et un titre (`subject`, `title`, `summary`, `name` ou `text`) s'affichent en liens internes. Ils passent par `navigate`, sans rechargement.
- **`?q=`** : `/ai?q=<question>` préremplit le champ et envoie la question au montage, puis retire le paramètre.
- **Suggestions de départ** quand le chat est vide : « Qu'est-ce que j'ai raté cette semaine ? », « Qui attend une réponse de moi ? », « Où en est le dernier devis ? » (celles du panneau mail), plus « Prépare ma prochaine réunion ».
- **Mobile** : si `isAiRuntimeAllowed()` est faux, le chat affiche `AI_MOBILE_NOTICE` au lieu du champ de saisie. Ollama tourne sur le PC : le téléphone ne l'atteint pas, et il ne doit pas essayer.

### 3. `/mail`

Le bouton qui ouvrait `MailAssistantPanel` ouvre maintenant `/ai`. On supprime `MailAssistantPanel.tsx`, puis `askMailbox` et `buildAssistantPrompt` s'ils n'ont plus d'appelant.

## Erreurs

| Cas | Comportement |
|---|---|
| Ollama injoignable | erreur existante du chat |
| Miroir mail indisponible (mode dégradé) | `searchMail`/`getMailThread` renvoient `{ items: [], note: "miroir mail indisponible" }` ; le modèle le dit |
| Agenda non connecté | `listEvents` renvoie `{ items: [], note: "agenda non connecté" }` |
| Le modèle invente un id | l'outil renvoie `{ error: "introuvable" }`, sans exception |

## Hors périmètre

Recherche Gmail par le réseau, écriture (répondre, créer un événement) depuis le chat, historique des conversations, palette Cmd+K (option C).

## Vérification

- `pnpm typecheck`.
- 1 e2e Playwright :
  - Ollama mocké en mode `/api/chat`. Il appelle d'abord `searchMail`, puis répond avec du texte.
  - Assertion : la carte d'outil affiche un lien « Devis Acme » qui ouvre `/mail?thread=t1`.
  - Variante : `/ai?q=…` envoie la question au montage.
  - Variante mobile : notice affichée, aucun appel à Ollama.
