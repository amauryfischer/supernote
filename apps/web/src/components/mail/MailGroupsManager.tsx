"use client";

import { useState } from "react";
import { Modal, Button, Input, Checkbox, useToast } from "@supernote/ui";
import { Plus, PencilSimple, Trash, Tag, X } from "@phosphor-icons/react";
import {
  loadGroups,
  upsertGroup,
  removeGroup,
  type MailGroup,
} from "@/lib/mail-groups";

/** Génère un id de groupe stable, robuste si `crypto.randomUUID` absent. */
function newGroupId(): string {
  try {
    return `g_${crypto.randomUUID()}`;
  } catch {
    return `g_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  }
}

/**
 * Gestionnaire des « groupes mail » (système zéro-inbox) : créer / renommer /
 * supprimer des vues alimentées par des labels Gmail. Les emails portant un
 * label routé quittent l'inbox et s'affichent dans l'onglet du groupe.
 *
 * Écrit directement dans le store local (`mail-groups`) qui émet `MAIL_GROUPS_EVENT`
 * → la page mail recharge ses onglets sans prop drilling. `labelNames` = labels
 * Gmail disponibles (id → nom) pour le picker.
 */
export function MailGroupsManager({
  isOpen,
  onClose,
  labelNames,
}: {
  isOpen: boolean;
  onClose: () => void;
  labelNames: Map<string, string>;
}) {
  const { toast } = useToast();
  const [groups, setGroups] = useState<MailGroup[]>(() => loadGroups());
  // Édition courante : `null` = liste ; objet = formulaire (création ou édition).
  const [editing, setEditing] = useState<MailGroup | null>(null);

  const refresh = () => setGroups(loadGroups());

  const startCreate = () =>
    setEditing({ id: newGroupId(), name: "", labelIds: [], createdAt: Date.now() });
  const startEdit = (g: MailGroup) => setEditing({ ...g });

  const toggleLabel = (labelId: string) => {
    setEditing((e) =>
      e
        ? {
            ...e,
            labelIds: e.labelIds.includes(labelId)
              ? e.labelIds.filter((l) => l !== labelId)
              : [...e.labelIds, labelId],
          }
        : e,
    );
  };

  const save = () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      toast({ title: "Nom du groupe requis", variant: "danger" });
      return;
    }
    if (editing.labelIds.length === 0) {
      toast({ title: "Choisis au moins un label", variant: "danger" });
      return;
    }
    upsertGroup({ ...editing, name });
    refresh();
    setEditing(null);
  };

  const del = (id: string) => {
    removeGroup(id);
    refresh();
    if (editing?.id === id) setEditing(null);
  };

  const labelEntries = [...labelNames.entries()];

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(o) => {
        if (!o) {
          setEditing(null);
          onClose();
        }
      }}
      title="Groupes mail"
      size="lg"
    >
      {editing ? (
        // ─── Formulaire création / édition ───────────────────────────────────
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Nom de l'onglet
            </span>
            <Input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Réunions, Factures…"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Labels Gmail alimentant ce groupe
            </span>
            {labelEntries.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Aucun label Gmail détecté. Crée des labels dans Gmail puis recharge.
              </p>
            ) : (
              <div
                className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border p-2"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                {labelEntries.map(([id, name]) => (
                  <Checkbox
                    key={id}
                    isSelected={editing.labelIds.includes(id)}
                    onChange={() => toggleLabel(id)}
                  >
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <Tag size={13} aria-hidden style={{ color: "var(--accent)" }} />
                      {name}
                    </span>
                  </Checkbox>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onPress={() => setEditing(null)}>
              Annuler
            </Button>
            <Button variant="primary" onPress={save}>
              Enregistrer
            </Button>
          </div>
        </div>
      ) : (
        // ─── Liste des groupes ───────────────────────────────────────────────
        <div className="flex flex-col gap-3">
          {groups.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Aucun groupe. Crée-en un pour router des emails tagués hors de l'inbox
              (zéro-inbox).
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
                  style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {g.name}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {g.labelIds.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                          style={{ backgroundColor: "var(--surface-2)", color: "var(--text-secondary)" }}
                        >
                          <Tag size={10} aria-hidden />
                          {labelNames.get(id) ?? id}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      onPress={() => startEdit(g)}
                      aria-label={`Éditer le groupe ${g.name}`}
                    >
                      <PencilSimple size={15} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      onPress={() => del(g.id)}
                      aria-label={`Supprimer le groupe ${g.name}`}
                    >
                      <Trash size={15} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onPress={onClose}>
              <X size={14} /> Fermer
            </Button>
            <Button variant="primary" onPress={startCreate}>
              <Plus size={15} /> Nouveau groupe
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
