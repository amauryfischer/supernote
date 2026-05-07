// Script to create a minimal Notion export ZIP fixture for tests
// Run once: ts-node create-fixture.ts

import { createWriteStream } from "node:fs";
import path from "node:path";
import archiver from "archiver";

const output = createWriteStream(path.join(import.meta.dirname, "export.zip"));
const archive = archiver("zip", { zlib: { level: 9 } });

archive.pipe(output);

archive.append(
  `---
created: 2024-01-01T00:00:00Z
updated: 2024-01-02T00:00:00Z
tags: [work, project]
---

# My Notion Page

This is a page from Notion.

Some content with [[Sub Page]] link.
`,
  { name: "My Notion Page/My Notion Page.md" }
);

archive.append(
  `---
created: 2024-01-03T00:00:00Z
---

# Sub Page

Child of My Notion Page.
`,
  { name: "My Notion Page/Sub Page.md" }
);

archive.append(
  `Name,Status,Due Date\nProject Alpha,In Progress,2024-03-01\nProject Beta,Done,2024-02-15`,
  { name: "Projects Database.csv" }
);

archive.finalize();
output.on("close", () => console.log("Fixture ZIP created"));
