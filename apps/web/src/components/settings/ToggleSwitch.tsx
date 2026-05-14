"use client";

import { Switch } from "@heroui/react";

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
