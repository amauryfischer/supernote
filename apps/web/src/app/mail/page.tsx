import { useState } from "react";
import { Button } from "@heroui/react";
import { FilePlus } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useSettings } from "@/components/settings/SettingsContext";
import { useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useGmailConnected } from "@/hooks/useGmailConnected";
import { EmailPicker } from "@/components/mail/EmailPicker";
import { EmailThreadView } from "@/components/mail/EmailThreadView";
import { useCaptureEmail } from "@/components/mail/useCaptureEmail";
import { getThread, type EmailThread } from "@/lib/gmail";
import { useToast } from "@supernote/ui";

export default function MailPage() {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  useMobileTitle(isMobile ? "Mail" : null);

  const clientId = settings.googleDrive.clientId.trim();
  const connected = useGmailConnected();

  const { captureToNote } = useCaptureEmail();
  const { toast } = useToast();

  const [thread, setThread] = useState<EmailThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const openThread = async (threadId: string) => {
    setLoading(true);
    setError(null);
    try {
      setThread(await getThread(clientId, threadId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!connected) {
    return (
      <div className="px-4 py-10 md:px-10">
        <div className="mx-auto max-w-md text-center">
          <h1 className="mb-2 text-xl font-semibold">Mail</h1>
          <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
            Connecte un compte Gmail pour lire tes emails ici.
          </p>
          <Button onPress={() => navigate("/parametres")}>Connecter Gmail</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 px-4 py-6 md:flex-row md:px-10">
      <div className="w-full md:w-96 md:flex-shrink-0">
        <h1 className="mb-4 hidden text-xl font-semibold md:block">Mail</h1>
        <EmailPicker onSelect={openThread} />
      </div>
      <div className="min-w-0 flex-1">
        {loading && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Chargement…
          </p>
        )}
        {error && (
          <p className="text-sm" style={{ color: "var(--color-danger, #ef4444)" }}>
            {error}
          </p>
        )}
        {!loading && !error && thread && (
          <>
            <div className="mb-3 flex gap-2">
              <Button variant="ghost" size="sm" onPress={() => void handleCaptureNote()}>
                <FilePlus size={16} /> Capturer en note
              </Button>
            </div>
            <EmailThreadView thread={thread} />
          </>
        )}
        {!loading && !error && !thread && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Sélectionne un email.
          </p>
        )}
      </div>
    </div>
  );
}
