import { Button } from "@supernote/ui";

export type NoteViewMode = "note" | "canvas";

/** Bascule segmentée Note / Canvas, commune à la page note et à la page invité. */
export function NoteViewSwitch({
  mode,
  onChange,
}: {
  mode: NoteViewMode;
  onChange: (mode: NoteViewMode) => void;
}) {
  return (
    <div
      className="inline-flex shrink-0 items-center rounded-md p-0.5"
      style={{
        backgroundColor: "var(--surface-2)",
        border: "1px solid var(--border-subtle)",
      }}
      role="group"
      aria-label="Vue de la note"
    >
      <SwitchButton active={mode === "note"} onPress={() => onChange("note")} label="Note" />
      <SwitchButton active={mode === "canvas"} onPress={() => onChange("canvas")} label="Canvas" />
    </div>
  );
}

function SwitchButton({
  active,
  onPress,
  label,
}: {
  active: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onPress={onPress}
      aria-pressed={active}
      className="sn-hit rounded px-3 py-1 text-xs font-medium transition-colors"
      style={{
        backgroundColor: active ? "var(--surface-0)" : "transparent",
        color: active ? "var(--text-primary)" : "var(--text-muted)",
        boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
        minWidth: 0,
        height: "auto",
      }}
    >
      {label}
    </Button>
  );
}
