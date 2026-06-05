/** Pick a file extension from a MediaRecorder mime type. */
export function recordingExtension(mimeType: string): string {
  const m = (mimeType || "").toLowerCase();
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime")) return "mov";
  if (m.includes("webm")) return "webm";
  return "webm";
}

/** Build a download/share filename for a recording of the given mime type. */
export function recordingFileName(mimeType: string): string {
  return `teleprompter.${recordingExtension(mimeType)}`;
}

/**
 * Save a recorded video blob. On iOS/Android Safari this opens the native share
 * sheet ("Salvar Vídeo" → Fotos / "Salvar em Arquivos"), which is the only
 * reliable way to get a media file out of a web app on iOS. Falls back to a
 * regular download link on desktop/Android where file-sharing isn't available.
 */
export async function saveRecording(blob: Blob): Promise<"shared" | "downloaded" | "cancelled"> {
  const filename = recordingFileName(blob.type);
  const file = new File([blob], filename, { type: blob.type || "video/mp4" });

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (err) {
      // User dismissed the share sheet — not an error, just stop.
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Anything else: fall through to the download fallback.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
