"use client";

import { useEffect } from "react";

import { registry } from "./registry";
import type { Command, CommandRegistry } from "./types";

/** Returns the singleton command registry. */
export function useCommandRegistry(): CommandRegistry {
  return registry;
}

/**
 * Registers a command in the global registry for the lifetime of the
 * component. Automatically unregisters on unmount.
 */
export function useRegisterCommand(cmd: Command): void {
  useEffect(() => {
    const unregister = registry.register(cmd);
    return unregister;
    // Re-register only if the command id changes (stable reference expected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd.id]);
}

/**
 * Registers multiple commands at once. All are unregistered on unmount.
 */
export function useRegisterCommands(cmds: Command[]): void {
  useEffect(() => {
    const unregisters = cmds.map((c) => registry.register(c));
    return () => unregisters.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmds.map((c) => c.id).join(",")]);
}
