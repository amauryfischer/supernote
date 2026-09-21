"use client";

import { AppShell, useMobileTitle, useMobileFab, useMobileBack } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { TemplateEditor, TemplateList } from "@/components/templates";
import { useApplyTemplate } from "@/components/templates/useApplyTemplate";
import { useTemplateList } from "@/components/templates/useTemplateList";
import { trpc } from "@/lib/trpc/client";
import { useConfirm } from "@/lib/confirm";
import { EmptyState, useToast } from "@supernote/ui";
import type { Template } from "@supernote/templates";
import { FileDashed, FilePlus, Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

const NEW_TEMPLATE_BODY = "# {{prompt:Titre?}}\n\n{{cursor}}\n";

function TemplateSidebarSkeleton() {
  return (
    <aside
      className="flex flex-col border-r animate-pulse"
      style={{ width: 260, minWidth: 260, backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="h-4 w-24 rounded" style={{ backgroundColor: "var(--surface-3)" }} />
      </div>
      <div className="flex-1 p-2 space-y-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 rounded-md" style={{ backgroundColor: "var(--surface-3)" }} />
        ))}
      </div>
    </aside>
  );
}

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

function TemplatesPageContent() {
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { hasBackend, templates, isLoading, error } = useTemplateList();
  const saveMutation = trpc.templates.save.useMutation();
  const deleteMutation = trpc.templates.delete.useMutation();
  const { apply, isApplying, modal: applyModal } = useApplyTemplate();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = templates.find((t) => t.id === selectedId) ?? templates[0] ?? null;

  const dirtyRef = useRef(false);
  const handleDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const confirmDiscard = useCallback(
    async () =>
      !dirtyRef.current ||
      confirm({
        title: "Modifications non enregistrées",
        body: "Les modifications de ce modèle seront perdues.",
        confirmLabel: "Abandonner",
        variant: "danger",
      }),
    [confirm],
  );

  // Mobile : maître-détail — la liste plein écran, puis l'éditeur plein écran
  // avec retour dans la barre du haut (côte à côte, l'éditeur tenait sur un
  // caractère de large).
  const [mobileEditing, setMobileEditing] = useState(false);

  // `?id=` : arrivée depuis un résultat de recherche.
  const idParam = useSearchParams().get("id");
  useEffect(() => {
    if (!idParam) return;
    setSelectedId(idParam);
    setMobileEditing(true);
  }, [idParam]);

  const showEditor = !isMobile || (mobileEditing && selected !== null);
  const showList = !isMobile || !showEditor;
  useMobileTitle(
    isMobile ? (showEditor ? (selected?.name ?? "Templates") : "Templates") : null,
  );
  useMobileBack(
    isMobile && showEditor
      ? () =>
          void confirmDiscard().then((ok) => {
            if (!ok) return;
            dirtyRef.current = false;
            setMobileEditing(false);
          })
      : null,
  );

  const handleSelect = useCallback(
    async (id: string) => {
      if (id !== selected?.id && !(await confirmDiscard())) return;
      setSelectedId(id);
      setMobileEditing(true);
    },
    [selected?.id, confirmDiscard],
  );

  const handleSave = useCallback(
    async (t: Template) => {
      try {
        await saveMutation.mutateAsync({
          id: t.id,
          name: t.name,
          description: t.description,
          icon: t.icon,
          entityType: t.entityType,
          body: t.body,
          frontmatter: t.frontmatter,
        });
        await utils.templates.list.invalidate();
        toast({ title: "Modèle enregistré", variant: "success" });
      } catch (err) {
        toast({ title: "Échec de l'enregistrement du modèle", description: errorMessage(err), variant: "danger" });
      }
    },
    [saveMutation, utils, toast],
  );

  const handleNew = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    try {
      const saved = await saveMutation.mutateAsync({ name: "Nouveau modèle", body: NEW_TEMPLATE_BODY });
      await utils.templates.list.invalidate();
      setSelectedId(saved.id);
      setMobileEditing(true);
    } catch (err) {
      toast({ title: "Impossible de créer le modèle", description: errorMessage(err), variant: "danger" });
    }
  }, [confirmDiscard, saveMutation, utils, toast]);

  const handleDelete = useCallback(
    async (id: string) => {
      const name = templates.find((t) => t.id === id)?.name ?? "ce modèle";
      const ok = await confirm({
        title: `Supprimer « ${name} » ?`,
        body: "Le modèle disparaît de ce coffre et des appareils synchronisés.",
        confirmLabel: "Supprimer",
        variant: "danger",
      });
      if (!ok) return;
      try {
        await deleteMutation.mutateAsync({ id });
        if (selected?.id === id) setSelectedId(null);
        await utils.templates.list.invalidate();
      } catch (err) {
        toast({ title: "Impossible de supprimer le modèle", description: errorMessage(err), variant: "danger" });
      }
    },
    [templates, confirm, deleteMutation, selected?.id, utils, toast],
  );

  // Éditeur ouvert : le FAB applique le template (miroir du bouton « Appliquer ») ;
  // sur la liste, il en crée un.
  useMobileFab(
    !isMobile || !hasBackend
      ? null
      : showEditor && selected
        ? { icon: FilePlus, label: "Appliquer le template", onPress: () => apply(selected) }
        : { icon: Plus, label: "Nouveau template", onPress: handleNew },
  );

  if (!hasBackend) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <EmptyState
          icon={<FileDashed size={28} />}
          title="Aucun coffre ouvert"
          description="Les modèles sont enregistrés dans le coffre : ouvrez un dossier ou un coffre cloud pour les créer et les retrouver."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden md:flex-row">
      {showList && (
      <div className="flex min-h-0 flex-1 overflow-y-auto md:w-[260px] md:flex-none md:shrink-0 md:border-r"
        style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
      >
        {isLoading ? (
          <TemplateSidebarSkeleton />
        ) : error ? (
          <p className="px-4 py-3 text-sm" style={{ color: "var(--danger)" }}>
            Impossible de charger les modèles : {error}
          </p>
        ) : (
          <TemplateList
            templates={templates}
            selectedId={selected?.id ?? null}
            onSelect={(id) => void handleSelect(id)}
            onNew={() => void handleNew()}
            onDelete={(id) => void handleDelete(id)}
          />
        )}
      </div>
      )}

      {showEditor && (
      <main className="flex-1 overflow-hidden" style={{ backgroundColor: "var(--surface-0)" }}>
        {selected ? (
          <TemplateEditor
            key={selected.id}
            template={selected}
            onSave={(t) => void handleSave(t)}
            isSaving={saveMutation.isPending}
            onDirtyChange={handleDirtyChange}
            // Sous md, « Appliquer » est le FAB.
            onApply={isMobile ? undefined : apply}
            isApplying={isApplying}
          />
        ) : isLoading ? null : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Sélectionnez ou créez un template
            </p>
          </div>
        )}
      </main>
      )}

      {/* Prompt flow for {{prompt:…}} placeholders when applying a template. */}
      {applyModal}
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <AppShell>
      <TemplatesPageContent />
    </AppShell>
  );
}
