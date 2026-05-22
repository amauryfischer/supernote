"use client";

import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus, CalendarBlank, CheckSquare, Hash } from "@phosphor-icons/react";
import { useShellChrome } from "@/components/shell";

const ICON_SIZE = 18;

export function QuickActionsStrip() {
  const t = useTranslations("home.widgets.actions");
  const router = useRouter();
  const shell = useShellChrome();

  function handleNewNote() {
    shell.requestNewNote();
    router.push("/");
  }

  return (
    <div className="flex flex-col gap-2">
      <span
        className="text-[12px] font-bold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {t("title")}
      </span>
      <div className="flex flex-col md:flex-row gap-2 md:gap-3">
        <Button
          variant="outline"
          size="md"
          className="h-12 flex-1 justify-start gap-2"
          onClick={handleNewNote}
        >
          <Plus size={ICON_SIZE} weight="duotone" style={{ color: "var(--accent)" }} />
          {t("newNote")}
        </Button>
        <Button
          variant="outline"
          size="md"
          className="h-12 flex-1 justify-start gap-2"
          onClick={() => router.push("/journal")}
        >
          <CalendarBlank size={ICON_SIZE} weight="duotone" style={{ color: "var(--accent)" }} />
          {t("journal")}
        </Button>
        <Button
          variant="outline"
          size="md"
          className="h-12 flex-1 justify-start gap-2"
          onClick={() => router.push("/todos?new=1")}
        >
          <CheckSquare size={ICON_SIZE} weight="duotone" style={{ color: "var(--accent)" }} />
          {t("todo")}
        </Button>
        <Button
          variant="outline"
          size="md"
          className="h-12 flex-1 justify-start gap-2"
          onClick={() => router.push("/schemas")}
        >
          <Hash size={ICON_SIZE} weight="duotone" style={{ color: "var(--accent)" }} />
          {t("schema")}
        </Button>
      </div>
    </div>
  );
}
