"use client";

import { AppShell } from "@/components/shell";
import { AssistantChat } from "@/components/assistant/AssistantChat";

export default function AssistantPage() {
  return (
    <AppShell>
      <AssistantChat />
    </AppShell>
  );
}
