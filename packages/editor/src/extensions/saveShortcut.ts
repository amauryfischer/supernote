// Keyboard extension for Ctrl/Cmd+S save shortcut

import { Extension } from "@tiptap/core";

/** Create a Tiptap extension that fires a custom "supernote:save" event on Ctrl/Cmd+S */
export function createSaveExtension(onSave: () => void): Extension {
  return Extension.create({
    name: "supernoteSave",
    addKeyboardShortcuts() {
      return {
        "Mod-s": () => {
          onSave();
          return true;
        },
      };
    },
  });
}
