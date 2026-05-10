"use client";

import { useEffect, useRef, useState } from "react";

export interface EditableTitleProps {
  value: string;
  onSave: (newValue: string) => Promise<void> | void;
  /** Called when the user presses Escape or the new value is empty. */
  onCancel?: () => void;
  /** Render function for read mode — receives the double-click + F2 props. */
  renderDisplay: (props: {
    onDoubleClick: React.MouseEventHandler;
    onKeyDown: React.KeyboardEventHandler;
    tabIndex: number;
  }) => React.ReactNode;
  /** Extra className for the <input> in edit mode. */
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
}

/**
 * Headless editable-title primitive used by FolderNode and NoteListItem.
 *
 * - Double-click on the rendered child enters edit mode.
 * - F2 on the rendered child also enters edit mode.
 * - Enter / blur saves (if non-empty and changed).
 * - Escape cancels.
 * - While editing, clicks that cause blur go to the input, not the parent.
 */
export function EditableTitle({
  value,
  onSave,
  onCancel,
  renderDisplay,
  inputClassName,
  inputStyle,
}: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft when the external value changes while NOT editing.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Focus + select all once the input mounts.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(value);
    setEditing(true);
  };

  const commit = async () => {
    const trimmed = draft.trim().replace(/[/\\]/g, "");
    if (!trimmed) {
      cancelEditing();
      return;
    }
    setEditing(false);
    if (trimmed !== value) {
      await onSave(trimmed);
    }
  };

  const cancelEditing = () => {
    setDraft(value);
    setEditing(false);
    onCancel?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      cancelEditing();
    }
  };

  // F2 on the display element
  const handleDisplayKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "F2") {
      e.preventDefault();
      startEditing();
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => void commit()}
        // Prevent clicks inside the input from bubbling to parent handlers
        onClick={(e) => e.stopPropagation()}
        className={inputClassName}
        style={inputStyle}
        aria-label="Renommer"
      />
    );
  }

  return (
    <>
      {renderDisplay({
        onDoubleClick: (e) => {
          e.stopPropagation();
          e.preventDefault();
          startEditing();
        },
        onKeyDown: handleDisplayKeyDown,
        tabIndex: 0,
      })}
    </>
  );
}
