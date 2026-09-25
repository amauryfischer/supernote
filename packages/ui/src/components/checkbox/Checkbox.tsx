import * as React from "react";
import {
  CheckboxRoot,
  CheckboxControl,
  CheckboxIndicator,
  CheckboxContent,
} from "@heroui/react";

export interface CheckboxProps
  extends React.ComponentPropsWithRef<typeof CheckboxRoot> {
  /** Label shown beside the checkbox. */
  children?: React.ReactNode;
}

/**
 * Checkbox — boolean selection control.
 * ⚠️ Le `Checkbox` HeroUI v3 nu ne dessine aucune case : Control + Indicator sont obligatoires.
 */
export function Checkbox({ children, ...props }: CheckboxProps) {
  return (
    <CheckboxRoot {...props}>
      <CheckboxControl>
        <CheckboxIndicator />
      </CheckboxControl>
      {children != null && <CheckboxContent>{children}</CheckboxContent>}
    </CheckboxRoot>
  );
}

Checkbox.displayName = "Checkbox";
