/**
 * Outils de l'assistant /ai au-delà des notes : mails, engagements, agenda,
 * contacts. Tout est lu dans le coffre local. Chaque élément porte un `url`
 * interne : le modèle cite la source, l'interface en fait un lien.
 */

import type { AgentTool } from "@supernote/ai/agent";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { findMailThreads } from "@/lib/mail-assistant";
import { mirrorAvailable, mirrorGetThread } from "@/lib/mail-mirror";
import { fromEntity, MAIL_COMMITMENT_TYPE_ID, type ThreadCommitments } from "@/lib/mail-commitments";
import { contactEmails } from "@/lib/contact-from-email";

const DAY_MS = 86_400_000;
const MAX_BODY_CHARS = 1_500;

// Les outils tournent hors React : on relit le compte connecté là où SettingsContext le persiste.
function connectedAccount(): string {
  try {
    const raw = window.localStorage.getItem("supernote.settings");
    const s = raw ? (JSON.parse(raw) as { gmail?: { connectedEmail?: string }; googleDrive?: { connectedEmail?: string } }) : {};
    return s.gmail?.connectedEmail || s.googleDrive?.connectedEmail || "";
  } catch {
    return "";
  }
}

const threadUrl = (id: string) => `/mail?thread=${encodeURIComponent(id)}`;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && v !== undefined && v !== "" ? Number(v) : fallback);

export const searchMail: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "searchMail",
      description:
        "Cherche dans les emails de l'utilisateur (copie locale de sa boîte). Retourne les fils : objet, expéditeur, date, extrait. Utilise getMailThread pour lire un fil en entier.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Question ou mots-clés (ex. « devis Acme », « cette semaine »)" },
        },
        required: ["query"],
      },
    },
  },
  async execute(args) {
    const accountId = connectedAccount();
    if (!accountId || !mirrorAvailable()) return { items: [], note: "boîte mail indisponible sur cet appareil" };
    const { sources } = await findMailThreads(accountId, String(args["query"] ?? ""), 8);
    return {
      items: sources.map((t) => ({
        threadId: t.id,
        subject: t.subject,
        from: t.from.name ? `${t.from.name} <${t.from.email}>` : t.from.email,
        date: t.date,
        snippet: clip(t.snippet, 200),
        url: threadUrl(t.id),
      })),
    };
  },
};

export const getMailThread: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "getMailThread",
      description: "Lit un fil d'emails complet (expéditeur, date, texte de chaque message) à partir de son threadId.",
      parameters: {
        type: "object",
        properties: { threadId: { type: "string", description: "threadId renvoyé par searchMail" } },
        required: ["threadId"],
      },
    },
  },
  async execute(args) {
    const accountId = connectedAccount();
    const threadId = String(args["threadId"] ?? "");
    if (!accountId || !mirrorAvailable()) return { error: "boîte mail indisponible sur cet appareil" };
    const res = await mirrorGetThread(accountId, threadId).catch(() => null);
    if (!res) return { error: "fil introuvable" };
    const messages = res.thread.messages;
    return {
      subject: messages[0]?.subject ?? "",
      url: threadUrl(threadId),
      messages: messages.slice(-8).map((m) => ({
        from: m.from.name || m.from.email,
        date: m.date,
        text: clip(m.bodyText || m.snippet, MAX_BODY_CHARS),
      })),
    };
  },
};

export const listCommitments: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "listCommitments",
      description:
        "Liste les engagements repérés dans les emails : promesses faites par l'utilisateur (direction « moi ») ou qu'on lui a faites (« eux »), avec échéance. Filtrable par personne (nom ou email).",
      parameters: {
        type: "object",
        properties: {
          person: { type: "string", description: "Nom, email ou domaine de la personne (optionnel)" },
          direction: { type: "string", enum: ["moi", "eux"], description: "moi = je dois ; eux = on me doit (optionnel)" },
        },
      },
    },
  },
  async execute(args) {
    const accountId = connectedAccount();
    const person = String(args["person"] ?? "").trim().toLowerCase();
    const direction = args["direction"] === "moi" || args["direction"] === "eux" ? args["direction"] : null;
    const res = await trpcVanillaClient.entities.list.query({ typeId: MAIL_COMMITMENT_TYPE_ID, limit: 1000 });
    const items = res.items
      .map(fromEntity)
      .filter((tc): tc is ThreadCommitments => tc !== null && (!accountId || tc.accountId === accountId))
      .flatMap((tc) =>
        tc.items
          .filter((c) => c.status !== "dismissed")
          .filter((c) => !direction || c.direction === direction)
          .filter((c) => !person || `${c.who} ${c.whoEmail} ${tc.subject}`.toLowerCase().includes(person))
          .map((c) => ({
            text: c.text,
            direction: c.direction,
            who: c.who || c.whoEmail,
            due: c.due,
            status: c.status === "suggested" ? "à valider" : "suivi",
            subject: tc.subject,
            url: threadUrl(tc.threadId),
          })),
      )
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
      .slice(0, 20);
    return { items };
  },
};

export const listEvents: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "listEvents",
      description:
        "Liste les rendez-vous de l'agenda (par défaut de J-30 à J+30) : titre, début, participants, note de réunion liée. Filtrable par mot du titre ou participant.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Mot du titre, nom ou email d'un participant (optionnel)" },
          fromDays: { type: "number", description: "Début de la plage en jours par rapport à aujourd'hui (défaut -30)" },
          toDays: { type: "number", description: "Fin de la plage en jours par rapport à aujourd'hui (défaut 30)" },
        },
      },
    },
  },
  async execute(args) {
    const accountId = connectedAccount();
    if (!accountId) return { items: [], note: "agenda non connecté" };
    const now = Date.now();
    const from = now + num(args["fromDays"], -30) * DAY_MS;
    const to = now + num(args["toDays"], 30) * DAY_MS;
    const q = String(args["query"] ?? "").trim().toLowerCase();
    const res = await trpcVanillaClient.calendar.listEvents.query({ accountId, from, to });
    const items = res.events
      .filter((e) => !q || `${e.summary} ${e.attendees.map((a) => `${a.name} ${a.email}`).join(" ")}`.toLowerCase().includes(q))
      .slice(0, 15)
      .map((e) => ({
        summary: e.summary,
        start: new Date(e.startAt).toISOString(),
        attendees: e.attendees.filter((a) => !a.self).map((a) => a.name || a.email),
        meetingNote: e.noteId ? `/notes/${e.noteId}` : null,
        url: `/agenda?event=${encodeURIComponent(e.id)}&at=${e.startAt}`,
      }));
    return items.length ? { items } : { items, note: "aucun rendez-vous dans la plage" };
  },
};

export const findContact: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "findContact",
      description: "Cherche une personne dans les contacts (nom ou email). Retourne sa fiche : nom, emails, lien.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Nom ou email" } },
        required: ["query"],
      },
    },
  },
  async execute(args) {
    const q = String(args["query"] ?? "").trim().toLowerCase();
    if (!q) return { items: [] };
    const res = await trpcVanillaClient.entities.listSummaries.query({ typeId: "personne", limit: 2000, offset: 0 });
    const items = res.items
      .map((c) => {
        const fields = (c.fields ?? {}) as Record<string, unknown>;
        const name = typeof fields["name"] === "string" ? fields["name"] : "";
        return { id: c.id, name, emails: contactEmails(fields) };
      })
      .filter((c) => `${c.name} ${c.emails.join(" ")}`.toLowerCase().includes(q))
      .slice(0, 5)
      .map((c) => ({ ...c, url: `/contacts/${c.id}` }));
    return { items };
  },
};

export const VAULT_TOOLS: AgentTool[] = [searchMail, getMailThread, listCommitments, listEvents, findContact];
