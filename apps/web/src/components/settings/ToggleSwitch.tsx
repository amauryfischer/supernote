"use client";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, onChange, disabled }: ToggleSwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors"
      style={{
        backgroundColor: checked ? "var(--accent)" : "var(--surface-3)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}
