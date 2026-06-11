"use client";

/**
 * ConnectVaultModal — formulaire « Connecter un vault ».
 *
 * Déclare un salon cloud à monter dans le coffre père : on saisit la clé de
 * salon (obligatoire), un nom affiché optionnel, le serveur et le jeton. La
 * soumission sonde le serveur puis crée l'entité `vault_mount` (cf.
 * {@link useCreateMount}). Le {@link MountSyncProvider} prend le relais et
 * démarre la synchro automatiquement.
 *
 * Le champ clé impose `autoCapitalize="none"` : un clavier mobile qui
 * capitalise la première lettre forkerait la paire en deux salons distincts.
 */

import { useState } from "react";
import { Button, Input, Label, Modal, useToast } from "@supernote/ui";
import { useCreateMount } from "@/lib/online-sync/mounts/use-create-mount";

interface ConnectVaultModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectVaultModal({ isOpen, onOpenChange }: ConnectVaultModalProps) {
  const { createMount } = useCreateMount();
  const { toast } = useToast();

  const [vaultKey, setVaultKey] = useState("");
  const [label, setLabel] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setVaultKey("");
    setLabel("");
    setServerUrl("");
    setToken("");
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const submit = async () => {
    if (submitting) return;
    if (!vaultKey.trim()) {
      toast({ title: "Une clé de salon est requise.", variant: "danger" });
      return;
    }
    setSubmitting(true);
    try {
      await createMount({ vaultKey, label, serverUrl, token });
      toast({
        title: "Vault connecté",
        description: label.trim() || vaultKey.trim(),
        variant: "success",
      });
      close();
    } catch (err) {
      toast({
        title: "Connexion impossible",
        description: err instanceof Error ? err.message : "Erreur inconnue.",
        variant: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Connecter un vault"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={close}
            isDisabled={submitting}
          >
            Annuler
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void submit()}
            isLoading={submitting}
          >
            Connecter
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="connect-vault-key" required>
            Clé de salon
          </Label>
          <Input
            id="connect-vault-key"
            type="text"
            value={vaultKey}
            onChange={(e) => setVaultKey(e.target.value)}
            placeholder="ex. equipe-design"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="connect-vault-label">Nom affiché</Label>
          <Input
            id="connect-vault-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optionnel — par défaut la clé de salon"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="connect-vault-server">Serveur</Label>
          <Input
            id="connect-vault-server"
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="connect-vault-token">Jeton</Label>
          <Input
            id="connect-vault-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Optionnel"
            autoComplete="off"
          />
        </div>
        {/* Submit implicite (Entrée) — le bouton du footer pilote la soumission. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
