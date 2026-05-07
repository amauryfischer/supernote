// =============================================================
// Word Counter — Supernote Plugin
// Counts words in the current entity body after each save and
// displays the count in a sidebar command / notification.
// =============================================================

/// <reference types="@supernote/plugin-sdk" />

// ------ Word counting logic ----------------------------------

/**
 * Strips markdown syntax and counts words.
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  if (!text || text.trim().length === 0) return 0;

  const stripped = text
    // Remove markdown headings, bold, italic, code blocks, links
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/!\[.*?\]\(.*?\)/g, " ")
    .replace(/\[.*?\]\(.*?\)/g, " ")
    .replace(/[#*_~>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (stripped.length === 0) return 0;

  return stripped.split(/\s+/).length;
}

/**
 * @param {number} count
 * @returns {string}
 */
function formatLabel(count) {
  return count === 1 ? "1 mot" : `${count} mots`;
}

// ------ Storage key ------------------------------------------

const STORAGE_KEY = "lastWordCount";

// ------ Core handler -----------------------------------------

/**
 * Called after each save. Fetches the entity, counts words,
 * and stores/displays the result.
 *
 * @param {SupernoteAPI} api
 * @param {{ entityId: string }} payload
 */
async function onAfterSave(api, payload) {
  if (!payload || !payload.entityId) return;

  const entity = await api.entities.get(payload.entityId);
  if (!entity) return;

  const count = countWords(entity.body ?? "");
  const label = formatLabel(count);

  // Persist last count so we can restore it on plugin reload
  await api.storage.set(STORAGE_KEY, count);

  // Surface the count as a notification (status bar update is
  // performed via registerCommand label update when the host
  // supports it; fall back to a subtle info notification).
  api.ui.showNotification({
    title: "Compteur de mots",
    body: label,
    level: "info",
  });
}

// ------ Bootstrap --------------------------------------------

/**
 * @param {SupernoteAPI} api
 */
async function activate(api) {
  // Register a manual refresh command in the palette
  api.ui.registerCommand({
    id: "word-counter.refresh",
    label: "Compteur de mots : Actualiser",
    description: "Force le recomptage des mots de la note courante",
  });

  // Subscribe to afterSave hook
  api.hooks.on("afterSave", (payload) => {
    onAfterSave(api, /** @type {any} */ (payload)).catch(console.error);
  });

  // Restore previous count from storage (displayed on boot)
  const previous = await api.storage.get(STORAGE_KEY);
  if (typeof previous === "number") {
    console.info(`[word-counter] Dernier compte connu : ${formatLabel(previous)}`);
  }
}

// Expose entry point
if (typeof module !== "undefined") {
  module.exports = { activate };
} else {
  window.activate = activate;
}
