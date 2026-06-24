import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { buildGmailThreadUrl } from "./gmailEmbedUrl.js";

// ─── Provider (renderer délégué + picker hôte) ────────────────────────────────

export interface GmailEmbedRenderProps {
  threadId: string;
  url: string;
  onClear: () => void;
}

export interface GmailEmbedApi {
  /** Rendu lecture seule du thread (fourni par l'app : fetch + EmailThreadView). */
  render: (props: GmailEmbedRenderProps) => React.ReactNode;
  /** Ouvre le picker d'email (modal hôte). Résout le threadId choisi, ou null si annulé. */
  pickEmail: () => Promise<string | null>;
}

const GmailEmbedContext = React.createContext<GmailEmbedApi | null>(null);

export function GmailEmbedProvider({
  api,
  children,
}: {
  api: GmailEmbedApi | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return <GmailEmbedContext.Provider value={api}>{children}</GmailEmbedContext.Provider>;
}

export function useGmailEmbed(): GmailEmbedApi | null {
  return React.useContext(GmailEmbedContext);
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function EmptyState({
  api,
  onPicked,
}: {
  api: GmailEmbedApi | null;
  onPicked: (threadId: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  if (!api) {
    return (
      <div className="sn-gmail-empty" style={{ padding: 16, fontSize: 13, color: "var(--text-muted)" }}>
        Connectez Gmail pour insérer un email.
      </div>
    );
  }
  const pick = async () => {
    setBusy(true);
    try {
      const id = await api.pickEmail();
      if (id) onPicked(id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sn-gmail-empty" style={{ padding: 16 }}>
      <button
        type="button"
        onClick={() => void pick()}
        disabled={busy}
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          border: "1px solid var(--border-subtle)",
          background: "var(--surface-2)",
          color: "var(--text-primary)",
          fontSize: 13,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "…" : "✉️ Choisir un email"}
      </button>
    </div>
  );
}

function FallbackCard({ url, onClear }: { url: string; onClear: () => void }) {
  return (
    <div
      className="sn-gmail-card"
      style={{
        padding: 14,
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        background: "var(--surface-1)",
        fontSize: 13,
      }}
    >
      <span style={{ color: "var(--text-secondary)" }}>Email Gmail</span>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 12, color: "var(--accent)", textDecoration: "none" }}
        >
          Ouvrir dans Gmail ↗
        </a>
      )}
      <button
        type="button"
        onClick={onClear}
        style={{ marginLeft: 12, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
      >
        changer
      </button>
    </div>
  );
}

// ─── Block spec ───────────────────────────────────────────────────────────────

export const gmailMessageBlockSpec = createReactBlockSpec(
  {
    type: "gmailMessage" as const,
    propSchema: {
      threadId: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const threadId = (block.props.threadId ?? "") as string;
      const api = useGmailEmbed();
      const url = buildGmailThreadUrl(threadId);

      const setThreadId = (next: string) => {
        editor.updateBlock(block, { props: { threadId: next } } as never);
      };
      const clear = () => setThreadId("");

      let body: React.ReactNode;
      if (!threadId) {
        body = <EmptyState api={api} onPicked={setThreadId} />;
      } else if (api) {
        body = api.render({ threadId, url, onClear: clear });
      } else {
        body = <FallbackCard url={url} onClear={clear} />;
      }

      return (
        <div className="sn-gmail" contentEditable={false}>
          {body}
        </div>
      );
    },
  },
);
