"use client";

/**
 * useCreateInboxNote — manages lifecycle of a note being composed in WritingSurface.
 *
 * Persistence flow:
 *   - First save: create entity via `entities.create` with typeId="note", filePath in Inbox/.
 *   - Subsequent saves: update entity via `entities.update` with new body.
 *   - Auto-save: 5s debounce while the user is typing (silent, no toast).
 *   - Manual save (Cmd+S): immediate save with success toast.
 *   - Initial creation: triggered on first blur or after 2s of inactivity.
 *
 * File naming: delegated to main process via EntityType.fileNamePattern.
 * Fields include `title` derived from first line.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";

export interface NoteState {
  entityId: string | null;
  isSaving: boolean;
  lastSaved: Date | null;
  saveError: string | null;
}

export interface UseCreateInboxNoteReturn extends NoteState {
  saveNote: (content: string) => void;
  onContentChange: (content: string) => void;
  resetNote: () => void;
}

const NOTE_TYPE_ID = "note";
const AUTO_SAVE_DELAY_MS = 5_000;
const INITIAL_CREATE_DELAY_MS = 2_000;

function extractFirstLine(content: string): string {
  return content.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
}

export function useCreateInboxNote(): UseCreateInboxNoteReturn {
  const [entityId, setEntityId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const entityIdRef = useRef<string | null>(null);
  const contentRef = useRef<string>("");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialCreateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createMutation = trpc.entities.create.useMutation({
    onSuccess: (entity) => {
      setEntityId(entity.id);
      entityIdRef.current = entity.id;
      setIsSaving(false);
      setLastSaved(new Date());
      setSaveError(null);
    },
    onError: (err) => {
      setIsSaving(false);
      setSaveError(err.message);
    },
  });

  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: () => {
      setIsSaving(false);
      setLastSaved(new Date());
      setSaveError(null);
    },
    onError: (err) => {
      setIsSaving(false);
      setSaveError(err.message);
    },
  });

  const persist = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      setIsSaving(true);

      if (entityIdRef.current) {
        updateMutation.mutate({ id: entityIdRef.current, body: content });
      } else {
        const title = extractFirstLine(content);
        createMutation.mutate({
          typeId: NOTE_TYPE_ID,
          fields: { title },
          body: content,
        });
      }
    },
    [createMutation, updateMutation],
  );

  const saveNote = useCallback(
    (content: string) => {
      contentRef.current = content;
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      persist(content);
    },
    [persist],
  );

  const onContentChange = useCallback(
    (content: string) => {
      contentRef.current = content;

      // Schedule initial entity creation after short inactivity
      if (!entityIdRef.current) {
        if (initialCreateTimer.current) clearTimeout(initialCreateTimer.current);
        initialCreateTimer.current = setTimeout(() => {
          if (contentRef.current.trim()) persist(contentRef.current);
        }, INITIAL_CREATE_DELAY_MS);
      }

      // Schedule auto-save every 5s during typing
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        if (contentRef.current.trim()) persist(contentRef.current);
      }, AUTO_SAVE_DELAY_MS);
    },
    [persist],
  );

  const resetNote = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (initialCreateTimer.current) clearTimeout(initialCreateTimer.current);
    contentRef.current = "";
    entityIdRef.current = null;
    setEntityId(null);
    setIsSaving(false);
    setLastSaved(null);
    setSaveError(null);
  }, []);

  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      if (initialCreateTimer.current) clearTimeout(initialCreateTimer.current);
    };
  }, []);

  return { entityId, isSaving, lastSaved, saveError, saveNote, onContentChange, resetNote };
}
