"use client";

import { SectionStub } from "@/components/section-stub";
import { Wallet } from "lucide-react";

export default function FinancePage() {
  return (
    <SectionStub
      icon={Wallet}
      title="Finance"
      description="Vue d'ensemble du patrimoine : comptes bancaires, actifs (immobilier / actions / crypto), prêts avec amortissement auto, snapshots datés et objectifs avec ETA."
      hint="Le module packages/finance est prêt (5 entity types, pricing Yahoo/CoinGecko, amortissement). Dashboard à brancher dans la prochaine itération."
    />
  );
}
