# Engagements mail — design

*2026-09-26 (révisé : stockage) · sous-projet 1/4 de la série « prendre de l'avance » (1 engagements → 2 brief avant réunion → 3 assistant étendu au coffre → 4 dossiers vivants).*

## Intention

Les clients mail concurrents (Superhuman, Shortwave, Gmail+Gemini) résument et répondent, mais ne voient que le mail. Supernote a les todos, l'agenda et le CRM. Un **engagement** relie les deux : une promesse écrite dans un fil devient une action datée, liée à ce fil.

- **Je dois** : promesse dans un message que j'ai écrit (« je t'envoie le devis vendredi »).
- **On me doit** : promesse qu'un correspondant m'a faite (« je vous renvoie le contrat lundi »).

**Décision utilisateur (2026-09-26)** : l'IA **suggère**, rien n'est créé sans un clic. Les faux positifs du modèle local ne doivent pas polluer `/todos`.

**Succès** : sur un fil contenant une promesse datée, une suggestion apparaît sans action de ma part (sur le PC). Un clic crée une todo datée, liée au fil, planifiable dans l'agenda, avec un rappel. Côté « On me doit », un clic arme une relance à l'échéance.

## Ce qui existe et qu'on réutilise

| Brique | Où | Rôle ici |
|---|---|---|
| `extractActions` + prompt JSON | `lib/mail-ai.ts:346,410,665` | modèle du prompt et du parsing, enrichi (sens, auteur, date, citation) |
| `runLocalPrompt`, `toMailAiThread`, `isSelfAddress`, `isAiConfigured` | `lib/mail-ai.ts` | appel Ollama et sérialisation du fil |
| Écriture d'entité système synchronisée | `upsertEmailAiCacheEntity` (`worker-router.ts:5017`) | modèle de la route `mail.setCommitments` (type séparé, cf. §1) |
| Champs todo `dueDate`, `reminderAt`, `mailThreadId`, `mailFromName`, `mailFromEmail`, `mailSnippet` | seed todo + `app/todos/page.tsx:419` | `/todos` affiche déjà le lien « ouvrir l'email » ; plus rien n'écrit ces champs, on les réveille |
| Rappel de todo par push | moteur `reminderAt` du worker (`worker.ts:255`) | le rappel « Je dois » est gratuit |
| Planifier une todo | `taskRefOf` → `todo:<id>`, `scheduleTask` | fonctionne tel quel une fois la todo créée |
| Relances | `lib/mail-followup.ts`, `MailFollowupRunner` (monté dans `RootLayout.tsx:74`) | « On me doit » = relance avec `dueAt` = échéance + 1 j à 9 h |
| Détection de date heuristique | `detectDateTime` (`lib/email-to-event.ts:93`) | repli quand le modèle rend une date absente ou invalide |
| Runner IA au repos | `lib/ai/InboxAutoSort.tsx`, `useMailSummaries.ts` | forme du runner : lot, repos, cooldown après échec Ollama |
| Garde « pas d'IA sur mobile » | `isAiRuntimeAllowed()` (`lib/ai/ai-runtime.ts:19`) | la détection tourne sur le PC, le mobile lit les suggestions synchronisées |
| Panneau Aujourd'hui | `components/agenda/TodayPanel.tsx`, `MobileSheet` sur mobile (`app/mail/page.tsx:2764`) | accueille la liste des engagements, desktop et mobile |

## Architecture

### 1. Stockage : nouveau type système `mail_commitment`

~~Champs ajoutés à `email_ai_cache`~~. Écarté à la rédaction du plan : depuis `274ee9f`, `email_ai_cache` **est** le miroir mail partagé. Toute entité de ce type est matérialisée en fil `mail_thread` de boîte de réception sur les autres appareils (`upsertSharedMailThread`), et supprimée quand le fil quitte la boîte (`deleteEmailAiCacheEntity`). Un fil envoyé y apparaîtrait comme reçu ; un archivage effacerait ses engagements.

Donc **une entité `mail_commitment` par fil**, id déterministe `mc_<compte>_<threadId>`, chemin `@system/mail-commitments/{threadId}`. Elle est écrite par le worker, sur le modèle de `upsertEmailAiCacheEntity` (hooks → synchro en ligne, pas de FTS), et **jamais** dénormalisée dans `mail_thread`.

| Champ (id = clé stockée) | Type | Contenu |
|---|---|---|
| `mc_thread_id` | text | fil Gmail |
| `mc_account_email` | email | compte |
| `mc_subject` | text | objet, pour l'affichage hors miroir |
| `mc_items` | longtext | `Commitment[]` en JSON |
| `mc_fp` | text | `internalDate` du dernier message analysé |
| `mc_at` | number | date de la passe |

```ts
interface Commitment {
  key: string;            // djb2(messageId + citation normalisée) : stable d'une passe à l'autre, contrairement au texte reformulé par le modèle
  direction: "moi" | "eux";
  who: string;            // nom ou email de la personne qui promet (eux) / à qui je promets (moi)
  whoEmail: string;
  text: string;           // « Envoyer le devis signé »
  due: string | null;     // YYYY-MM-DD
  quote: string;          // phrase source, exacte
  messageId: string;
  status: "suggested" | "accepted" | "dismissed";
  todoId?: string;        // direction "moi", une fois accepté
}
```

Écriture : route worker `mail.setCommitments({ accountId, threadId, subject, items, fingerprint })`, contrat dans `@supernote/ipc` (`mail.router.ts`, `schemas/mail.ts`). Lecture : `entities.list({ typeId: "mail_commitment" })`. Le seed ajoute le type par `INSERT OR IGNORE`, donc les coffres existants le reçoivent au démarrage. L'application d'une op de synchro exclut ce type de la FTS, comme `email_ai_cache`, pour que les engagements ne polluent pas la recherche globale.

### 2. Détection : `lib/mail-commitments.ts` + `CommitmentsRunner`

**Périmètre des fils** : l'union des deux listes, dédoublonnée par `threadId`.

- inbox récent : `mail_thread` du miroir, `lastInternalDate` sur 14 j ;
- envoyés récents : `searchThreadsPage("in:sent newer_than:14d")` (`gmail.ts:458`), 1 page.

**Deuxième déclencheur** : l'ouverture d'un fil sur le PC lance l'analyse si l'empreinte a changé (`useThreadCommitments`). Les suggestions apparaissent sans attendre le runner, et l'e2e reste rapide.

**Empreinte** : `djb2(snippet normalisé)` du dernier message, disponible dans `threads.list` sans appel supplémentaire.

**Déclenchement** (`components/mail/CommitmentsRunner.tsx`, monté dans `RootLayout` à côté de `MailFollowupRunner`) :

- actif seulement si `isAiRuntimeAllowed() && isAiConfigured()` et Gmail connecté ;
- après `supernote:mail-synced`, puis au repos (onglet visible, 60 s sans frappe, même garde que `InboxAutoSort`) ;
- lot de 4 fils, en série. Un fil n'est analysé que si `lastInternalDate !== commitmentsFp` ;
- échec Ollama → cooldown 60 s. Échec de parsing → le fil est marqué `commitmentsFp` quand même (pas de boucle) ;
- quota Gmail : le coupe-circuit de 60 s existant (`5407c09`) s'applique ; le runner s'arrête pour la passe.

**Corps** : `getThread` Gmail (format full, déjà utilisé par `MailFollowupRunner`) → `toMailAiThread(thread, selfEmails)`. Le miroir ne suffit pas : les corps n'y sont qu'après ouverture du fil.

**Prompt** `buildCommitmentsPrompt` : les messages avec De/À/**date d'envoi**, `selfEmails` pour distinguer « moi ». Sortie JSON `[{direction, who, text, due, quote}]`. Consignes :

- promesse d'**action future** datée ou datable, pas une demande ni une politesse (« je reviens vers vous » sans objet = non) ;
- dates relatives résolues **par rapport à la date du message**.

**Gardes après parsing** (le cœur de la fiabilité avec un 4b) :

1. `quote` doit apparaître (normalisée espaces et casse) dans le texte du message cité, sinon rejet. Anti-hallucination.
2. `due` invalide ou absent → `detectDateTime(quote, dateDuMessage)`. Toujours rien → `due: null` (gardé, sans date).
3. `direction` recalculée à partir de l'expéditeur du message cité (`isSelfAddress`) quand elle contredit le modèle.
4. Échéance antérieure à la date d'envoi du message → ramenée à `null` puis au repli.
5. Fusion avec l'existant par `key` : un engagement `accepted` ou `dismissed` garde son statut. Un engagement disparu de la nouvelle passe reste s'il n'est pas `suggested`.

### 3. Actions

| Engagement | Action | Effet |
|---|---|---|
| Je dois | **Créer la todo** | `entities.create` todo : `text`, `dueDate`, `reminderAt` = échéance à 9 h, `mailThreadId`, `mailFromName`/`mailFromEmail` (destinataire), `mailSnippet` = `quote`. `status: accepted`, `todoId` |
| On me doit | **Suivre** | `mail-followup` : `dueAt` = échéance + 1 j à 9 h (sans date : +3 j). `status: accepted` |
| Les deux | **Ignorer** | `status: dismissed` |

Relance : à l'échéance, le comportement existant s'applique (le fil remonte dans INBOX + push `followup`). Dans le fil, un bouton **Relancer** ouvre le composeur avec un corps prérempli, sans IA : « Bonjour {prénom}, je me permets de revenir vers vous au sujet de : {text}. » Aucun envoi automatique.

Limite connue, conservée : les relances restent en localStorage, donc propres à chaque appareil. Accepter un « On me doit » sur le mobile arme la relance sur le mobile seulement. À migrer si ça gêne ; ce n'est pas nécessaire pour ce lot.

### 4. Interface (desktop et mobile dans le même lot)

- **Dans le fil** (`EmailThreadView`) : bandeau compact au-dessus des messages, une ligne par suggestion `suggested`. Texte, échéance, « Je dois » ou « On me doit », puis boutons icône + Tooltip (Créer la todo / Suivre / Ignorer). Un clic sur la citation fait défiler jusqu'au message. Sur mobile, même bandeau, hit-targets de 32 px au minimum, pas de débordement.
- **Panneau Aujourd'hui** (`TodayPanel`, donc aussi la `MobileSheet` mobile) : section « Engagements » avec deux groupes, *Je dois* et *On me doit*. Contenu : les suggestions en attente et les engagements acceptés dont l'échéance est ≤ aujourd'hui + 2 j, triés par échéance, avec le retard en rouge. Clic → ouvre le fil.
- **Retour** : pas de toast. Le bouton passe en chargement puis en coche (`lib/action-feedback.tsx`).
- Composants HeroUI v3 / `@supernote/ui`, icônes phosphor.

## Erreurs

| Cas | Comportement |
|---|---|
| Ollama éteint | le runner se tait (cooldown) ; la pastille IA du shell dit déjà pourquoi |
| JSON invalide | fil marqué analysé, aucune suggestion ; réessayé au prochain message du fil |
| Todo créée puis supprimée | l'engagement reste `accepted` ; pas de resynchronisation inverse (YAGNI) |
| Fil ouvert sur un appareil sans IA | suggestions synchronisées visibles et actionnables |

## Hors périmètre

Pastille dans la liste mail (le panneau Aujourd'hui suffit pour ce lot), envoi automatique de relance, relance rédigée par l'IA, synchronisation des relances entre appareils, curseur par message (le fil entier est réanalysé quand il change, les statuts sont préservés par `key`), engagements au-delà de 14 j.

## Vérification

- `pnpm typecheck`.
- 1 e2e Playwright (`tests/e2e`, helpers `bootCloud` + `mockGoogleApis`). Ollama mocké par `page.route("http://127.0.0.1:11434/**")`, qui rend un JSON fixe. Scénario : un fil contient « je vous envoie le devis vendredi », la suggestion apparaît dans le fil, on clique « Créer la todo », puis `/todos` montre la todo datée avec le lien vers l'email. Deuxième assertion : une `quote` absente du fil est rejetée.
- Contrôle manuel sur le vrai modèle (`qwen3.5:4b`) sur 10 fils réels, en lecture seule. Noter les faux positifs et négatifs avant de décider si le seuil ou le prompt doit bouger.
