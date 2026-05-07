# Intelligence artificielle

L'IA dans Supernote fonctionne entièrement en local. Rien ne sort vers un cloud. Deux modes coexistent : les **embeddings ONNX** (toujours actifs, légers) et **Ollama** (optionnel, plus puissant).

---

## Ce que l'IA fait automatiquement

### Auto-tagging

A chaque sauvegarde d'une note, Supernote analyse le contenu et propose des tags pertinents.

Comment ça marche :
1. Le contenu de la note est comparé aux tags existants dans ton vault via embeddings cosine (`all-MiniLM-L6-v2`)
2. Si Ollama est disponible : l'agent reçoit le contenu + la liste des tags existants avec leurs descriptions, et propose 0 à 5 tags
3. Si Ollama n'est pas disponible : fallback silencieux sur les embeddings seuls

Les tags suggérés sont **appliqués automatiquement** mais marqués `source: ai-suggested` — visuels distincts (pill grisée). Tu peux les retirer en 1 clic ou les valider.

### Détection de mentions implicites

Si le texte contient "réunion avec Jean" et que Jean Dupont existe dans ton CRM, Supernote propose de wrapper son nom en `@Jean Dupont`. Une petite bannière non-intrusive s'affiche en bas de l'éditeur.

### Extraction d'actions

Dans une note de réunion, Supernote détecte les phrases du type "je dois", "TODO", "à faire", "action :" et propose de créer des items dans une liste de tâches liée. Apparaît en bannière après sauvegarde.

### Auto-classification

Si une note ressemble fortement à un type d'entité (ex : tu prends des notes sur une réunion et ça ressemble à une Interaction), Supernote propose de la convertir. Bannière non-intrusive, jamais automatique.

---

## Configurer Ollama

[Ollama](https://ollama.ai) est un runtime local pour les LLMs. Supernote le détecte automatiquement s'il tourne sur `localhost:11434`.

### Installation Ollama

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows
# télécharger l'installeur sur https://ollama.ai
```

### Télécharger un modèle

```bash
# Modèle recommandé (bon équilibre taille/qualité)
ollama pull llama3.2

# Modèle léger (3B, pour machines avec moins de RAM)
ollama pull llama3.2:3b

# Modèle de qualité supérieure si tu as un GPU
ollama pull llama3.1:70b
```

### Configurer dans Supernote

Settings > IA :

| Paramètre | Description | Défaut |
|---|---|---|
| `ai.ollamaUrl` | URL du daemon Ollama | `http://localhost:11434` |
| `ai.model` | Modèle à utiliser | `llama3.2` |
| `ai.autoTag` | Active l'auto-tagging | `true` |
| `ai.autoMention` | Détection de mentions implicites | `true` |
| `ai.autoExtractActions` | Extraction d'actions | `true` |
| `ai.autoClassify` | Suggestions de type | `true` |

---

## Actions IA sur demande

Depuis le menu `...` d'une note ou via la palette `Cmd+K` :

| Action | Description |
|---|---|
| Résumer | Génère un résumé de la note |
| Extraire les actions | Liste les tâches implicites |
| Réécrire | Améliore le style ou reformule |
| Traduire | Traduit dans la langue choisie |
| Auto-tagger (re-trigger) | Relance la suggestion de tags |
| Suggérer entités à mentionner | Détecte les entités non-mentionnées |
| Compléter | Continue la note dans le même style |

Ces actions utilisent Ollama si disponible, sinon affichent un message indiquant qu'Ollama est requis.

---

## "Ask my notes" (RAG)

Pose une question en langage naturel sur ton vault.

```
[screenshot: interface Ask my notes avec question et réponse citant des sources]
```

Comment ça fonctionne :
1. Ta question est convertie en vecteur (ONNX)
2. Recherche des top-k chunks les plus proches dans les embeddings du vault
3. Ces chunks sont injectés dans un prompt Ollama
4. La réponse cite ses sources (avec liens vers les notes)

Accessible via `Cmd+K` > "Ask my notes" ou la barre de recherche > icône IA.

---

## Recherche sémantique

Même sans Ollama, la recherche sémantique fonctionne via les embeddings ONNX.

Dans la barre de recherche avancée (`Cmd+Shift+F`), coche "Recherche intelligente" :
- Les résultats incluent des notes conceptuellement proches, pas seulement des correspondances exactes
- Exemple : chercher "réunion client" trouve aussi "call commercial", "démo produit"
- Le score de pertinence combine FTS5 (exacte) et cosine similarity (sémantique)

---

## Embeddings

Le modèle d'embeddings utilisé est **`Xenova/all-MiniLM-L6-v2`** (via transformers.js / ONNX Runtime). Il tourne dans un worker thread Node.js dédié — il ne bloque jamais l'interface.

- Taille du modèle : ~25 MB
- Dimensions : 384
- Stockage : JSON BLOB dans la table `Embedding` de SQLite
- Recalcul : automatique quand le contenu d'une entité change (hash comparison)

---

## Confidentialité et désactivation

- Tout est local. Les embeddings ONNX ne font aucune requête réseau.
- Ollama tourne localement — tes données ne quittent jamais ta machine.
- Pour désactiver l'IA complètement : Settings > IA > décocher "Activer l'IA"
- Pour désactiver seulement l'auto-tagging : Settings > IA > décocher "Auto-tagging"

---

## Transcription vocale

Enregistre une note vocale (`/audio` ou depuis la capture rapide) → Supernote transcrit automatiquement avec **whisper.cpp** (WASM, 100% local).

Modèles whisper disponibles : `tiny` (rapide), `base` (équilibre), `small` (qualité). Configurable dans Settings > IA > Transcription.

## OCR

Colle ou glisse une image dans une note → Supernote extrait le texte avec **Tesseract.js** (WASM, 100% local). Le texte extrait est ajouté comme bloc sous l'image et indexé pour la recherche.
