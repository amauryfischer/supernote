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
  // so we expose the three that actually signal something. Ordered as a
  // severity ramp (green → orange → red) so the inline pastilles read
  // low → high → critical left-to-right.
  const dotLevels: TodoImportance[] = ["low", "high", "critical"];

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

// Fixed particle directions for the confetti burst — precomputed (no
// Math.random at render) so the burst is deterministic and cheap. Roughly a
// circle with some radius jitter for an organic feel.
const BURST_PARTICLES: Array<{ dx: number; dy: number }> = [
  { dx: 14, dy: -10 },
  { dx: 18, dy: 2 },
  { dx: 10, dy: 14 },
  { dx: -2, dy: 18 },
  { dx: -14, dy: 12 },
  { dx: -18, dy: -2 },
  { dx: -10, dy: -14 },
  { dx: 2, dy: -18 },
];

/** Recursively collect every checkListItem block (any nesting depth). */
function collectCheckItems(
  blocks: Array<{ type?: string; id?: string; props?: Record<string, unknown>; children?: unknown[] }>,
): Array<{ id?: string; checked: boolean }> {
  const out: Array<{ id?: string; checked: boolean }> = [];
  for (const b of blocks) {
    if (b.type === "checkListItem") {
      out.push({ id: b.id, checked: !!(b.props as { checked?: boolean } | undefined)?.checked });
    }
    if (Array.isArray(b.children) && b.children.length > 0) {
      out.push(...collectCheckItems(b.children as typeof blocks));
    }
  }
  return out;
}

/** Confetti burst around the checkbox. Re-keyed on every check so the CSS
 *  animation restarts; particles are invisible by default and only appear
 *  through the (reduced-motion-gated) animation. */
function CheckBurst({ burstKey }: { burstKey: number }) {
  if (burstKey === 0) return null;
  return (
    <span key={burstKey} className="sn-check-burst" aria-hidden contentEditable={false}>
      {BURST_PARTICLES.map((p, i) => (
        <i
          key={i}
          style={{ "--dx": `${p.dx}px`, "--dy": `${p.dy}px` } as React.CSSProperties}
        />
      ))}
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
      // Bumped each time the user CHECKS (not unchecks) — keys the confetti
      // burst so its animation restarts on every completion. Auto-cleared
      // after the animation so the burst span (which also gates the
      // checkbox pop in CSS via :has) doesn't linger in the DOM.
      const [burstKey, setBurstKey] = React.useState(0);
      React.useEffect(() => {
        if (burstKey === 0) return;
        const t = setTimeout(() => setBurstKey(0), 700);
        return () => clearTimeout(t);
      }, [burstKey]);
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
                if (next) {
                  setBurstKey((k) => k + 1);
                  document.dispatchEvent(
                    new CustomEvent("supernote:ui-sound", { detail: { kind: "check" } }),
                  );
                  // Last unchecked todo of the document? → full celebration.
                  // Checked AFTER the local burst so the small pop still
                  // plays under the big one.
                  const all = collectCheckItems(
                    editor.document as unknown as Parameters<typeof collectCheckItems>[0],
                  );
                  const others = all.filter((c) => c.id !== block.id);
                  if (others.length > 0 && others.every((c) => c.checked)) {
                    document.dispatchEvent(new CustomEvent("supernote:celebrate"));
                    document.dispatchEvent(
                      new CustomEvent("supernote:ui-sound", { detail: { kind: "celebrate" } }),
                    );
                  }
                }
                editor.updateBlock(block, { props: { checked: next } });
              }}
              aria-label={checked ? "Marquer comme non faite" : "Marquer comme faite"}
            >
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
            </Checkbox>
            <CheckBurst burstKey={burstKey} />
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
