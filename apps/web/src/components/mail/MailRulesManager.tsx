"use client";

/**
 * MailRulesManager — règles locales « si … alors … » et propositions.
 *
 * Deux parties :
 *  - les PROPOSITIONS, en haut : un geste répété plusieurs fois sur le même
 *    expéditeur devient une règle en un clic. C'est la porte d'entrée normale —
 *    personne ne va écrire une règle à froid ;
 *  - les règles existantes, éditables (conditions, actions, activation).
 *
 * Aucune action destructive n'est proposée : une règle peut classer, archiver,
 * marquer lu ou suivre, jamais supprimer.
 */

import { useEffect, useState } from "react";
import { Button, Input } from "@heroui/react";
import { Modal, useToast, Switch } from "@supernote/ui";
import { Plus, Trash, Lightning, Funnel } from "@phosphor-icons/react";
import { NativeSelect } from "@/components/settings/NativeSelect";
import {
  loadRules,
  upsertRule,
  removeRule,
  newRuleId,
  suggestRules,
  ruleFromSuggestion,
  forgetActions,
  MAIL_RULES_EVENT,
  type MailRule,
  type RuleSuggestion,
} from "@/lib/mail-rules";

export function MailRulesManager({
  isOpen,
  onClose,
  labelNames,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Labels Gmail (id → nom) pour les listes déroulantes. */
  labelNames: Map<string, string>;
}) {
  const { toast } = useToast();
  const [rules, setRules] = useState<MailRule[]>([]);
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([]);

  const refresh = () => {
    setRules(loadRules());
    setSuggestions(suggestRules());
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    refresh();
    window.addEventListener(MAIL_RULES_EVENT, refresh);
    return () => window.removeEventListener(MAIL_RULES_EVENT, refresh);
  }, [isOpen]);

  const labelOptions = [
    { value: "", label: "— aucun —" },
    ...[...labelNames.entries()]
      .filter(([id]) => !["INBOX", "UNREAD", "STARRED", "SENT", "DRAFT", "TRASH", "SPAM"].includes(id))
      .map(([id, name]) => ({ value: id, label: name })),
  ];

  const patch = (rule: MailRule, changes: Partial<MailRule>) => {
    const next = { ...rule, ...changes };
    upsertRule(next);
    refresh();
  };

  const addBlank = () => {
    upsertRule({
      id: newRuleId(),
      name: "Nouvelle règle",
      enabled: false,
      when: {},
      then: {},
      createdAt: Date.now(),
      applied: 0,
    });
    refresh();
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Règles de la boîte"
      size="xl"
    >
      <div className="flex flex-col gap-4">
        {suggestions.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-muted)" }}
            >
              <Lightning size={13} aria-hidden /> Propositions
            </h3>
            {suggestions.map((s) => (
              <div
                key={`${s.from}-${s.action}-${s.labelId ?? ""}`}
                className="flex items-center gap-2 rounded-lg border p-2.5"
                style={{ borderColor: "var(--border-subtle)", background: "var(--surface-1)" }}
              >
                <span className="min-w-0 flex-1 text-sm" style={{ color: "var(--text-primary)" }}>
                  Tu as {s.action === "archive" ? "archivé" : "classé"} {s.count} emails de{" "}
                  <strong>{s.from}</strong>. Le faire automatiquement ?
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  onPress={() => {
                    upsertRule(
                      ruleFromSuggestion(s, s.labelId ? labelNames.get(s.labelId) : undefined),
                    );
                    forgetActions(s.from);
                    refresh();
                    toast({ title: "Règle créée" });
                  }}
                >
                  Créer la règle
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => {
                    forgetActions(s.from);
                    refresh();
                  }}
                >
                  Ignorer
                </Button>
              </div>
            ))}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-muted)" }}
            >
              <Funnel size={13} aria-hidden /> Règles
            </h3>
            <Button size="sm" variant="ghost" onPress={addBlank}>
              <Plus size={14} /> Nouvelle règle
            </Button>
          </div>

          {rules.length === 0 && (
            <p className="py-2 text-sm" style={{ color: "var(--text-muted)" }}>
              Aucune règle. Elles apparaissent surtout toutes seules, à force de
              répéter le même geste sur un expéditeur.
            </p>
          )}

          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex flex-col gap-2 rounded-lg border p-3"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div className="flex items-center gap-2">
                <Input
                  value={rule.name}
                  onChange={(e) => patch(rule, { name: e.target.value })}
                  className="flex-1"
                  aria-label="Nom de la règle"
                />
                <Switch
                  isSelected={rule.enabled}
                  onChange={(sel) => patch(rule, { enabled: Boolean(sel) })}
                  aria-label={`Activer la règle ${rule.name}`}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  aria-label={`Supprimer la règle ${rule.name}`}
                  onPress={() => {
                    removeRule(rule.id);
                    refresh();
                  }}
                >
                  <Trash size={14} />
                </Button>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Si l'expéditeur contient
                  </span>
                  <Input
                    value={rule.when.fromContains ?? ""}
                    onChange={(e) =>
                      patch(rule, { when: { ...rule.when, fromContains: e.target.value } })
                    }
                    placeholder="notifications@exemple.com"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    …et l'objet contient
                  </span>
                  <Input
                    value={rule.when.subjectContains ?? ""}
                    onChange={(e) =>
                      patch(rule, { when: { ...rule.when, subjectContains: e.target.value } })
                    }
                    placeholder="facture"
                  />
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Alors ajouter le tag
                  </span>
                  <NativeSelect
                    value={rule.then.addLabelId ?? ""}
                    onChange={(v) =>
                      patch(rule, {
                        then: { ...rule.then, ...(v ? { addLabelId: v } : { addLabelId: undefined }) },
                      })
                    }
                    options={labelOptions}
                  />
                </div>
                <div className="flex flex-wrap items-end gap-3 pb-1">
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                    <Switch
                      isSelected={Boolean(rule.then.archive)}
                      onChange={(sel) => patch(rule, { then: { ...rule.then, archive: Boolean(sel) } })}
                      aria-label="Archiver"
                    />
                    Archiver
                  </label>
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                    <Switch
                      isSelected={Boolean(rule.then.markRead)}
                      onChange={(sel) => patch(rule, { then: { ...rule.then, markRead: Boolean(sel) } })}
                      aria-label="Marquer comme lu"
                    />
                    Marquer lu
                  </label>
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                    <Switch
                      isSelected={Boolean(rule.then.star)}
                      onChange={(sel) => patch(rule, { then: { ...rule.then, star: Boolean(sel) } })}
                      aria-label="Mettre une étoile"
                    />
                    Étoile
                  </label>
                </div>
              </div>

              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {rule.applied > 0
                  ? `Appliquée à ${rule.applied} fil(s).`
                  : "Jamais appliquée pour l'instant."}{" "}
                Une règle ne supprime jamais un email.
              </span>
            </div>
          ))}
        </section>
      </div>
    </Modal>
  );
}
