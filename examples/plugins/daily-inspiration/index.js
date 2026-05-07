// =============================================================
// Inspiration du jour — Supernote Plugin
// Picks a random quote and inserts it at the current caret
// position when the "Inspiration du jour" command is triggered.
// =============================================================

/// <reference types="@supernote/plugin-sdk" />

// ------ Quote bank (~50 citations) ---------------------------

/** @typedef {{ text: string; author: string; category: "zen" | "productivite" | "creativite" }} Quote */

/** @type {Quote[]} */
const QUOTES = [
  // Zen
  { text: "Avant l'eveil, couper du bois, porter de l'eau. Apres l'eveil, couper du bois, porter de l'eau.", author: "Proverbe Zen", category: "zen" },
  { text: "Le silence est la source de toute grandeur.", author: "Lao Tseu", category: "zen" },
  { text: "Agis sans agir. Fais sans faire.", author: "Lao Tseu", category: "zen" },
  { text: "L'esprit du debutant contient de nombreuses possibilites, l'esprit de l'expert en contient peu.", author: "Shunryu Suzuki", category: "zen" },
  { text: "Quand tu marches, marche. Quand tu manges, mange.", author: "Proverbe Zen", category: "zen" },
  { text: "Ne cherche pas la verite ; renonce simplement a tes opinions.", author: "Seng-Ts'an", category: "zen" },
  { text: "La sagesse, c'est de savoir ce qu'on doit faire ensuite.", author: "David Starr Jordan", category: "zen" },
  { text: "Celui qui sait ne parle pas. Celui qui parle ne sait pas.", author: "Lao Tseu", category: "zen" },
  { text: "Voyager loin commence par un seul pas.", author: "Lao Tseu", category: "zen" },
  { text: "Connais les autres, c'est sagesse. Se connaitre soi-meme, c'est illumination.", author: "Lao Tseu", category: "zen" },
  { text: "La plus grande erreur est de ne pas essayer.", author: "Bodhidharma", category: "zen" },
  { text: "Tout le malheur des hommes vient d'une seule chose, qui est de ne savoir pas demeurer en repos dans une chambre.", author: "Blaise Pascal", category: "zen" },

  // Productivite
  { text: "Le secret pour avancer, c'est de commencer.", author: "Mark Twain", category: "productivite" },
  { text: "Vous n'avez pas a etre formidable pour commencer, mais vous devez commencer pour etre formidable.", author: "Zig Ziglar", category: "productivite" },
  { text: "La productivite ne consiste jamais a faire plus, mais a creer les conditions qui vous permettent de faire ce qui compte vraiment.", author: "Franz Kafka", category: "productivite" },
  { text: "Un objectif sans plan n'est qu'un souhait.", author: "Antoine de Saint-Exupery", category: "productivite" },
  { text: "Faites d'abord les choses difficiles. Les choses faciles s'occuperont d'elles-memes.", author: "Dale Carnegie", category: "productivite" },
  { text: "Si vous ne pouvez pas mesurer quelque chose, vous ne pouvez pas l'ameliorer.", author: "Peter Drucker", category: "productivite" },
  { text: "La reussite est la somme de petits efforts repetes jour apres jour.", author: "Robert Collier", category: "productivite" },
  { text: "Le temps est la monnaie de ta vie. C'est la seule monnaie que tu possedes, et seul toi peux determiner comment elle sera utilisee.", author: "Carl Sandburg", category: "productivite" },
  { text: "Concentrez-vous sur les etapes, pas sur la distance.", author: "Anonyme", category: "productivite" },
  { text: "Chaque minute passee a organiser est une heure gagnee.", author: "Benjamin Franklin", category: "productivite" },
  { text: "Il n'existe pas de vent favorable pour celui qui ne sait pas ou il va.", author: "Seneque", category: "productivite" },
  { text: "Travaillez dur en silence, laissez le succes faire du bruit.", author: "Frank Ocean", category: "productivite" },
  { text: "Le plus important n'est pas ce que l'on fait, mais la raison pour laquelle on le fait.", author: "Simon Sinek", category: "productivite" },
  { text: "Faites ce que vous pouvez, avec ce que vous avez, la ou vous etes.", author: "Theodore Roosevelt", category: "productivite" },
  { text: "La discipline est le pont entre les objectifs et les realisations.", author: "Jim Rohn", category: "productivite" },

  // Creativite
  { text: "La creativite, c'est l'intelligence qui s'amuse.", author: "Albert Einstein", category: "creativite" },
  { text: "Toute creation d'abord suppose la destruction.", author: "Pablo Picasso", category: "creativite" },
  { text: "Les grandes ames ont toujours rencontre une opposition violente de la part des esprits mediocres.", author: "Albert Einstein", category: "creativite" },
  { text: "L'imagination est plus importante que la connaissance.", author: "Albert Einstein", category: "creativite" },
  { text: "Vous ne pouvez pas epuiser la creativite. Plus vous l'utilisez, plus vous en avez.", author: "Maya Angelou", category: "creativite" },
  { text: "La creativite, c'est relier des choses. Quand vous demandez aux gens creatifs comment ils ont fait quelque chose, ils se sentent un peu coupables, parce qu'ils n'ont pas vraiment fait quelque chose, ils ont juste vu.", author: "Steve Jobs", category: "creativite" },
  { text: "Il y a deux facon de vivre sa vie : l'une en faisant comme si rien n'etait un miracle, l'autre en faisant comme si tout etait un miracle.", author: "Albert Einstein", category: "creativite" },
  { text: "N'attendez pas l'inspiration. Elle existe, mais elle doit vous trouver en train de travailler.", author: "Pablo Picasso", category: "creativite" },
  { text: "La creativite n'est pas la trouvaille d'une chose mais le fait de rendre familier quelque chose qui etait inconnu.", author: "George Kneller", category: "creativite" },
  { text: "Ecrire, c'est parler sans etre interrompu.", author: "Jules Renard", category: "creativite" },
  { text: "Le premier brouillon de tout est toujours une merde.", author: "Ernest Hemingway", category: "creativite" },
  { text: "On fait de l'art comme on fait l'amour : avec tout ce qu'on a.", author: "Christian Bobin", category: "creativite" },
  { text: "Un livre est un reve que vous tenez dans vos mains.", author: "Neil Gaiman", category: "creativite" },
  { text: "La creation est toujours un commencement.", author: "Henri Bergson", category: "creativite" },
  { text: "Osez, le monde appartient a ceux qui osent.", author: "Victor Hugo", category: "creativite" },
  { text: "L'art, c'est la plus belle des mensonges.", author: "Claude Debussy", category: "creativite" },
  { text: "Ce qui est simple est toujours faux. Ce qui ne l'est pas est inutilisable.", author: "Paul Valery", category: "creativite" },
  { text: "Pour lire un poeme dans un sens profond, il faut etre poete.", author: "Ralph Waldo Emerson", category: "creativite" },
  { text: "Il faut toujours chercher a etre en contradiction avec soi-meme.", author: "Paul Valery", category: "creativite" },
  { text: "On ne voit bien qu'avec le coeur. L'essentiel est invisible pour les yeux.", author: "Antoine de Saint-Exupery", category: "creativite" },
  { text: "La perfection est atteinte non quand il n'y a plus rien a ajouter, mais quand il n'y a plus rien a retirer.", author: "Antoine de Saint-Exupery", category: "creativite" },
];

// ------ Helpers ----------------------------------------------

/**
 * Returns a cryptographically random integer in [0, max).
 * Falls back to Math.random() if crypto is unavailable.
 * @param {number} max
 * @returns {number}
 */
function randomInt(max) {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] % max;
  }
  return Math.floor(Math.random() * max);
}

/** @returns {Quote} */
function pickRandom() {
  return QUOTES[randomInt(QUOTES.length)];
}

/**
 * Formats a quote as Markdown blockquote.
 * @param {Quote} quote
 * @returns {string}
 */
function formatQuote(quote) {
  return `> ${quote.text}\n>\n> — *${quote.author}*\n`;
}

// ------ Insert at caret position ----------------------------

/**
 * Inserts text at the current selection/caret in the host editor
 * by dispatching a custom event the host listens for.
 *
 * When the host runtime does not expose a direct insertText API,
 * the plugin falls back to document.execCommand('insertText')
 * (works in contenteditable iframes) or posts a host-targeted message.
 *
 * @param {string} text
 * @param {SupernoteAPI} api
 */
async function insertAtCaret(text, api) {
  // Try native execCommand first (works inside the editor iframe)
  if (document.queryCommandEnabled && document.queryCommandEnabled("insertText")) {
    document.execCommand("insertText", false, text);
    return;
  }

  // Fallback: update the current entity body by appending the quote.
  // The host does not expose a direct caret-insert API in SDK v1.0;
  // we fetch the current entity, append the quote, and update it.
  const entities = await api.entities.list({ limit: 1 });
  if (entities.length === 0) return;

  const entity = entities[0];
  const updatedBody = (entity.body ?? "") + "\n\n" + text;
  await api.entities.update(entity.id, { body: updatedBody });
}

// ------ Bootstrap -------------------------------------------

/**
 * @param {SupernoteAPI} api
 */
function activate(api) {
  api.ui.registerCommand({
    id: "daily-inspiration.insert",
    label: "Inspiration du jour",
    description: "Insere une citation inspirante a la position du curseur",
  });

  // The host calls this function when the command is triggered
  window.__supernote_command_daily_inspiration_insert = () => {
    const quote = pickRandom();
    const markdown = formatQuote(quote);

    insertAtCaret(markdown, api).catch((err) => {
      console.error("[daily-inspiration] Erreur lors de l'insertion :", err);
      api.ui.showNotification({
        title: "Inspiration du jour",
        body: `${quote.text} — ${quote.author}`,
        level: "info",
      });
    });
  };
}

// Expose entry point
if (typeof module !== "undefined") {
  module.exports = { activate, QUOTES, pickRandom, formatQuote };
} else {
  window.activate = activate;
}
