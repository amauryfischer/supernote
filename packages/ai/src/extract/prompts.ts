// ============================================================
// Prompt d'extraction d'actions — v2
// ============================================================

/**
 * v2 (remplace `ACTION_EXTRACT_PROMPT_V1` pour le journal) : le modèle rendait
 * les titres du gabarit comme actions, fusionnait deux actions reliées par
 * « et », et inventait des dates ISO faute de connaître le jour courant.
 *
 * Placeholders : `{{today}}`, `{{noteContent}}`.
 */
export const ACTION_EXTRACT_PROMPT_V2 = `Tu extrais les actions à faire d'une note de journal personnel.

Date du jour : {{today}}

RÈGLES STRICTES
1. Une entrée par action ATOMIQUE. Deux actions reliées par « et », « puis »,
   « ensuite » ou une virgule donnent DEUX entrées distinctes.
   Exemple : « rappeler le notaire avant vendredi et envoyer le devis demain »
   → deux actions : « rappeler le notaire » (deadlineText « avant vendredi »)
   et « envoyer le devis » (deadlineText « demain »).
2. N'extrais JAMAIS un titre de section (une ligne qui commence par #, ##, ###)
   ni un intitulé de gabarit vide. Ce sont des en-têtes, pas des actions.
3. "text" est une phrase d'action courte, SANS syntaxe markdown (pas de #, *,
   -, [ ], [[ ]]), et SANS l'expression de date.
4. "deadlineText" reprend MOT POUR MOT l'expression de date telle qu'écrite
   dans la note (« demain matin », « avant vendredi », « la semaine
   prochaine »…), ou null. Ne la traduis pas, ne la convertis pas.
5. "deadline" : la date ISO YYYY-MM-DD si tu es certain, sinon null.
6. "assignee" : la personne chargée de l'action si la note le dit, sinon null.
7. S'il n'y a aucune action, renvoie une liste vide. N'invente rien.

NOTE :
{{noteContent}}

Réponds UNIQUEMENT avec ce JSON :
{
  "actions": [
    {
      "text": "string",
      "assignee": "string ou null",
      "deadlineText": "string ou null",
      "deadline": "YYYY-MM-DD ou null",
      "priority": "high|medium|low"
    }
  ]
}`;
