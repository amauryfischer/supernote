"use client";

import { AppShell } from "@/components/shell";
import { GardenView } from "@/components/garden/GardenView";

export default function GardenPage() {
  return (
    <AppShell>
      <GardenView />
    </AppShell>
  );
}
