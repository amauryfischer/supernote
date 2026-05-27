// HeroUI checklist item — replaces BlockNote's default checkListItem so the
// rendered checkbox uses @heroui/react's Checkbox component instead of a
// native <input type="checkbox"> styled by global CSS. The block keeps the
// "checkListItem" type name + `checked` prop shape so existing serialization
// (markdown `- [ ] ... ` / `- [x] ...`) round-trips unchanged.
//
// On hover the item exposes quick Eisenhower controls (importance dot +
// urgent flame). These edit the trailing inline metadata tokens directly in
// the block's content — `🔴/🟠/🟡/🔵` for importance and `🔥` for urgency —
// which the /todos projection (apps/web `inlineMetadata`) already understands.
// We only touch plain-text inline nodes, so wikilinks/links/marks in the todo
// text survive a toggle untouched.

import { createReactBlockSpec } from "@blocknote/react";
import { Button, Checkbox } from "@heroui/react";
import * as React from "react";

type TodoImportance = "low" | "medium" | "high" | "critical";

const IMPORTANCE_EMOJI: Record<TodoImportance, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};
const IMPORTANCE_COLOR: Record<TodoImportance, string> = {
  critical: "#EF4444",
  high: "#F97316",
  medium: "#FBBF24",
  low: "#22C55E",
};
const IMPORTANCE_LABEL: Record<TodoImportance, string> = {
  critical: "Critique",
  high: "Haute",
  medium: "Moyenne",
  low: "Basse",
};
const IMPORTANCE_ORDER: TodoImportance[] = ["low", "medium", "high", "critical"];
const ALL_IMPORTANCE_EMOJI = Object.values(IMPORTANCE_EMOJI);
const URGENT_EMOJI = "🔥";

// Loose inline-content shape — BlockNote's generic inline type is too strict
// for the intermediate edits we make here (mirrors the pattern used by the
// markdown serializer/parser in ../serialization).
interface TextInline {
  type: "text";
  text: string;
  styles?: Record<string, unknown>;
}
type Inline = TextInline | { type: string; [key: string]: unknown };

function isText(it: Inline): it is TextInline {
  return it.type === "text" && typeof (it as TextInline).text === "string";
}

function plainText(content: Inline[]): string {
  return content.map((it) => (isText(it) ? it.text : "")).join("");
}

/** Remove every occurrence of the given tokens from plain-text nodes,
 *  collapsing the whitespace they leave behind. Non-text nodes pass through
 *  untouched so links/wikilinks/marks are preserved. */
function stripTokens(content: Inline[], tokens: string[]): Inline[] {
  return content.map((it) => {
    if (!isText(it)) return it;
    let t = it.text;
    for (const tok of tokens) t = t.split(tok).join("");
    t = t.replace(/\s{2,}/g, " ");
    return { ...it, text: t };
  });
}

/** Append a token to the last text node (single-space separated), or push a
 *  new trailing text node when there is none. */
function appendToken(content: Inline[], token: string): Inline[] {
  const arr = [...content];
  for (let i = arr.length - 1; i >= 0; i--) {
    const it = arr[i]!;
    if (isText(it)) {
      const cur = it.text.replace(/\s+$/, "");
      arr[i] = { ...it, text: cur.length > 0 ? `${cur} ${token}` : token };
      return arr;
    }
  }
  arr.push({ type: "text", text: token, styles: {} });
  return arr;
}

/** Drop empty text nodes and trim trailing whitespace on the last text node
 *  so the serialized markdown stays clean. */
function cleanup(content: Inline[]): Inline[] {
  const out = content.filter((it) => !(isText(it) && it.text === ""));
  for (let i = out.length - 1; i >= 0; i--) {
    const it = out[i]!;
    if (isText(it)) {
      out[i] = { ...it, text: it.text.replace(/\s+$/, "") };
      break;
    }
    break;
  }
  return out;
}

function detectImportance(text: string): TodoImportance | null {
  for (const lvl of IMPORTANCE_ORDER) {
    if (text.includes(IMPORTANCE_EMOJI[lvl])) return lvl;
  }
  return null;
}

interface CheckItemControlsProps {
  content: Inline[];
  onChange: (next: Inline[]) => void;
}

function CheckItemControls({ content, onChange }: CheckItemControlsProps) {
  const text = plainText(content);
  const urgent = text.includes(URGENT_EMOJI);
  const importance = detectImportance(text);

  const setImportance = (lvl: TodoImportance) => {
    // Clicking the active level clears it back to the implicit "medium".
    const target = importance === lvl ? "medium" : lvl;
    let next = stripTokens(content, ALL_IMPORTANCE_EMOJI);
    if (target !== "medium") next = appendToken(next, IMPORTANCE_EMOJI[target]);
    onChange(cleanup(next));
  };

  const toggleUrgent = () => {
    let next = stripTokens(content, [URGENT_EMOJI]);
    if (!urgent) next = appendToken(next, URGENT_EMOJI);
    onChange(cleanup(next));
  };

  // Importance levels worth a one-click dot — medium is the implicit default,
  // so we expose the three that actually signal something.
  const dotLevels: TodoImportance[] = ["high", "critical", "low"];

  return (
    <span className="sn-checkitem__meta" contentEditable={false}>
      {dotLevels.map((lvl) => {
        const active = importance === lvl;
        return (
          <Button
            key={lvl}
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={`Importance : ${IMPORTANCE_LABEL[lvl]}`}
            onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
            onPress={() => setImportance(lvl)}
            className="sn-checkitem__meta-btn"
          >
            <span
              className="sn-checkitem__dot"
              style={{
                backgroundColor: IMPORTANCE_COLOR[lvl],
                boxShadow: active ? `0 0 0 2px var(--surface-0), 0 0 0 3.5px ${IMPORTANCE_COLOR[lvl]}` : "none",
              }}
            />
          </Button>
        );
      })}
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={urgent ? "Retirer urgent" : "Marquer urgent"}
        onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
        onPress={toggleUrgent}
        className="sn-checkitem__meta-btn"
        style={{ opacity: urgent ? 1 : 0.35, filter: urgent ? "none" : "grayscale(1)" }}
      >
        <span aria-hidden>🔥</span>
      </Button>
    </span>
  );
}

export const heroCheckListItemSpec = createReactBlockSpec(
  {
    type: "checkListItem" as const,
    propSchema: {
      checked: {
        default: false,
        values: [true, false] as const,
      },
    },
    content: "inline" as const,
  },
  {
    render: ({ block, editor, contentRef }) => {
      const checked = !!block.props.checked;
      const content = (block.content as unknown as Inline[]) ?? [];
      return (
        <div className="sn-checkitem" data-checked={checked ? "true" : "false"}>
          {/* contentEditable=false keeps ProseMirror from intercepting clicks
              on the checkbox itself; the inline-content area below stays
              editable. */}
          <span className="sn-checkitem__control" contentEditable={false}>
            <Checkbox
              variant="secondary"
              isSelected={checked}
              onChange={(next: boolean) => {
                editor.updateBlock(block, { props: { checked: next } });
              }}
              aria-label={checked ? "Marquer comme non faite" : "Marquer comme faite"}
            >
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
            </Checkbox>
          </span>
          {/* Block-level container — span used to be inline, which left
              ProseMirror's caret without a renderable box right after the
              `[ ]`/`[x]` markdown transform (cursor invisible until first
              keystroke). A div has a guaranteed layout box even empty. */}
          <div
            className="sn-checkitem__text"
            ref={contentRef as unknown as React.Ref<HTMLDivElement>}
          />
          <CheckItemControls
            content={content}
            onChange={(next) => {
              // BlockNote's PartialInlineContent generic rejects our loose
              // intermediate array; the runtime values are compatible.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              editor.updateBlock(block, { content: next as any });
            }}
          />
        </div>
      );
    },
    toExternalHTML: ({ block, contentRef }) => {
      // Plain HTML for clipboard/export. The interactive Checkbox renderer
      // is editor-only; on copy we emit a simple <li> with a native input.
      const checked = !!block.props.checked;
      return (
        <li className="sn-checkitem-export" data-checked={checked ? "true" : "false"}>
          <input type="checkbox" checked={checked} readOnly />
          <span ref={contentRef as unknown as React.Ref<HTMLSpanElement>} />
        </li>
      );
    },
  },
);
