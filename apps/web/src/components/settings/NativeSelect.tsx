"use client";

interface NativeSelectOption {
  value: string;
  label: string;
}

interface NativeSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: NativeSelectOption[];
}

export function NativeSelect({ value, onChange, options }: NativeSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border px-2 py-1.5 text-sm focus:outline-none"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface-1)",
        color: "var(--text-primary)",
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
