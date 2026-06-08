"use client";

/**
 * NoteCover — couverture par note (façon Notion/Coda).
 *
 * Une couverture = un fond appliqué EN ARRIÈRE-PLAN du bloc titre de la note
 * (breadcrumb + titre posés par-dessus, cf. `CoverBackdrop`). Deux formes :
 *  - un preset (gradient ou couleur unie, identifié par son `id`) ;
 *  - une URL d'image (photo Unsplash, cf. `lib/unsplash.ts`).
 * Persistée dans `fields.cover` de la note. Voir aussi NoteIcon (icône) et
 * AmbianceSelector (ambiance) qui partagent le même bag `fields`.
 */

import { useEffect, useRef, useState } from "react";
import { Button, Input, Spinner } from "@heroui/react";
import {
  Check,
  Image as ImageIcon,
  MagnifyingGlass,
  Trash,
} from "@phosphor-icons/react";
import {
  hasUnsplashKey,
  searchUnsplash,
  triggerUnsplashDownload,
  type UnsplashPhoto,
} from "@/lib/unsplash";

interface CoverPreset {
  id: string;
  label: string;
  bg: string;
}

/** Galerie de couvertures — gradients puis couleurs unies. */
export const COVER_PRESETS: CoverPreset[] = [
  { id: "peach", label: "Pêche", bg: "linear-gradient(135deg,#ffd1a4 0%,#ff8c69 100%)" },
  { id: "sunset", label: "Coucher de soleil", bg: "linear-gradient(135deg,#ff9a9e 0%,#fad0c4 100%)" },
  { id: "lagoon", label: "Lagon", bg: "linear-gradient(135deg,#43cea2 0%,#185a9d 100%)" },
  { id: "violet", label: "Violet", bg: "linear-gradient(135deg,#a18cd1 0%,#fbc2eb 100%)" },
  { id: "ocean", label: "Océan", bg: "linear-gradient(135deg,#2193b0 0%,#6dd5ed 100%)" },
  { id: "ember", label: "Braise", bg: "linear-gradient(135deg,#f12711 0%,#f5af19 100%)" },
  { id: "forest", label: "Forêt", bg: "linear-gradient(135deg,#134e5e 0%,#71b280 100%)" },
  { id: "grape", label: "Raisin", bg: "linear-gradient(135deg,#6a3093 0%,#a044ff 100%)" },
  { id: "slate", label: "Ardoise", bg: "linear-gradient(135deg,#3a3f44 0%,#1f2326 100%)" },
  { id: "sand", label: "Sable", bg: "linear-gradient(135deg,#e6cfa4 0%,#cbb085 100%)" },
  { id: "rose", label: "Rose", bg: "#e8a0bf" },
  { id: "sky", label: "Ciel", bg: "#8ecae6" },
  { id: "mint", label: "Menthe", bg: "#a7d7c5" },
  { id: "graphite", label: "Graphite", bg: "#4b4f55" },
];

/** Vrai si la valeur de couverture est une URL d'image (vs. un preset). */
export function isImageCover(id: string | null): boolean {
  return typeof id === "string" && /^https?:\/\//.test(id);
}

/** Normalise une valeur brute issue de `fields.cover` (preset id OU URL image). */
export function asCover(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  if (COVER_PRESETS.some((p) => p.id === v)) return v;
  if (isImageCover(v)) return v;
  return null;
}

/** CSS `background` d'une couverture, ou undefined si inconnue. */
export function coverBackground(id: string | null): string | undefined {
  if (!id) return undefined;
  if (isImageCover(id)) return `center / cover no-repeat url("${id}")`;
  return COVER_PRESETS.find((p) => p.id === id)?.bg;
}

/** Galerie en popover — partagée par la couverture et le bouton « Couverture ». */
function CoverGallery({
  value,
  onPick,
  onClose,
  anchor,
}: {
  value: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  anchor: "left" | "right";
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [photos, setPhotos] = useState<UnsplashPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const hasKey = hasUnsplashKey();

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Recherche Unsplash — debouncée et abortable. Requête vide → curated random.
  useEffect(() => {
    if (!hasKey) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    const t = setTimeout(
      () => {
        searchUnsplash(query, ctrl.signal)
          .then((res) => {
            if (!ctrl.signal.aborted) setPhotos(res);
          })
          .catch(() => {
            if (!ctrl.signal.aborted) setError(true);
          })
          .finally(() => {
            if (!ctrl.signal.aborted) setLoading(false);
          });
      },
      query ? 350 : 0,
    );
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query, hasKey]);

  const pickImage = (photo: UnsplashPhoto): void => {
    triggerUnsplashDownload(photo);
    onPick(photo.coverUrl);
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="Choisir une couverture"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        [anchor]: 0,
        zIndex: 50,
        width: "min(360px, calc(100vw - 32px))",
        maxHeight: "min(70vh, 460px)",
        overflowY: "auto",
        padding: 10,
        borderRadius: 10,
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
      }}
    >
      <p
        className="mb-1.5 text-[11px] font-medium uppercase tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        Couleurs
      </p>
      <div className="grid grid-cols-3 gap-2">
        {COVER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            aria-label={p.label}
            className="relative h-12 overflow-hidden rounded-md outline-none ring-offset-1 transition hover:opacity-90 focus-visible:ring-2"
            style={{ background: p.bg, border: "1px solid var(--border-subtle)" }}
          >
            {p.id === value && (
              <span
                className="absolute inset-0 flex items-center justify-center"
                style={{ backgroundColor: "rgba(0,0,0,0.25)" }}
              >
                <Check size={16} color="#fff" weight="bold" />
              </span>
            )}
          </button>
        ))}
      </div>

      <p
        className="mb-1.5 mt-3 text-[11px] font-medium uppercase tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        Unsplash
      </p>
      {hasKey ? (
        <>
          <div
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5"
            style={{
              backgroundColor: "var(--surface-0)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <MagnifyingGlass
              size={14}
              style={{ color: "var(--text-muted)", flexShrink: 0 }}
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher des photos…"
              aria-label="Rechercher des photos Unsplash"
              className="w-full bg-transparent text-sm outline-none"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
          {loading && (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          )}
          {error && !loading && (
            <p className="py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              Recherche indisponible.
            </p>
          )}
          {!loading && !error && photos.length > 0 && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {photos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => pickImage(photo)}
                  title={`Photo : ${photo.authorName} (Unsplash)`}
                  aria-label={`Couverture : ${photo.alt}`}
                  className="relative h-12 overflow-hidden rounded-md outline-none ring-offset-1 transition hover:opacity-90 focus-visible:ring-2"
                  style={{ border: "1px solid var(--border-subtle)" }}
                >
                  <img
                    src={photo.thumbUrl}
                    alt={photo.alt}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  {value === photo.coverUrl && (
                    <span
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ backgroundColor: "rgba(0,0,0,0.25)" }}
                    >
                      <Check size={16} color="#fff" weight="bold" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Définissez <code>VITE_UNSPLASH_ACCESS_KEY</code> pour activer la recherche
          de photos.
        </p>
      )}
    </div>
  );
}

/**
 * Arrière-plan de couverture — à rendre comme fond du bloc titre (le parent
 * doit être `position: relative`). Rend le fond (gradient/couleur ou image) +
 * un scrim pour la lisibilité du texte clair + les contrôles (changer /
 * supprimer), en survol sur desktop, toujours visibles sur mobile.
 *
 * Rend `null` si aucune couverture.
 */
export function CoverBackdrop({
  coverId,
  onChange,
}: {
  coverId: string | null;
  onChange: (id: string | null) => void;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!coverId) return null;
  const bg = coverBackground(coverId) ?? COVER_PRESETS[0]!.bg;
  const image = isImageCover(coverId);

  return (
    <>
      <div aria-hidden className="absolute inset-0" style={{ background: bg }} />
      {/* Scrim : assombrit le bas (où vit le titre) pour garder le texte lisible.
          Plus marqué sur photo que sur gradient. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: image
            ? "linear-gradient(to bottom, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.6) 100%)"
            : "linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(0,0,0,0.22) 100%)",
        }}
      />
      <div className="absolute right-2 top-2 z-20 flex gap-1.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <div style={{ position: "relative" }}>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setOpen((o) => !o)}
            className="h-7 min-w-0 gap-1 px-2 text-xs"
            style={{ backgroundColor: "rgba(255,255,255,0.88)", color: "#1f2326" }}
          >
            <ImageIcon size={13} />
            Changer
          </Button>
          {open && (
            <CoverGallery
              value={coverId}
              anchor="right"
              onPick={(id) => {
                onChange(id);
                setOpen(false);
              }}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => onChange(null)}
          aria-label="Supprimer la couverture"
          className="h-7 min-w-0 gap-1 px-2 text-xs"
          style={{ backgroundColor: "rgba(255,255,255,0.88)", color: "#1f2326" }}
        >
          <Trash size={13} />
        </Button>
      </div>
    </>
  );
}

/** Bouton de la barre d'en-tête pour ajouter une couverture (aucune posée). */
export function CoverButton({
  onChange,
}: {
  onChange: (id: string | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => setOpen((o) => !o)}
        aria-label="Ajouter une couverture"
        className="h-7 min-w-0 gap-1 px-2 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        <ImageIcon size={14} />
        Couverture
      </Button>
      {open && (
        <CoverGallery
          value={null}
          anchor="left"
          onPick={(id) => {
            onChange(id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
