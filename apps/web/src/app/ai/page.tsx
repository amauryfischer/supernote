"use client";

import { AppShell } from "@/components/shell";
import { ChatPanel } from "@/components/ai/ChatPanel";

export default function AiPage() {
  return (
    <AppShell>
      <ChatPanel />
    </AppShell>
  );
}
