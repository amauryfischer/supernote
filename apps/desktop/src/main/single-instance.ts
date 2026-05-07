import { app } from "electron";

type FocusCallback = () => void;

/**
 * Acquires a single-instance lock.
 * Returns true if this is the primary instance, false if secondary.
 * On secondary launch, calls `onSecondInstance` then quits.
 */
export function acquireSingleInstanceLock(onSecondInstance: FocusCallback): boolean {
  const gotLock = app.requestSingleInstanceLock();

  if (!gotLock) {
    return false;
  }

  app.on("second-instance", () => {
    onSecondInstance();
  });

  return true;
}
