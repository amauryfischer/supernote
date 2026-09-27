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
 * L'IA choisit parmi les labels permis (hors Todo et splits) ou en crée un sous
 * `Supernote/`, une seule fois, puis réutilisé. Rien n'est archivé ni supprimé
 * ici — seul un label est posé.
 *
 * Seuil de confiance : un fil dont le classement n'atteint pas `minConfidence`
 * est laissé SANS tag, mais marqué vu — le rejouer donnerait le même verdict,
 * et l'utilisateur garde la main (clic droit → ajouter un tag). Le décompte des
 * fils écartés remonte à l'appelant pour être dit, jamais tu.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createLabel, type GmailLabel, type ThreadListItem } from "@/lib/gmail";
import type { ClassificationResult } from "@/lib/mail-autolabel";
import {
  allowedLabelNames,
  classifyThread,
  pendingForClassification,
  selfLabelIds,
} from "@/lib/mail-autolabel";
import { loadGroups } from "@/lib/mail-groups";
import { mirrorAvailable, mirrorSetAiCategory } from "@/lib/mail-mirror";

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
  accountId: string;
  /**
   * Confiance minimale (0..1) pour qu'un tag soit réellement posé. En dessous,
   * le fil est laissé tel quel. Cf. `confidenceThreshold` côté réglages.
   */
  minConfidence: number;
  /** Fils de la boîte, tels qu'affichés. */
  items: ThreadListItem[];
  /** Labels connus (id → nom) pour retrouver / créer ceux des catégories. */
  labelNames: Map<string, string>;
  /** Mes adresses (compte + alias) : un label à leur nom ne compte pas comme rangement. */
  selfAddresses: readonly string[];
  /** Applique un label à un fil (chemin optimiste + outbox de la page). */
  applyLabel: (threadId: string, labelId: string) => void;
  /** Appelé après création d'un label Gmail (la page recharge sa table). */
  onLabelCreated?: (label: GmailLabel) => void;
}

export function useMailAutoLabel({
  enabled,
  clientId,
  accountId,
  minConfidence,
  items,
  labelNames,
  selfAddresses,
  applyLabel,
  onLabelCreated,
}: UseMailAutoLabelOptions) {
  const [busy, setBusy] = useState(false);
  const [lastPass, setLastPass] = useState<AutoLabelPass | null>(null);
  const runningRef = useRef(false);
  const minConfidenceRef = useRef(minConfidence);
  minConfidenceRef.current = minConfidence;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const labelNamesRef = useRef(labelNames);
  labelNamesRef.current = labelNames;
  const selfAddressesRef = useRef(selfAddresses);
  selfAddressesRef.current = selfAddresses;
  const applyRef = useRef(applyLabel);
  applyRef.current = applyLabel;
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;

  // Nom → id, reconstruit à chaque accès (la table change après une création).
  const labelIdByName = useCallback((name: string): string | undefined => {
    for (const [id, n] of labelNamesRef.current) {
      if (n.toLowerCase() === name.toLowerCase()) return id;
    }
    return undefined;
  }, []);

  const remaining = enabled
    ? pendingForClassification(items, selfLabelIds(labelNames, selfAddresses)).length
    : 0;

  const run = useCallback(async () => {
    if (runningRef.current || !clientId) return;
    const pending = pendingForClassification(
      itemsRef.current,
      selfLabelIds(labelNamesRef.current, selfAddressesRef.current),
    ).slice(0, BATCH);
    if (pending.length === 0) return;

    runningRef.current = true;
    setBusy(true);
    let labeled = 0;
    let skipped = 0;
    const createdIds = new Map<string, string>();
    const useMirror = mirrorAvailable();
    // Un label de split sortirait le fil de la boîte : décision réservée à l'utilisateur.
    const forbidden = new Set([
      ...selfLabelIds(labelNamesRef.current, selfAddressesRef.current),
      ...loadGroups().flatMap((g) => g.labelIds),
    ]);
    const allowed = allowedLabelNames(labelNamesRef.current, forbidden);
    try {
      for (const it of pending) {
        let verdict: ClassificationResult;
        try {
          verdict = await classifyThread(
            { subject: it.subject, from: it.from, snippet: it.snippet },
            allowed,
          );
        } catch {
          break;
        }
        const { vote } = verdict;

        // Persister aussi « aucun » : le fil est marqué vu et ne repasse pas.
        if (useMirror && accountIdRef.current) {
          try {
            await mirrorSetAiCategory(
              accountIdRef.current, it.id,
              vote.kind === "none" ? "aucun" : vote.name, verdict.confidence, verdict.runs,
            );
          } catch { /* best-effort — le classement continue */ }
        }

        if (vote.kind === "none") continue;
        if (verdict.confidence < minConfidenceRef.current) {
          skipped++;
          continue;
        }

        let labelId = createdIds.get(vote.name.toLowerCase()) ?? labelIdByName(vote.name);
        if (!labelId) {
          try {
            const created = await createLabel(clientId, vote.name);
            labelId = created.id;
            createdIds.set(vote.name.toLowerCase(), created.id);
            // Les fils suivants de la passe réutilisent ce label au lieu d'en inventer un voisin.
            allowed.push(created.name);
            onLabelCreated?.(created);
          } catch {
            continue;
          }
        }
        applyRef.current(it.id, labelId);
        labeled++;
      }
    } finally {
      setLastPass({ labeled, skipped });
      runningRef.current = false;
      setBusy(false);
    }
  }, [clientId, labelIdByName, onLabelCreated]);

  const runNow = useCallback(() => {
    void run();
  }, [run]);

  // Passe automatique après stabilisation de la liste.
  useEffect(() => {
    if (!enabled || !clientId) return undefined;
    const id = setTimeout(() => void run(), IDLE_MS);
    return () => clearTimeout(id);
  }, [enabled, clientId, items, run]);

  return { busy, remaining, lastPass, runNow };
}
