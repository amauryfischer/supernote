"use client";

/**
 * HabitModal — formulaire création/édition d'une habitude.
 *
 * Le caller possède l'état open/close. Archiver / Supprimer vivent dans le
 * menu de la carte, pas ici.
 */

import { useEffect, useRef, useState } from "react";
import { Button, ListBox, ListBoxItem, Select } from "@heroui/react";
import { CaretDown } from "@phosphor-icons/react";
import { Input, Modal, Tabs } from "@supernote/ui";
import { COLOR_PRESETS } from "@/components/shell";
import { useOnlineSync } from "@/lib/online-sync/OnlineSyncProvider";
import {
  DEFAULT_HABIT_COLOR,
  DEFAULT_HABIT_ICON,
  goalLabel,
  remindLabel,
  type Habit,
  type HabitPeriod,
  type RemindEvery,
} from "@/lib/habits/habitData";

export interface HabitFormValues {
  name: string;
  icon: string;
  color: string;
  period: HabitPeriod;
  target: number;
  unit: string;
  remindEvery: RemindEvery;
  remindFrom: number;
  remindTo: number;
}

interface HabitModalProps {
  open: boolean;
  /** null = création. */
  initial: Habit | null;
  isMobile: boolean;
  onSave: (values: HabitFormValues) => void;
  onCancel: () => void;
}

const EMOJI_PRESETS = ["✅", "💧", "📖", "🏃", "🧘", "💪", "✍️", "🌱", "😴", "🎸", "🚭", "🥗"];

// Une teinte par famille, violet (couleur par défaut) inclus.
const APPEARANCE_COLORS = COLOR_PRESETS.filter((c) =>
  ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"].includes(c.name),
);

const PERIOD_TABS = [
  { key: "day", label: "Jour" },
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
];

const REMIND_OPTIONS = [
  { key: "0", label: "Désactivé" },
  { key: "1", label: "Toutes les heures" },
  { key: "2", label: "Toutes les 2 h" },
  { key: "3", label: "Toutes les 3 h" },
  { key: "24", label: "1× par jour" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: `${h} h` }));

const LABEL_CLASS = "mb-1 block text-xs font-medium text-[var(--text-muted)]";

export function HabitModal({ open, initial, isMobile, onSave, onCancel }: HabitModalProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(DEFAULT_HABIT_ICON);
  const [color, setColor] = useState(DEFAULT_HABIT_COLOR);
  const [period, setPeriod] = useState<HabitPeriod>("day");
  const [target, setTarget] = useState(1);
  const [unit, setUnit] = useState("");
  const [remindEvery, setRemindEvery] = useState<RemindEvery>(3);
  const [remindFrom, setRemindFrom] = useState(8);
  const [remindTo, setRemindTo] = useState(22);
  const [showAppearance, setShowAppearance] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const online = useOnlineSync();

  // Réinitialise le formulaire à chaque ouverture (création ou édition).
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setIcon(initial?.icon ?? DEFAULT_HABIT_ICON);
    setColor(initial?.color ?? DEFAULT_HABIT_COLOR);
    setPeriod(initial?.period ?? "day");
    setTarget(initial?.target ?? 1);
    setUnit(initial?.unit ?? "");
    setRemindEvery(initial?.remindEvery ?? 3);
    setRemindFrom(initial?.remindFrom ?? 8);
    setRemindTo(initial?.remindTo ?? 22);
    setShowAppearance(false);
  }, [open, initial]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      nameRef.current?.focus();
      return;
    }
    onSave({
      name: trimmed,
      icon: icon.trim() || DEFAULT_HABIT_ICON,
      color,
      period,
      target: clampTarget(target),
      unit: unit.trim(),
      remindEvery,
      remindFrom,
      remindTo: Math.max(remindFrom, remindTo),
    });
  };

  const remindOn = remindEvery > 0;
  const once = remindEvery === 24;
  const pushNotReady =
    remindOn &&
    (typeof Notification === "undefined" ||
      Notification.permission !== "granted" ||
      !online?.config.token);

  // Habitude temporaire : seule la formulation de l'aide en a besoin.
  const preview: Habit = {
    id: "",
    name,
    icon,
    color,
    period,
    target: clampTarget(target),
    remindEvery,
    remindFrom,
    remindTo: Math.max(remindFrom, remindTo),
    unit: unit.trim(),
    archived: false,
    checkins: {},
    createdAt: "",
  };
  const goal = goalLabel(preview);
  const helpText =
    `Rappel ${remindLabel(preview)}${once ? "" : ` de ${preview.remindFrom} h à ${preview.remindTo} h`}` +
    ` tant que l'objectif (${goal.charAt(0).toLowerCase()}${goal.slice(1)}) n'est pas tenu`;

  const footer = (
    <div className="flex w-full justify-end gap-2">
      <Button variant="outline" onPress={onCancel}>
        Annuler
      </Button>
      <Button variant="primary" onPress={submit}>
        {initial ? "Enregistrer" : "Créer"}
      </Button>
    </div>
  );

  return (
    <Modal
      isOpen={open}
      onOpenChange={(o) => !o && onCancel()}
      title={initial ? "Modifier l'habitude" : "Nouvelle habitude"}
      size={isMobile ? "full" : "md"}
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        <div>
          <span className={LABEL_CLASS}>Nom</span>
          <Input
            ref={nameRef}
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Lire 20 minutes, boire de l'eau…"
            aria-label="Nom de l'habitude"
          />
        </div>

        <div>
          <span className={LABEL_CLASS}>Objectif</span>
          <div className="flex items-center gap-2">
            <div className="w-20 shrink-0">
              <Input
                type="number"
                min={1}
                max={50}
                value={String(target)}
                onChange={(e) => setTarget(Number(e.target.value) || 1)}
                aria-label="Nombre de fois"
              />
            </div>
            <div className="min-w-0 flex-1">
              <Input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="fois, verres, pages…"
                aria-label="Unité"
              />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-sm text-[var(--text-secondary)]">par</span>
            {/* Les Tabs de l'UI rendent un panneau vide par onglet : masqué. */}
            <Tabs
              items={PERIOD_TABS}
              selectedKey={period}
              onSelectionChange={(k) => setPeriod(k as HabitPeriod)}
              className="min-w-0 flex-1 [&_[role=tabpanel]]:hidden"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <SelectField
            label="Rappel"
            options={REMIND_OPTIONS}
            value={remindEvery}
            onChange={(v) => setRemindEvery(v as RemindEvery)}
          />
          {remindOn && (
            <div className="flex gap-2">
              <SelectField
                className="min-w-0 flex-1"
                label={once ? "À" : "De"}
                options={HOUR_OPTIONS}
                value={remindFrom}
                onChange={(from) => {
                  setRemindFrom(from);
                  setRemindTo((to) => Math.max(from, to));
                }}
              />
              {!once && (
                <SelectField
                  className="min-w-0 flex-1"
                  label="À"
                  options={HOUR_OPTIONS.filter((o) => Number(o.key) >= remindFrom)}
                  value={Math.max(remindFrom, remindTo)}
                  onChange={setRemindTo}
                />
              )}
            </div>
          )}
          {remindOn && (
            <p className="text-xs text-[var(--text-muted)]" aria-live="polite">
              {helpText}
            </p>
          )}
          {pushNotReady && (
            <p className="text-xs" style={{ color: "var(--color-warning, var(--text-secondary))" }}>
              Active les notifications et protège ton salon dans Réglages → Notifications pour
              recevoir ces rappels.
            </p>
          )}
        </div>

        <div>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setShowAppearance((v) => !v)}
            aria-expanded={showAppearance}
            className="-ml-2 min-h-8"
          >
            Apparence
            <CaretDown
              size={12}
              aria-hidden
              style={{
                transform: showAppearance ? "rotate(180deg)" : undefined,
                transition: "transform 150ms",
              }}
            />
          </Button>
          {showAppearance && (
            <div className="mt-2 flex flex-col gap-3">
              <div>
                <span className={LABEL_CLASS}>Emoji</span>
                <div className="flex flex-wrap items-center gap-1">
                  {EMOJI_PRESETS.map((e) => (
                    <Button
                      key={e}
                      variant={icon === e ? "secondary" : "ghost"}
                      size="sm"
                      onPress={() => setIcon(e)}
                      aria-label={`Emoji ${e}`}
                      className="h-8 w-8 min-w-0 rounded-md p-0 text-base"
                      style={
                        icon === e
                          ? { backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` }
                          : undefined
                      }
                    >
                      {e}
                    </Button>
                  ))}
                  <div className="w-14">
                    <Input
                      type="text"
                      value={icon}
                      onChange={(e) => setIcon(e.target.value)}
                      className="text-center"
                      aria-label="Emoji personnalisé"
                    />
                  </div>
                </div>
              </div>
              <div>
                <span className={LABEL_CLASS}>Couleur</span>
                <div className="flex flex-wrap gap-2">
                  {APPEARANCE_COLORS.map((c) => (
                    <Button
                      key={c.name}
                      variant="ghost"
                      size="sm"
                      onPress={() => setColor(c.hex)}
                      aria-label={`Couleur ${c.name}`}
                      className="sn-hit h-6 w-6 min-w-0 rounded-full p-0"
                      style={{
                        backgroundColor: c.hex,
                        outline: color === c.hex ? "2px solid var(--text-primary)" : undefined,
                        outlineOffset: 2,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Le Select de @supernote/ui affiche son placeholder à la place de la valeur choisie : on branche HeroUI directement.
function SelectField({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: number;
  options: { key: string; label: string }[];
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className={LABEL_CLASS}>{label}</span>
      <Select
        selectedKey={String(value)}
        onSelectionChange={(k) => k != null && onChange(Number(k))}
        aria-label={label}
      >
        <Select.Trigger className="flex min-h-9 w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none">
          <Select.Value />
          <CaretDown size={12} aria-hidden />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {options.map((o) => (
              <ListBoxItem key={o.key} id={o.key}>
                {o.label}
              </ListBoxItem>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  );
}

function clampTarget(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(50, Math.max(1, Math.round(v)));
}
