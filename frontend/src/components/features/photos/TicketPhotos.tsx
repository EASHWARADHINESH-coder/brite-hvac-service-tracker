import { useEffect, useRef, useState } from "react";

import { Button, Card, Modal } from "../../ui/primitives";
import { useToast } from "../../ui/Toast";
import {
  deleteTicketPhoto,
  listTicketPhotos,
  fetchTicketPhotoUrl,
  uploadTicketPhoto,
} from "../../../api/services";
import { useAuth } from "../../../context/AuthContext";
import type { TicketPhoto } from "../../../types";

const MAX_EDGE = 1600;   // long edge after downscaling
const JPEG_QUALITY = 0.82;

/**
 * Downscale in the browser before upload.
 *
 * A modern phone photo is 3–8 MB; at 1600px/82% it lands around 300–600 KB with no visible
 * loss for site evidence. Doing it here means no image library on the server and far less
 * data over a site's mobile connection.
 */
async function downscale(file: File): Promise<{ blob: Blob; name: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  // Already small enough — send as-is rather than re-encoding (and losing quality twice).
  if (scale === 1 && file.size < 1_000_000) return { blob: file, name: file.name };

  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) return { blob: file, name: file.name };
  return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
}

const KINDS = ["before", "after", "other"] as const;

/**
 * Authenticated <img>. The file endpoint needs a bearer token, which a plain src cannot
 * send, so the bytes are fetched and shown as a blob URL — revoked on unmount.
 */
function AuthImage({
  ticketId, photoId, alt, className,
}: { ticketId: number; photoId: number; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let made: string | null = null;
    fetchTicketPhotoUrl(ticketId, photoId)
      .then((u) => {
        made = u;
        if (revoked) URL.revokeObjectURL(u);
        else setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => { revoked = true; if (made) URL.revokeObjectURL(made); };
  }, [ticketId, photoId]);

  if (!url) return <div className={`animate-pulse bg-slate-200 ${className ?? ""}`} />;
  // No loading="lazy": Chrome skips lazy loading for blob: URLs, and the bytes are already
  // fetched on demand by the effect above, so the attribute would only break rendering.
  return <img src={url} alt={alt} className={className} />;
}

export default function TicketPhotos({ ticketId }: { ticketId: number }) {
  const { canEditTasks, isAdmin } = useAuth();
  const toast = useToast();
  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<TicketPhoto | null>(null);
  const pending = useRef<(typeof KINDS)[number]>("other");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = () => listTicketPhotos(ticketId).then(setPhotos).catch(() => setPhotos([]));
  useEffect(() => { load(); }, [ticketId]);

  const pick = (kind: (typeof KINDS)[number]) => {
    pending.current = kind;
    inputRef.current?.click();
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        const { blob, name } = await downscale(file);
        await uploadTicketPhoto(ticketId, blob, pending.current, undefined, name);
        ok += 1;
      } catch (err) {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        toast.error(`Couldn't upload ${file.name}`, detail);
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (ok) toast.success(`${ok} photo${ok === 1 ? "" : "s"} added`);
    load();
  };

  const remove = async (p: TicketPhoto) => {
    try {
      await deleteTicketPhoto(ticketId, p.id);
      toast.success("Photo deleted");
      setViewing(null);
      load();
    } catch {
      toast.error("Couldn't delete the photo");
    }
  };

  const group = (kind: string) => photos.filter((p) => p.kind === kind);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-700">
          Site photos <span className="text-slate-400">({photos.length})</span>
        </h2>
        {canEditTasks && (
          <div className="flex gap-2">
            {KINDS.map((k) => (
              <Button key={k} variant="ghost" onClick={() => pick(k)} disabled={busy}>
                {busy ? "…" : `＋ ${k}`}
              </Button>
            ))}
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />

      {photos.length === 0 ? (
        <p className="text-sm text-slate-400">
          {canEditTasks
            ? "No photos yet. Add before/after shots as evidence for AMC and BSL claims."
            : "No photos yet."}
        </p>
      ) : (
        <div className="space-y-4">
          {KINDS.filter((k) => group(k).length > 0).map((k) => (
            <div key={k}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {k}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {group(k).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setViewing(p)}
                    className="group relative overflow-hidden rounded-md border border-slate-200"
                    title={`${p.original_name} · ${p.uploaded_by_name ?? ""}`}
                  >
                    <AuthImage
                      ticketId={ticketId}
                      photoId={p.id}
                      alt={p.caption ?? `${k} photo`}
                      className="aspect-[4/3] w-full object-cover transition group-hover:opacity-90"
                    />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!viewing} title={viewing?.original_name ?? ""} onClose={() => setViewing(null)}>
        {viewing && (
          <div className="space-y-3">
            <AuthImage
              ticketId={ticketId}
              photoId={viewing.id}
              alt={viewing.caption ?? viewing.original_name}
              className="max-h-[60vh] w-full rounded object-contain"
            />
            <div className="text-xs text-slate-500">
              {viewing.kind} · {(viewing.size / 1024).toFixed(0)} KB
              {viewing.uploaded_by_name && ` · ${viewing.uploaded_by_name}`}
            </div>
            {isAdmin && (
              <Button variant="ghost" onClick={() => remove(viewing)}>Delete photo</Button>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}
