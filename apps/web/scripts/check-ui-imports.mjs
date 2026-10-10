import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED = new Set([
  "Spinner", "Popover", "ListBox", "ListBoxItem", "ProgressBar", "TabsRoot", "TabList", "Tab", "Key",
]);
const root = fileURLToPath(new URL("../src", import.meta.url));
// La clause exclut quotes et `;` : le match ne peut pas enjamber un autre import.
const IMPORT_RE = /\b(?:import|export)\s+(?:type\s+)?([^;'"]*?)\s*from\s*["']@heroui\/react["']/g;

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

const errors = [];
for (const file of walk(root)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(IMPORT_RE)) {
    const clause = m[1];
    const clauseStart = m.index + m[0].indexOf(clause);
    const lineAt = (offset) => src.slice(0, clauseStart + offset).split("\n").length;
    const at = `apps/web/src/${relative(root, file)}`;
    const brace = clause.indexOf("{");
    const outside = brace === -1 ? clause : clause.slice(0, brace);
    if (outside.replace(/,/g, "").trim()) {
      errors.push(`${at}:${lineAt(0)} import default/namespace depuis @heroui/react`);
    }
    if (brace === -1) continue;
    const inner = clause.slice(brace + 1, clause.lastIndexOf("}"));
    for (const n of inner.matchAll(/(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+[\w$]+)?/g)) {
      if (ALLOWED.has(n[1])) continue;
      errors.push(`${at}:${lineAt(brace + 1 + n.index)} ${n[1]} hors liste blanche (utiliser @supernote/ui)`);
    }
  }
}

if (errors.length) {
  console.error(`Imports interdits depuis @heroui/react :\n${errors.map((e) => `  ${e}`).join("\n")}`);
  process.exit(1);
}
