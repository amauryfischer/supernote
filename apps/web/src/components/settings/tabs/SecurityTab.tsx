"use client";

import { useState } from "react";
import {
  Lock,
  LockOpen,
  FolderLock,
  ShieldCheck,
  Trash,
  FolderOpen,
  Key,
} from "@phosphor-icons/react";
import { Button, Input } from "@heroui/react";
import { SettingSection } from "../SettingSection";
import { trpc } from "@/lib/trpc/client";

// ── Passphrase modal ──────────────────────────────────────────────────────────

interface PassphraseModalProps {
  title: string;
  onConfirm: (passphrase: string) => void;
  onCancel: () => void;
  loading?: boolean;
  error?: string | null;
}

function PassphraseModal({ title, onConfirm, onCancel, loading, error }: PassphraseModalProps) {
  const [value, setValue] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        className="w-full max-w-sm rounded-xl border p-6 shadow-xl"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)" }}
      >
        <div className="mb-4 flex items-center gap-2">
          <Key size={18} style={{ color: "var(--accent)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h2>
        </div>
        <Input
          type="password"
          placeholder="Passphrase..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && value && onConfirm(value)}
          autoFocus
          className="mb-3 w-full"
        />
        {error && (
          <p className="mb-3 text-xs" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onPress={onCancel}
            className="rounded-md px-3 py-1.5 text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            Annuler
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => value && onConfirm(value)}
            isDisabled={!value || loading}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            {loading ? "En cours..." : "Confirmer"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Folder picker row ─────────────────────────────────────────────────────────

interface FolderRowProps {
  folder: string;
  onDecrypt: (folder: string) => void;
}

function FolderRow({ folder, onDecrypt }: FolderRowProps) {
  const name = folder.split(/[\\/]/).pop() ?? folder;
  return (
    <div
      className="flex items-center justify-between rounded-lg border px-3 py-2"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)" }}
    >
      <div className="flex items-center gap-2">
        <FolderLock size={16} style={{ color: "var(--accent)" }} />
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {name}
          </p>
          <p className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
            {folder}
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => onDecrypt(folder)}
        className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
        style={{
          borderColor: "var(--danger)",
          color: "var(--danger)",
          backgroundColor: "transparent",
        }}
      >
        <Trash size={12} />
        Dechiffrer
      </Button>
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

type ModalMode =
  | { type: "encrypt" }
  | { type: "decrypt"; folder: string }
  | { type: "unlock" }
  | null;

export function SecurityTab() {
  const [modal, setModal] = useState<ModalMode>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const statusQuery = trpc.system.encryption.status.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const utils = trpc.useUtils();

  const encryptMutation = trpc.system.encryption.encryptFolder.useMutation({
    onSuccess: () => { setModal(null); void utils.system.encryption.status.invalidate(); },
    onError: (e) => setModalError(e.message),
  });

  const decryptMutation = trpc.system.encryption.decryptFolder.useMutation({
    onSuccess: () => { setModal(null); void utils.system.encryption.status.invalidate(); },
    onError: (e) => setModalError(e.message),
  });

  const unlockMutation = trpc.system.encryption.unlock.useMutation({
    onSuccess: () => { setModal(null); void utils.system.encryption.status.invalidate(); },
    onError: (e) => setModalError(e.message),
  });

  const lockMutation = trpc.system.encryption.lock.useMutation({
    onSuccess: () => void utils.system.encryption.status.invalidate(),
  });

  const folderPickerMutation = trpc.system.picker.selectFolder.useMutation();

  const status = statusQuery.data;
  const encryptedFolders = status?.encryptedFolders ?? [];
  const isUnlocked = status?.unlocked ?? false;

  const handlePickAndEncrypt = async () => {
    const result = await folderPickerMutation.mutateAsync({
      title: "Selectionner un dossier a chiffrer",
    });
    if (result.path) {
      setModalError(null);
      setModal({ type: "encrypt" });
      // Store folder path to use when modal confirms
      // Using a ref-like trick via closure
      handleEncryptConfirm._folder = result.path;
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEncryptConfirm = Object.assign(async (passphrase: string) => {
    const folder = handleEncryptConfirm._folder;
    if (!folder) return;
    await encryptMutation.mutateAsync({ folderPath: folder, passphrase });
  }, { _folder: "" as string });

  const handleDecryptConfirm = async (passphrase: string, folder: string) => {
    await decryptMutation.mutateAsync({ folderPath: folder, passphrase });
  };

  const handleUnlockConfirm = async (passphrase: string) => {
    await unlockMutation.mutateAsync({ passphrase });
  };

  const openModal = (m: ModalMode) => { setModalError(null); setModal(m); };

  return (
    <div className="space-y-6">
      {/* Modal */}
      {modal?.type === "encrypt" && (
        <PassphraseModal
          title="Definir la passphrase pour chiffrer ce dossier"
          onConfirm={handleEncryptConfirm}
          onCancel={() => setModal(null)}
          loading={encryptMutation.isPending}
          error={modalError}
        />
      )}
      {modal?.type === "decrypt" && (
        <PassphraseModal
          title={`Dechiffrer le dossier "${modal.folder.split(/[\\/]/).pop()}"`}
          onConfirm={(p) => handleDecryptConfirm(p, modal.folder)}
          onCancel={() => setModal(null)}
          loading={decryptMutation.isPending}
          error={modalError}
        />
      )}
      {modal?.type === "unlock" && (
        <PassphraseModal
          title="Deverrouiller le coffre"
          onConfirm={handleUnlockConfirm}
          onCancel={() => setModal(null)}
          loading={unlockMutation.isPending}
          error={modalError}
        />
      )}

      {/* Status */}
      <SettingSection
        title="Statut du coffre"
        description="Session de chiffrement active"
        icon={<ShieldCheck size={16} />}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isUnlocked ? (
              <LockOpen size={16} style={{ color: "var(--success, #22c55e)" }} />
            ) : (
              <Lock size={16} style={{ color: "var(--text-muted)" }} />
            )}
            <span className="text-sm" style={{ color: "var(--text-primary)" }}>
              {isUnlocked ? "Coffre deverrouille" : "Coffre verrouille"}
            </span>
          </div>
          <div className="flex gap-2">
            {!isUnlocked && encryptedFolders.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onPress={() => openModal({ type: "unlock" })}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                style={{
                  borderColor: "var(--accent)",
                  color: "var(--accent)",
                  backgroundColor: "var(--accent-subtle)",
                }}
              >
                <LockOpen size={14} />
                Deverrouiller
              </Button>
            )}
            {isUnlocked && (
              <Button
                variant="ghost"
                size="sm"
                onPress={() => lockMutation.mutate()}
                isDisabled={lockMutation.isPending}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text-secondary)",
                  backgroundColor: "transparent",
                }}
              >
                <Lock size={14} />
                Verrouiller
              </Button>
            )}
          </div>
        </div>
        {isUnlocked && (
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Se verrouille automatiquement apres 15 minutes d'inactivite.
          </p>
        )}
      </SettingSection>

      {/* Encrypted folders */}
      <SettingSection
        title="Dossiers chiffres"
        description="Les fichiers dans ces dossiers sont chiffres avec age sur le disque"
        icon={<FolderLock size={16} />}
      >
        {encryptedFolders.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Aucun dossier chiffre. Cliquez sur &quot;+ Chiffrer un dossier&quot; pour commencer.
          </p>
        ) : (
          <div className="space-y-2">
            {encryptedFolders.map((f) => (
              <FolderRow
                key={f}
                folder={f}
                onDecrypt={(folder) => openModal({ type: "decrypt", folder })}
              />
            ))}
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          onPress={handlePickAndEncrypt}
          isDisabled={folderPickerMutation.isPending || encryptMutation.isPending}
          className="mt-3 flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
          style={{
            borderColor: "var(--accent)",
            color: "var(--accent)",
            backgroundColor: "var(--accent-subtle)",
          }}
        >
          <FolderOpen size={14} />
          + Chiffrer un dossier
        </Button>
      </SettingSection>
    </div>
  );
}
