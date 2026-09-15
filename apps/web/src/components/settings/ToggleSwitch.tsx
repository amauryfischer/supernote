"use client";

import { Switch } from "@supernote/ui";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, onChange, disabled }: ToggleSwitchProps) {
  return (
    <Switch
      isSelected={checked}
      onChange={onChange}
      isDisabled={disabled}
      size="sm"
    />
  );
}
