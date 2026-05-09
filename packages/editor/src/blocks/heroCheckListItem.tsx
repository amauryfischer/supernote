// HeroUI checklist item — replaces BlockNote's default checkListItem so the
// rendered checkbox uses @heroui/react's Checkbox component instead of a
// native <input type="checkbox"> styled by global CSS. The block keeps the
// "checkListItem" type name + `checked` prop shape so existing serialization
// (markdown `- [ ] ... ` / `- [x] ...`) round-trips unchanged.

import { createReactBlockSpec } from "@blocknote/react";
import { Checkbox } from "@heroui/react";
import * as React from "react";

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
          <span
            className="sn-checkitem__text"
            ref={contentRef as unknown as React.Ref<HTMLSpanElement>}
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
