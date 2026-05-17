/**
 * Concrete agent tools — thin wrappers over the tRPC vault client.
 *
 * Each tool is `{ definition, execute }`. The definition is the JSON
 * schema fed to Ollama so the model knows how to call it; `execute`
 * forwards the call to the in-browser vault worker via the vanilla
 * tRPC client and returns a model-friendly summary.
 *
 * The summaries trim heavy fields (raw body, full field maps) when the
 * result is a list — feeding 50 full notes back into Ollama blows up
 * context for nothing. The agent can always follow up with
 * `getNote(id)` for the full body.
 */

import type { AgentTool } from "@supernote/ai/agent";
import { trpcVanillaClient } from "@/lib/trpc/client";

interface NoteSummary {
  id: string;
  typeName: string;
  filePath: string;
  tags: string[];
  preview: string;
  updatedAt: string;
}

function trimBody(body: string | undefined, max = 200): string {
  if (!body) return "";
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

function toSummary(item: {
  id: string;
  typeName: string;
  filePath: string;
  tags: string[];
  body?: string;
  updatedAt: string;
}): NoteSummary {
  return {
    id: item.id,
    typeName: item.typeName,
    filePath: item.filePath,
    tags: item.tags,
    preview: trimBody(item.body),
    updatedAt: item.updatedAt,
  };
}

export const searchNotes: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "searchNotes",
      description:
        "Recherche plein-texte dans toutes les notes du vault. Retourne une liste de résumés (id, type, chemin, tags, aperçu). Utilise getNote pour obtenir le corps complet.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termes à chercher" },
          limit: {
            type: "number",
            description: "Nombre maximum de résultats (défaut 20, max 200)",
          },
        },
        required: ["query"],
      },
    },
  },
  async execute(args) {
    const query = String(args["query"] ?? "");
    const limitRaw = Number(args["limit"]);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 20;
    const res = await trpcVanillaClient.entities.search.query({ query, limit });
    return {
      total: res.total,
      items: res.items.map(toSummary),
    };
  },
};

export const listNotes: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "listNotes",
      description:
        "Liste les notes du vault, filtrable par type (note, todo, contact…) et tags. Pagination via limit/offset.",
      parameters: {
        type: "object",
        properties: {
          typeName: {
            type: "string",
            description: "Nom du type (ex: note, todo, contact). Optionnel.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Filtrer sur ces tags (AND). Optionnel.",
          },
          limit: { type: "number", description: "Max résultats (défaut 50)" },
          offset: { type: "number", description: "Décalage pagination" },
        },
      },
    },
  },
  async execute(args) {
    const limitRaw = Number(args["limit"]);
    const offsetRaw = Number(args["offset"]);
    const input: {
      typeName?: string;
      tags?: string[];
      limit: number;
      offset: number;
    } = {
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50,
      offset: Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0,
    };
    if (typeof args["typeName"] === "string") input.typeName = args["typeName"];
    if (Array.isArray(args["tags"])) {
      input.tags = (args["tags"] as unknown[]).map((t) => String(t));
    }
    const res = await trpcVanillaClient.entities.list.query(input);
    return {
      total: res.total,
      items: res.items.map(toSummary),
    };
  },
};

export const getNote: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "getNote",
      description:
        "Récupère une note complète (corps markdown + champs structurés + tags) à partir de son id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Id de la note (ULID)" },
        },
        required: ["id"],
      },
    },
  },
  async execute(args) {
    const id = String(args["id"] ?? "");
    const note = await trpcVanillaClient.entities.get.query({ id });
    return {
      id: note.id,
      typeName: note.typeName,
      filePath: note.filePath,
      tags: note.tags,
      fields: note.fields,
      body: note.body,
      updatedAt: note.updatedAt,
    };
  },
};

export const createNote: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "createNote",
      description:
        "Crée une nouvelle note dans le vault. typeId désigne le type (ex: 'note'). fields contient les champs structurés (titre, etc.). body est le markdown.",
      parameters: {
        type: "object",
        properties: {
          typeId: {
            type: "string",
            description: "Id du type (ex: 'note'). Utilise 'note' par défaut.",
          },
          fields: {
            type: "object",
            description:
              "Champs structurés (clé → valeur). Inclure au minimum un titre si le type en attend un.",
          },
          body: { type: "string", description: "Corps markdown" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags optionnels",
          },
        },
        required: ["typeId", "fields"],
      },
    },
  },
  async execute(args) {
    const typeId = String(args["typeId"] ?? "note");
    const fields = (args["fields"] && typeof args["fields"] === "object"
      ? (args["fields"] as Record<string, unknown>)
      : {}) as Record<string, string | number | boolean | null | string[]>;
    const input: {
      typeId: string;
      fields: Record<string, string | number | boolean | null | string[]>;
      body?: string;
      tags?: string[];
    } = { typeId, fields };
    if (typeof args["body"] === "string") input.body = args["body"];
    if (Array.isArray(args["tags"])) {
      input.tags = (args["tags"] as unknown[]).map((t) => String(t));
    }
    const created = await trpcVanillaClient.entities.create.mutate(input);
    return {
      id: created.id,
      filePath: created.filePath,
      typeName: created.typeName,
    };
  },
};

export const updateNote: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "updateNote",
      description:
        "Met à jour une note existante (corps, champs, tags). Fournir uniquement les champs à changer.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Id de la note" },
          body: { type: "string", description: "Nouveau corps markdown" },
          fields: {
            type: "object",
            description: "Champs à mettre à jour (clé → valeur)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Nouvelle liste de tags (remplace l'ancienne)",
          },
        },
        required: ["id"],
      },
    },
  },
  async execute(args) {
    const id = String(args["id"] ?? "");
    const input: {
      id: string;
      body?: string;
      fields?: Record<string, string | number | boolean | null | string[]>;
      tags?: string[];
    } = { id };
    if (typeof args["body"] === "string") input.body = args["body"];
    if (args["fields"] && typeof args["fields"] === "object") {
      input.fields = args["fields"] as Record<
        string,
        string | number | boolean | null | string[]
      >;
    }
    if (Array.isArray(args["tags"])) {
      input.tags = (args["tags"] as unknown[]).map((t) => String(t));
    }
    const updated = await trpcVanillaClient.entities.update.mutate(input);
    return {
      id: updated.id,
      filePath: updated.filePath,
      updatedAt: updated.updatedAt,
    };
  },
};

export const DEFAULT_TOOLS: AgentTool[] = [
  searchNotes,
  listNotes,
  getNote,
  createNote,
  updateNote,
];
