"use client";

import { useState } from "react";
import { Modal, Button, Input, Tooltip } from "@supernote/ui";
import { CaretDown, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import type { GmailLabelColor } from "@/lib/gmail";
import { LabelMarker, LabelStyleGrid, labelChipStyle } from "./LabelMarker";

export function MailLabelsManager({
  isOpen,
  onClose,
  labelNames,
  labelColors,
  onCreate,
  onRename,
  onDelete,
  onPick,
  error,
}: {
  isOpen: boolean;
  onClose: () => void;
  labelNames: Map<string, string>;
  labelColors: Map<string, GmailLabelColor>;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (labelId: string, name: string) => void;
  onDelete: (labelId: string) => void;
  onPick: (labelId: string, color: GmailLabelColor) => void;
  error?: string | null;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [newName, setNewName] = useState("");
  const labels = [...labelNames].sort(([, a], [, b]) => a.localeCompare(b, "fr"));

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    if (await onCreate(name)) setNewName("");
  };

  const toggle = (id: string, name: string) => {
    setEditing(editing === id ? null : id);
    setDraftName(name);
  };

  const rename = (id: string, current: string) => {
    const name = draftName.trim();
    if (name && name !== current) onRename(id, name);
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Labels"
    >
      <form
        className="mb-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nouveau label"
          aria-label="Nom du nouveau label"
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" variant="ghost" className="flex shrink-0 items-center gap-1.5" isDisabled={!newName.trim()}>
          <Plus size={14} /> Créer
        </Button>
      </form>
      {error && (
        <p role="alert" className="-mt-1 mb-3 text-xs" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      {labels.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Aucun label Gmail pour le moment.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {labels.map(([id, name]) => {
            const color = labelColors.get(id);
            const open = editing === id;
            return (
              <li key={id} className="flex flex-col gap-2">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => toggle(id, name)}
                    aria-expanded={open}
                    aria-label={`Modifier le label ${name}`}
                    className="flex h-10 min-h-10 min-w-0 flex-1 items-center justify-between gap-2 px-2"
                  >
                    <span
                      className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                      style={labelChipStyle(color)}
                    >
                      <LabelMarker color={color} size={11} />
                      <span className="truncate">{name}</span>
                    </span>
                    <CaretDown
                      size={14}
                      className="sn-motion-glide shrink-0"
                      style={{ color: "var(--text-muted)", transform: open ? "rotate(180deg)" : undefined }}
                    />
                  </Button>
                  <Tooltip content="Supprimer">
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      onPress={() => onDelete(id)}
                      aria-label={`Supprimer le label ${name}`}
                      className="h-10 min-h-10 w-10 min-w-10 shrink-0"
                    >
                      <Trash size={15} />
                    </Button>
                  </Tooltip>
                </div>
                {open && (
                  <div className="flex flex-col gap-3 pb-3 pl-2">
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        rename(id, name);
                      }}
                    >
                      <Input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        aria-label={`Nouveau nom pour ${name}`}
                        className="min-w-0 flex-1"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant="ghost"
                        className="flex shrink-0 items-center gap-1.5"
                        isDisabled={!draftName.trim() || draftName.trim() === name}
                      >
                        <PencilSimple size={14} /> Renommer
                      </Button>
                    </form>
                    <LabelStyleGrid current={color} onPick={(c) => onPick(id, c)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
