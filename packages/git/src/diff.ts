import type { GitDiff, GitDiffHunk, GitDiffLine } from "./types.js";

/** Parse a unified diff string into structured hunks */
export function parseUnifiedDiff(
  unified: string,
  path: string,
  commitSha: string,
): GitDiff {
  const lines = unified.split("\n");
  const hunks: GitDiffHunk[] = [];
  let currentHunk: GitDiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldLineNo = match ? parseInt(match[1] ?? "0", 10) : 0;
      newLineNo = match ? parseInt(match[2] ?? "0", 10) : 0;
      currentHunk = { header: line, lines: [] };
      hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue;

    const diffLine = parseDiffLine(line, oldLineNo, newLineNo);
    if (!diffLine) continue;

    currentHunk.lines.push(diffLine);
    if (diffLine.type === "add") {
      additions++;
      newLineNo++;
    } else if (diffLine.type === "remove") {
      deletions++;
      oldLineNo++;
    } else {
      oldLineNo++;
      newLineNo++;
    }
  }

  return { path, commitSha, hunks, additions, deletions };
}

function parseDiffLine(
  line: string,
  oldLineNo: number,
  newLineNo: number,
): GitDiffLine | null {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return { type: "add", content: line.slice(1), newLineNo };
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return { type: "remove", content: line.slice(1), oldLineNo };
  }
  if (line.startsWith(" ")) {
    return { type: "context", content: line.slice(1), oldLineNo, newLineNo };
  }
  return null;
}

/** Produce a simple unified diff from two strings */
export function buildUnifiedDiff(
  oldContent: string,
  newContent: string,
  path: string,
): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Simple LCS-based diff; for large files use a full Myers diff.
  // Here we output a single hunk covering all lines for simplicity.
  const header = `--- a/${path}\n+++ b/${path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@`;
  const removed = oldLines.map((l) => `-${l}`).join("\n");
  const added = newLines.map((l) => `+${l}`).join("\n");
  return `${header}\n${removed}\n${added}`;
}
