import { useState, useEffect, useCallback } from "react";
import { Button, Input } from "@heroui/react";
import { FilePlus, Database, ArrowLeft, MagnifyingGlass, PencilSimple } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useSettings } from "@/components/settings/SettingsContext";
import { AppShell, useMobileTitle, useMobileFab } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useGmailConnected } from "@/hooks/useGmailConnected";
import { EmailThreadView } from "@/components/mail/EmailThreadView";
import { MailOverlayList } from "@/components/mail/MailOverlayList";
import { MailGroupList } from "@/components/mail/MailGroupList";
import { useCaptureEmail } from "@/components/mail/useCaptureEmail";
import { CaptureEmailModal } from "@/components/mail/CaptureEmailModal";
import { ComposeModal } from "@/components/mail/ComposeModal";
import { listThreadSummaries, listLabels, getThread, type EmailThread } from "@/lib/gmail";
import { buildMailOverlay, type OverlayRow } from "@/lib/mail-overlay";
import { prefersReducedMotion } from "@/lib/motion";
import { useToast } from "@supernote/ui";

const DEFAULT_MAIL_QUERY = "in:inbox";

type GroupRow = Extract<OverlayRow, { kind: "group" }>;

export default function MailPage() {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  useMobileTitle(isMobile ? "Mail" : null);

  const clientId = settings.googleDrive.clientId.trim();
  const connected = useGmailConnected();

  const { captureToNote } = useCaptureEmail();
  const { toast } = useToast();

  const [query, setQuery] = useState(DEFAULT_MAIL_QUERY);
  const [rows, setRows] = useState<OverlayRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedGroup, setSelectedGroup] = useState<GroupRow | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const [captureOpen, setCaptureOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  // Action « créer » → FAB sur mobile (équivalent du bouton « Nouveau » desktop).
  useMobileFab(
    connected
      ? { icon: PencilSimple, label: "Nouveau message", onPress: () => setComposeOpen(true) }
      : null,
  );

  const loadList = useCallback(
    async (q: string) => {
      setListLoading(true);
      setListError(null);
      setSelectedGroup(null);
      setSelectedThreadId(null);
      setThread(null);
      try {
        const [items, labels] = await Promise.all([
          listThreadSummaries(clientId, q),
          listLabels(clientId).catch(() => [] as Awaited<ReturnType<typeof listLabels>>),
        ]);
        setRows(
          buildMailOverlay(items, new Map(labels.map((l) => [l.id, l.name])), settings.gmail.connectedEmail),
        );
      } catch (err) {
        setListError(err instanceof Error ? err.message : String(err));
      } finally {
        setListLoading(false);
      }
    },
    [clientId, settings.gmail.connectedEmail],
  );

  useEffect(() => {
    if (connected) void loadList(DEFAULT_MAIL_QUERY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const openThread = async (threadId: string) => {
    setThreadLoading(true);
    setThreadError(null);
    setSelectedThreadId(threadId);
    try {
      setThread(await getThread(clientId, threadId));
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : String(err));
    } finally {
      setThreadLoading(false);
    }
  };

  const onPick = (row: OverlayRow) => {
    if (row.kind === "single") {
      setSelectedGroup(null);
      void openThread(row.item.id);
    } else {
      setSelectedGroup(row);
      setSelectedThreadId(null);
      setThread(null);
    }
  };

  const handleCaptureNote = async () => {
    const msg = thread?.messages[0];
    if (!msg) return;
    try {
      const id = await captureToNote(msg);
      toast({ title: "Note créée depuis l'email", description: "Dans Inbox." });
      navigate(`/notes/${id}`);
    } catch (err) {
      toast({
        title: "Échec de la capture",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const activeKey = selectedGroup?.key ?? (selectedThreadId ? `t:${selectedThreadId}` : undefined);

  const searchBox = (
    <div className="flex gap-2 p-3">
      {!isMobile && (
        <Button variant="primary" onPress={() => setComposeOpen(true)}>
          <PencilSimple size={16} /> Nouveau
        </Button>
      )}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher…"
        className="flex-1"
        onKeyDown={(e) => {
          if (e.key === "Enter") void loadList(query);
        }}
      />
      <Button size="sm" variant="ghost" onPress={() => void loadList(query)} isIconOnly aria-label="Rechercher">
        <MagnifyingGlass size={16} />
      </Button>
    </div>
  );

  const pane1 = (
    <div className="flex h-full flex-col overflow-hidden" style={{ borderRight: "1px solid var(--border-subtle)" }}>
      {searchBox}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {listLoading && (
          <p className="px-3 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Chargement…
          </p>
        )}
        {listError && (
          <p className="px-3 py-2 text-sm" style={{ color: "var(--color-danger, #ef4444)" }}>
            {listError}
          </p>
        )}
        {!listLoading && !listError && (
          <MailOverlayList rows={rows} activeKey={activeKey} onPick={onPick} />
        )}
      </div>
    </div>
  );

  const pane2 = selectedGroup ? (
    <div className="flex h-full flex-col overflow-hidden" style={{ borderRight: "1px solid var(--border-subtle)" }}>
      <div className="flex-1 overflow-y-auto px-2 pb-4 pt-3">
        <MailGroupList
          title={selectedGroup.title}
          items={selectedGroup.items}
          activeThreadId={selectedThreadId ?? undefined}
          onPick={(id) => void openThread(id)}
        />
      </div>
    </div>
  ) : null;

  const captureBar = thread ? (
    <div className="flex shrink-0 gap-2 px-4 pb-2 pt-3">
      <Button variant="ghost" size="sm" onPress={() => void handleCaptureNote()}>
        <FilePlus size={16} /> Capturer en note
      </Button>
      <Button variant="ghost" size="sm" onPress={() => setCaptureOpen(true)} isDisabled={!thread?.messages[0]}>
        <Database size={16} /> Capturer dans une base
      </Button>
    </div>
  ) : null;

  const pane3 = (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {threadLoading && (
        <p className="px-4 py-4 text-sm" style={{ color: "var(--text-muted)" }}>
          Chargement…
        </p>
      )}
      {threadError && (
        <p className="px-4 py-4 text-sm" style={{ color: "var(--color-danger, #ef4444)" }}>
          {threadError}
        </p>
      )}
      {!threadLoading && !threadError && thread && (
        <div
          key={selectedThreadId ?? "thread"}
          className="sn-overlay-in flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {captureBar}
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <EmailThreadView thread={thread} selfEmail={settings.gmail.connectedEmail} />
          </div>
        </div>
      )}
      {!threadLoading && !threadError && !thread && (
        <p className="px-4 py-4 text-sm" style={{ color: "var(--text-muted)" }}>
          Sélectionne un email.
        </p>
      )}
    </div>
  );

  if (!connected) {
    return (
      <AppShell>
        <div className="px-4 py-10 md:px-10">
          <div className="mx-auto max-w-md text-center">
            <h1 className="mb-2 text-xl font-semibold">Mail</h1>
            <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
              Connecte un compte Gmail pour lire tes emails ici.
            </p>
            <Button onPress={() => navigate("/parametres")}>Connecter Gmail</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (isMobile) {
    // Mobile : afficher uniquement le volet le plus profond actif
    if (selectedThreadId !== null) {
      return (
        <AppShell>
          <div className="flex h-full flex-col overflow-hidden">
            <div className="shrink-0 px-3 pt-3">
              <Button
                variant="ghost"
                size="sm"
                onPress={() => {
                  setSelectedThreadId(null);
                  setThread(null);
                }}
              >
                <ArrowLeft size={16} /> Retour
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {pane3}
            </div>
          </div>
          <CaptureEmailModal
            isOpen={captureOpen}
            message={thread?.messages[0] ?? null}
            onClose={() => setCaptureOpen(false)}
          />
          <ComposeModal isOpen={composeOpen} onClose={() => setComposeOpen(false)} />
        </AppShell>
      );
    }

    if (selectedGroup !== null) {
      return (
        <AppShell>
          <div className="flex h-full flex-col overflow-hidden">
            <div className="shrink-0 px-3 pt-3">
              <Button
                variant="ghost"
                size="sm"
                onPress={() => setSelectedGroup(null)}
              >
                <ArrowLeft size={16} /> Retour
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-4">
              <MailGroupList
                title={selectedGroup.title}
                items={selectedGroup.items}
                activeThreadId={selectedThreadId ?? undefined}
                onPick={(id) => void openThread(id)}
              />
            </div>
          </div>
          <CaptureEmailModal
            isOpen={captureOpen}
            message={thread?.messages[0] ?? null}
            onClose={() => setCaptureOpen(false)}
          />
          <ComposeModal isOpen={composeOpen} onClose={() => setComposeOpen(false)} />
        </AppShell>
      );
    }

    return (
      <AppShell>
        <div className="flex h-full flex-col overflow-hidden">
          {pane1}
        </div>
        <CaptureEmailModal
          isOpen={captureOpen}
          message={thread?.messages[0] ?? null}
          onClose={() => setCaptureOpen(false)}
        />
      </AppShell>
    );
  }

  // Desktop : colonnes glissantes animées.
  //   list         → liste 50 % | (thread 50 % vide : placeholder)
  //   single       → liste 50 % | thread 50 %
  //   group        → liste 50 % | groupe 50 %
  //   group-thread → liste ~280px + groupe ~320px POUSSÉS à gauche | thread (reste)
  // La « poussée » émerge du reflow flex : on anime le flex-basis de chaque
  // colonne avec l'easing « liquid » de grands déplacements de layout.
  const view: "list" | "single" | "group" | "group-thread" =
    selectedGroup && selectedThreadId
      ? "group-thread"
      : selectedGroup
        ? "group"
        : selectedThreadId
          ? "single"
          : "list";

  const basisTransition = `flex-basis ${prefersReducedMotion() ? "0ms" : "var(--sn-dur-4)"} var(--sn-ease-out)`;
  const listBasis = view === "group-thread" ? "17.5rem" : "50%";
  const groupBasis = view === "group" ? "50%" : view === "group-thread" ? "20rem" : "0px";

  return (
    <AppShell>
      <div className="flex h-full overflow-hidden">
        <div
          className="h-full shrink-0 overflow-hidden"
          style={{ flexGrow: 0, flexShrink: 0, flexBasis: listBasis, transition: basisTransition }}
        >
          {pane1}
        </div>
        <div
          className="h-full shrink-0 overflow-hidden"
          style={{ flexGrow: 0, flexShrink: 0, flexBasis: groupBasis, transition: basisTransition }}
          aria-hidden={!selectedGroup}
        >
          {pane2}
        </div>
        <div className="h-full min-w-0 flex-1 overflow-hidden">{pane3}</div>
      </div>
      <CaptureEmailModal
        isOpen={captureOpen}
        message={thread?.messages[0] ?? null}
        onClose={() => setCaptureOpen(false)}
      />
      <ComposeModal isOpen={composeOpen} onClose={() => setComposeOpen(false)} />
    </AppShell>
  );
}
