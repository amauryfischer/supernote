"use client";

import { Button } from "@supernote/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus, CalendarBlank, CheckSquare, Hash } from "@phosphor-icons/react";
import type { IconComponent } from "@supernote/ui";
import { useShellChrome } from "@/components/shell";

const ICON_SIZE = 16;

/**
 * Barre d'actions attachée à la surface d'écriture : c'est l'outillage de
 * l'éditeur, pas une section de tableau de bord — d'où l'absence de titre.
 */
export function QuickActionsStrip() {
  const t = useTranslations("home.widgets.actions");
  const router = useRouter();
  const shell = useShellChrome();

  const actions: { key: string; icon: IconComponent; label: string; run: () => void }[] = [
    {
      key: "newNote",
      icon: Plus,
      label: t("newNote"),
      run: () => {
        shell.requestNewNote();
        router.push("/");
      },
    },
    {
      key: "journal",
      icon: CalendarBlank,
      label: t("journal"),
      run: () => router.push("/journal"),
    },
    {
      key: "todo",
      icon: CheckSquare,
      label: t("todo"),
      run: () => router.push("/todos?new=1"),
    },
    {
      key: "schema",
      icon: Hash,
      label: t("schema"),
      run: () => router.push("/schemas"),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 md:flex md:flex-row">
      {actions.map(({ key, icon: Icon, label, run }) => (
        <Button
          key={key}
          variant="outline"
          size="md"
          className="h-10 flex-1 justify-start gap-2 px-3 text-[13px] font-normal"
          onClick={run}
        >
          <Icon size={ICON_SIZE} className="shrink-0" style={{ color: "var(--icon-decorative)" }} />
          <span className="min-w-0 truncate">{label}</span>
        </Button>
      ))}
    </div>
  );
}
