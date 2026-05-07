import type { RelationType } from "./fixtures";

/** Deterministic hue from a string (for avatar background). */
export function nameToHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

/** Return initials (up to 2 chars) from a full name. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Avatar background style using oklch deterministic color. */
export function avatarStyle(name: string): { backgroundColor: string; color: string } {
  const hue = nameToHue(name);
  return {
    backgroundColor: `oklch(0.80 0.12 ${hue})`,
    color: `oklch(0.25 0.08 ${hue})`,
  };
}

/** Relative birthday string (e.g. "dans 3 mois", "dans 5 jours"). */
export function relativeBirthday(birthday: string | undefined, today = new Date()): string | null {
  if (!birthday) return null;
  const [, month, day] = birthday.split("-").map(Number);
  if (!month || !day) return null;

  const thisYear = new Date(today.getFullYear(), month - 1, day);
  const nextYear = new Date(today.getFullYear() + 1, month - 1, day);
  const next = thisYear < today ? nextYear : thisYear;

  const diff = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "aujourd'hui !";
  if (diff === 1) return "demain";
  if (diff <= 7) return `dans ${diff} jours`;
  if (diff <= 30) return `dans ${Math.round(diff / 7)} sem.`;
  if (diff <= 60) return "dans 1 mois";
  const months = Math.round(diff / 30);
  return `dans ${months} mois`;
}

/** True if birthday is within 7 days. */
export function isBirthdaySoon(birthday: string | undefined, today = new Date()): boolean {
  if (!birthday) return false;
  const [, month, day] = birthday.split("-").map(Number);
  if (!month || !day) return false;
  const thisYear = new Date(today.getFullYear(), month - 1, day);
  const nextYear = new Date(today.getFullYear() + 1, month - 1, day);
  const next = thisYear < today ? nextYear : thisYear;
  const diff = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  return diff <= 7;
}

/** Format a date string to locale (FR). */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const RELATION_COLORS: Record<RelationType, { bg: string; text: string }> = {
  ami: { bg: "oklch(0.88 0.10 200)", text: "oklch(0.28 0.12 200)" },
  famille: { bg: "oklch(0.88 0.10 30)", text: "oklch(0.30 0.12 30)" },
  collègue: { bg: "oklch(0.88 0.10 260)", text: "oklch(0.28 0.12 260)" },
  client: { bg: "oklch(0.88 0.10 150)", text: "oklch(0.28 0.12 150)" },
  mentor: { bg: "oklch(0.88 0.10 295)", text: "oklch(0.28 0.12 295)" },
  connaissance: { bg: "oklch(0.88 0.06 240)", text: "oklch(0.35 0.06 240)" },
  partenaire: { bg: "oklch(0.88 0.12 80)", text: "oklch(0.28 0.12 80)" },
};

export function relationColor(type: RelationType): { bg: string; text: string } {
  return RELATION_COLORS[type] ?? { bg: "oklch(0.90 0.03 240)", text: "oklch(0.40 0.04 240)" };
}
