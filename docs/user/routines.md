# Routines et Automations

Les routines sont des règles qui font des choses pour toi, automatiquement. Elles peuvent s'exécuter selon un planning (cron), être déclenchées par une date dans tes données (alarme), ou réagir à un événement (création d'entité, changement de statut).

---

## Distinction importante

| | Automation | Routine |
|---|---|---|
| Déclenchement | Event (entité créée, statut changé…) | Cron, alarme, ou event |
| Interface | Editeur technique | Interface dédiée avec dashboard |
| Usage | Workflows data | Habitudes, rappels, envois récurrents |

En pratique, les routines sont des automations avec une UI plus friendly et un concept "je gère mon planning".

---

## Les 4 routines seed

Supernote installe 4 routines au premier lancement. Toutes sont modifiables.

### 1. Email hebdo à un contact

**Trigger :** Chaque lundi à 9h (cron)
**Ce qu'elle fait :**
1. Cherche les contacts avec `relationship_type = client` et `last_interaction > 7j`
2. Pour chaque contact : ouvre un brouillon email dans ton client mail OS avec un template personnalisé (prénom, dernière interaction, etc.)
3. Toi tu valides et tu envoies

> Les routines créent des **brouillons**, pas des envois automatiques. Tu gardes le contrôle.

**Configurer :**
- Fréquence : hebdo, bimensuel, mensuel
- Filtre contacts : par tag, type de relation, dernière interaction
- Template du corps : variables disponibles `{{name}}`, `{{last_interaction}}`, `{{role}}`

---

### 2. Rappel anniversaire

**Trigger :** Alarme sur le champ `birthday` de chaque Personne (J-1 à 9h)
**Ce qu'elle fait :**
1. Envoie une notification OS "Anniversaire de Jean Dupont demain"
2. Suggère un message type dans la notification
3. Crée une note dans l'Inbox "Penser à Jean pour son anniv"

**Configurer :**
- Délai d'anticipation : J-1, J-3, J-7
- Actions : notification seule, note Inbox, brouillon email, les trois

---

### 3. Suivi "À relancer"

**Trigger :** Chaque lundi à 9h (cron)
**Ce qu'elle fait :**
1. Cherche les contacts sans interaction depuis X jours (défaut : 30)
2. Filtre par `relationship_type` (configurable)
3. Crée une note dans l'Inbox "Relancer : Jean Dupont (45j sans contact)"
4. Optionnel : crée des Interactions draft pré-remplies

**Configurer :**
- Délai sans contact : 14 / 30 / 60 / 90 jours
- Types de relation ciblés : client, prospect, collègue…

---

### 4. Brief du lundi matin

**Trigger :** Chaque lundi à 8h (cron)
**Ce qu'elle fait :**
1. Collecte les données de la semaine : nouvelles notes, interactions, tâches
2. Si Ollama est disponible : génère un résumé via LLM
3. Sinon : génère un template statique avec les données brutes
4. Crée une note "Brief semaine du [date]" dans l'Inbox

**Configurer :**
- Jour et heure
- Modèle Ollama (si dispo)
- Sections à inclure : notes de la semaine, interactions, projets actifs, finance

---

## Créer une routine

1. Sidebar > Routines > "Nouvelle routine"
2. Donne un nom et une description
3. Choisis le trigger :
   - **Cron** : interface en langage naturel ("Tous les lundis à 9h", "Le 1er du mois", "Tous les 14 jours")
   - **Alarme** : sélectionne un type d'entité et un champ date
   - **Event** : entité créée / modifiée / supprimée, transition de workflow
4. Ajoute des conditions (optionnel) : expressions sur les données
5. Ajoute des actions :

### Actions disponibles

| Action | Description |
|---|---|
| Créer une note dans Inbox | Rappel, brief, note automatique |
| Créer / mettre à jour une entité | Créer une Interaction, changer un statut |
| Créer une relation | Lier deux entités |
| Notification OS | Toast système (alarme, rappel) |
| Notification in-app | Message dans le centre de notifications Supernote |
| Brouillon email | Ouvre un brouillon dans le client mail OS |
| Appeler un webhook | HTTP POST vers une URL externe |
| Prompt LLM (Ollama) | Génère du texte et l'insère dans une note |
| Script JS sandboxé | Code JavaScript custom |

---

## Dashboard Routines

Sidebar > Routines affiche :

- Liste des routines actives / pausées
- Prochaine exécution de chacune
- Dernière exécution : statut (succès / échec), durée
- Journal des runs récents (table `AutomationRun`)

```
[screenshot: dashboard routines avec liste et prochaines exécutions]
```

---

## DSL YAML (pour les power users)

Les routines sont stockées dans `.supernote/automations/` en YAML. Tu peux les éditer directement :

```yaml
name: Rappel anniversaire
description: Notification J-1 pour les anniversaires
trigger:
  type: alarm
  entity_type: personne
  field: birthday
  offset: -1d
  time: "09:00"
conditions: []
actions:
  - type: notification_os
    title: "Anniversaire demain : {{name}}"
    body: "{{name}} fête ses {{age}} ans demain."
  - type: create_note
    vault_path: "Inbox/Rappel anniversaire {{name}}.md"
    template: |
      # Anniversaire de {{name}}
      Date : {{birthday}}
      Idées de message : ...
enabled: true
```

---

## Logs d'exécution

Chaque exécution est enregistrée dans la table `AutomationRun` :

| Champ | Contenu |
|---|---|
| `automationId` | ID de la routine |
| `triggeredAt` | Timestamp de déclenchement |
| `status` | success / failure / skipped |
| `durationMs` | Durée d'exécution |
| `payload` | Données d'entrée |
| `error` | Message d'erreur si échec |

Accessible via Routines > clic sur une routine > "Historique".
