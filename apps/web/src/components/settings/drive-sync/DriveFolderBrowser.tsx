"use client";

import { useEffect, useState } from "react";
import { CaretRight, Folder, FolderPlus } from "@phosphor-icons/react";
import { Button, Input, Modal } from "@supernote/ui";
import { useIsMobile } from "@/hooks/useIsMobile";
import { createFolder, listChildFolders } from "@/lib/drive-sync/drive-api";

interface Crumb {
  id: string;
  name: string;
}

interface DriveFolderBrowserProps {
  clientId: string;
  isOpen: boolean;
  onClose: () => void;
  onPick: (folder: { id: string; path: string }) => void;
  title?: string;
}

/** Choix d'un dossier de « Mon Drive », à la main : ni clé API ni script Google Picker, et ça marche sur mobile. */
export function DriveFolderBrowser({ clientId, isOpen, onClose, onPick, title = "Dossier Drive" }: DriveFolderBrowserProps) {
  const isMobile = useIsMobile();
  const [trail, setTrail] = useState<Crumb[]>([{ id: "root", name: "Mon Drive" }]);
  const [children, setChildren] = useState<Crumb[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const current = trail[trail.length - 1] ?? { id: "root", name: "Mon Drive" };

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setChildren(null);
    setError(null);
    listChildFolders(clientId, current.id)
      .then((folders) => !cancelled && setChildren(folders))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [clientId, current.id, isOpen]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const id = await createFolder(clientId, name, current.id);
      setNewName("");
      setTrail((t) => [...t, { id, name }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const path = trail.map((c) => c.name).join(" / ");

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      size={isMobile ? "full" : "md"}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onPress={onClose}>Annuler</Button>
          {/* La racine entière ferait de chaque .md du Drive une note, toutes les 5 min. */}
          <Button size="sm" isDisabled={trail.length < 2} onPress={() => onPick({ id: current.id, path })}>Choisir « {current.name} »</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <nav aria-label="Chemin" className="flex flex-wrap items-center gap-0.5 text-sm">
          {trail.map((c, i) => (
            <span key={c.id} className="flex items-center gap-0.5">
              {i > 0 && <CaretRight size={12} style={{ color: "var(--text-muted)" }} aria-hidden />}
              <Button variant="ghost" size="sm" className="h-8 px-1.5" onPress={() => setTrail((t) => t.slice(0, i + 1))}>
                {c.name}
              </Button>
            </span>
          ))}
        </nav>

        <div className="max-h-[50vh] overflow-y-auto rounded-lg" style={{ backgroundColor: "var(--surface-2)" }}>
          {error ? (
            <p className="p-3 text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>
          ) : !children ? (
            <p className="p-3 text-sm" style={{ color: "var(--text-muted)" }}>Chargement…</p>
          ) : !children.length ? (
            <p className="p-3 text-sm" style={{ color: "var(--text-muted)" }}>Aucun sous-dossier.</p>
          ) : (
            children.map((c) => (
              <Button
                key={c.id}
                variant="ghost"
                className="flex h-10 w-full items-center justify-start gap-2 rounded-none px-3"
                onPress={() => setTrail((t) => [...t, c])}
              >
                <Folder size={16} aria-hidden />
                <span className="truncate">{c.name}</span>
              </Button>
            ))
          )}
        </div>

        <div className="flex items-center gap-2">
          <Input
            placeholder="Nouveau dossier ici"
            aria-label="Nom du nouveau dossier"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            className="flex-1 text-sm"
          />
          <Button variant="outline" size="sm" className="flex items-center gap-1.5" onPress={() => void create()} isDisabled={!newName.trim()}>
            <FolderPlus size={14} /> Créer
          </Button>
        </div>
      </div>
    </Modal>
  );
}
