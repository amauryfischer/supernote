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
 *
 * Seuil de confiance : un fil dont le classement n'atteint pas `minConfidence`
 * est laissé SANS tag, mais marqué vu — le rejouer donnerait le même verdict,
 * et l'utilisateur garde la main (clic droit → ajouter un tag). Le décompte des
 * fils écartés remonte à l'appelant pour être dit, jamais tu.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@supernote/ui";
import { createLabel, type GmailLabel, type ThreadListItem } from "@/lib/gmail";
import type { ClassificationResult } from "@/lib/mail-autolabel";
import {
  categoryById,
  classifyThread,
  loadSeen,
  markSeen,
  pendingForClassification,
} from "@/lib/mail-autolabel";

/** Bilan de la dernière passe — ce qui a été posé, ce qui a été écarté. */
export interface AutoLabelPass {
  labeled: number;
  /** Fils laissés sans tag faute de confiance suffisante. */
  skipped: number;
}

/** Fils classés par passe (borne le coût d'un premier chargement). */
const BATCH = 8;
/** Délai d'inactivité avant une passe automatique. */
const IDLE_MS = 4000;

export interface UseMailAutoLabelOptions {
  enabled: boolean;
  clientId: string;
  /**
   * Confiance minimale (0..1) pour qu'un tag soit réellement posé. En dessous,
   * le fil est laissé tel quel. Cf. `confidenceThreshold` côté réglages.
   */
  minConfidence: number;
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
  minConfidence,
  items,
  labelNames,
  applyLabel,
  onLabelCreated,
}: UseMailAutoLabelOptions) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [lastPass, setLastPass] = useState<AutoLabelPass | null>(null);
  const runningRef = useRef(false);
  /** Passe déclenchée à la main : seule celle-là rend des comptes par toast. */
  const manualRef = useRef(false);
  // Lu dans la passe (qui ne doit pas se recréer quand le seuil change).
  const minConfidenceRef = useRef(minConfidence);
  minConfidenceRef.current = minConfidence;
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

  const remaining = enabled ? pendingForClassification(items, loadSeen()).length : 0;

  const run = useCallback(async () => {
    if (runningRef.current || !clientId) return;
    const pending = pendingForClassification(itemsRef.current, loadSeen()).slice(0, BATCH);
    if (pending.length === 0) return;

    runningRef.current = true;
    setBusy(true);
    const done: string[] = [];
    let labeled = 0;
    let skipped = 0;
    // Cache local des labels créés pendant la passe : sans lui, deux fils de la
    // même catégorie créeraient deux fois le label (409 côté Gmail).
    const createdIds = new Map<string, string>();
    try {
      for (const it of pending) {
        let verdict: ClassificationResult;
        try {
          verdict = await classifyThread({
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
        const cat = categoryById(verdict.category);
        if (!cat) continue; // "humain" → on ne range rien, c'est le défaut
        // Modèle pas assez d'accord avec lui-même : on ne pose RIEN. Le fil est
        // tout de même marqué vu — le rejouer rendrait le même verdict.
        if (verdict.confidence < minConfidenceRef.current) {
          skipped++;
          continue;
        }

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
        labeled++;
      }
    } finally {
      markSeen(done);
      setLastPass({ labeled, skipped });
      // Ce qui a été ÉCARTÉ doit se voir : sans ça, « rien ne s'est passé »
      // ressemble à une panne alors que c'est le seuil qui a joué.
      if (manualRef.current) {
        manualRef.current = false;
        const title = labeled > 0 ? `${labeled} email(s) rangé(s)` : "Aucun tag posé";
        toast(
          skipped > 0
            ? {
                title,
                description: `${skipped} fil(s) écarté(s) : le modèle n'était pas assez sûr.`,
              }
            : { title },
        );
      }
      runningRef.current = false;
      setBusy(false);
    }
  }, [clientId, labelIdByName, onLabelCreated, toast]);

  /** Passe manuelle : dit ce qu'elle fait, y compris quand il n'y a rien. */
  const runNow = useCallback(() => {
    const pending = pendingForClassification(itemsRef.current, loadSeen()).length;
    if (pending === 0) {
      toast({ title: "Rien à classer", description: "Tous les fils sans label ont déjà été vus." });
      return;
    }
    manualRef.current = true;
    void run();
  }, [run, toast]);

  // Passe automatique après stabilisation de la liste.
  useEffect(() => {
    if (!enabled || !clientId) return undefined;
    const id = setTimeout(() => void run(), IDLE_MS);
    return () => clearTimeout(id);
  }, [enabled, clientId, items, run]);

  return { busy, remaining, lastPass, runNow };
}
