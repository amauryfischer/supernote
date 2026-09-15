"use client";

/**
 * useMailAutoLabel — passe de classement automatique des nouveaux emails.
 *
 * Fonctionne par petits lots, en série : un modèle local sérialise de toute
 * façon les requêtes, et un lot borné évite qu'une boîte de 300 fils monopolise
 * la machine au premier chargement. La passe automatique attend quelques
 * secondes après la stabilisation de la liste ; « Classer maintenant » la
 * déclenche sans attendre.
 *
 * Le label Gmail de la catégorie est créé à la demande, une seule fois, puis
 * réutilisé. Rien n'est archivé ni supprimé ici — seul un label est posé.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@supernote/ui";
import { createLabel, type GmailLabel, type ThreadListItem } from "@/lib/gmail";
import {
  MAIL_CATEGORIES,
  categoryById,
  classifyThread,
  loadSeen,
  markSeen,
  pendingForClassification,
} from "@/lib/mail-autolabel";

/** Fils classés par passe (borne le coût d'un premier chargement). */
const BATCH = 8;
/** Délai d'inactivité avant une passe automatique. */
const IDLE_MS = 4000;

export interface UseMailAutoLabelOptions {
  enabled: boolean;
  clientId: string;
  /** Fils de la boîte, tels qu'affichés. */
  items: ThreadListItem[];
  /** Labels connus (id → nom) pour retrouver / créer ceux des catégories. */
  labelNames: Map<string, string>;
  /** Applique un label à un fil (chemin optimiste + outbox de la page). */
  applyLabel: (threadId: string, labelId: string) => void;
  /** Appelé après création d'un label Gmail (la page recharge sa table). */
  onLabelCreated?: (label: GmailLabel) => void;
}

export function useMailAutoLabel({
  enabled,
  clientId,
  items,
  labelNames,
  applyLabel,
  onLabelCreated,
}: UseMailAutoLabelOptions) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const runningRef = useRef(false);
  // Lus dans la passe : évite de la relancer à chaque rendu.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const labelNamesRef = useRef(labelNames);
  labelNamesRef.current = labelNames;
  const applyRef = useRef(applyLabel);
  applyRef.current = applyLabel;

  // Nom → id, reconstruit à chaque accès (la table change après une création).
  const labelIdByName = useCallback((name: string): string | undefined => {
    for (const [id, n] of labelNamesRef.current) {
      if (n.toLowerCase() === name.toLowerCase()) return id;
    }
    return undefined;
  }, []);

  const autoLabelIds = useCallback((): Set<string> => {
    const out = new Set<string>();
    for (const c of MAIL_CATEGORIES) {
      const id = labelIdByName(c.labelName);
      if (id) out.add(id);
    }
    return out;
  }, [labelIdByName]);

  const remaining = enabled
    ? pendingForClassification(items, loadSeen(), autoLabelIds()).length
    : 0;

  const run = useCallback(async () => {
    if (runningRef.current || !clientId) return;
    const pending = pendingForClassification(
      itemsRef.current,
      loadSeen(),
      autoLabelIds(),
    ).slice(0, BATCH);
    if (pending.length === 0) return;

    runningRef.current = true;
    setBusy(true);
    const done: string[] = [];
    // Cache local des labels créés pendant la passe : sans lui, deux fils de la
    // même catégorie créeraient deux fois le label (409 côté Gmail).
    const createdIds = new Map<string, string>();
    try {
      for (const it of pending) {
        let category: string;
        try {
          category = await classifyThread({
            subject: it.subject,
            from: it.from,
            snippet: it.snippet,
          });
        } catch {
          // Ollama injoignable : on arrête la passe, sans marquer les fils vus
          // (ils seront reproposés) ni assommer l'utilisateur de toasts.
          break;
        }
        done.push(it.id);
        const cat = categoryById(category);
        if (!cat) continue; // "humain" → on ne range rien, c'est le défaut

        let labelId = createdIds.get(cat.labelName) ?? labelIdByName(cat.labelName);
        if (!labelId) {
          try {
            const created = await createLabel(clientId, cat.labelName);
            labelId = created.id;
            createdIds.set(cat.labelName, created.id);
            onLabelCreated?.(created);
          } catch {
            continue; // création impossible → on n'insiste pas sur ce fil
          }
        }
        applyRef.current(it.id, labelId);
      }
    } finally {
      markSeen(done);
      runningRef.current = false;
      setBusy(false);
    }
  }, [clientId, autoLabelIds, labelIdByName, onLabelCreated]);

  /** Passe manuelle : dit ce qu'elle fait, y compris quand il n'y a rien. */
  const runNow = useCallback(() => {
    const pending = pendingForClassification(
      itemsRef.current,
      loadSeen(),
      autoLabelIds(),
    ).length;
    if (pending === 0) {
      toast({ title: "Rien à classer", description: "Tous les fils ont déjà été vus." });
      return;
    }
    void run();
  }, [run, autoLabelIds, toast]);

  // Passe automatique après stabilisation de la liste.
  useEffect(() => {
    if (!enabled || !clientId) return undefined;
    const id = setTimeout(() => void run(), IDLE_MS);
    return () => clearTimeout(id);
  }, [enabled, clientId, items, run]);

  return { busy, remaining, runNow };
}
