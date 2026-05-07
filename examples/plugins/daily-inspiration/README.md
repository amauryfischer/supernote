# Inspiration du jour

Plugin Supernote qui insere une citation inspirante (Zen, productivite, creativite) a la position du curseur via la palette de commandes ⌘K.

## Fonctionnalites

- 50 citations dans 3 categories : Zen, Productivite, Creativite
- Selection aleatoire a chaque declenchement (crypto.getRandomValues)
- Insertion en Markdown blockquote a la position du curseur
- Fallback : si pas de curseur actif, la citation est ajoutee a la fin de la note ouverte
- Fallback notification si aucune note n'est ouverte

## Installation

Copiez le dossier dans votre vault :

```
<vault>/.supernote/plugins/com.supernote.daily-inspiration/
  manifest.json
  index.js
```

Puis rechargez Supernote (Settings > Plugins > Actualiser).

## Utilisation

1. Ouvrez une note
2. Placez le curseur a l'endroit souhaite
3. Ouvrez la palette ⌘K
4. Tapez **"Inspiration"** et selectionnez **"Inspiration du jour"**

La citation s'insere au format Markdown :

```markdown
> La creativite, c'est l'intelligence qui s'amuse.
>
> — *Albert Einstein*
```

## Ajouter des citations

Editez le tableau `QUOTES` dans `index.js`. Chaque citation suit la structure :

```js
{
  text: "Votre citation ici.",
  author: "Nom de l'auteur",
  category: "zen" | "productivite" | "creativite"
}
```

## Developpement local

```bash
pnpm install
pnpm build
cp -r dist/ "<vault>/.supernote/plugins/com.supernote.daily-inspiration/"
```

## Permissions requises

| Permission | Usage |
|---|---|
| `commands:register` | Enregistre la commande dans la palette ⌘K |
| `entities:write` | Mise a jour du corps de la note (fallback si pas de curseur) |
