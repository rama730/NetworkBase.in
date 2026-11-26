// What can be sent in Messages: the upload check (presign) and the chat-attachments bucket (0153) use this one list,
// so a file is either refused up front with a clear message or stored, never refused halfway by storage. Files are
// served from storage's own domain through short-lived links; anything that could run in a page stays out.
export const CHAT_FILE_TYPES = [
  // Images, video, voice
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif", "image/avif",
  "video/mp4", "video/quicktime", "video/webm",
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/webm", "audio/wav", "audio/x-wav", "audio/flac",
  // Documents
  "application/pdf", "text/plain", "text/markdown", "text/x-markdown", "text/csv", "application/csv", "text/x-csv",
  "application/rtf", "text/rtf", "application/json",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet", "application/vnd.oasis.opendocument.presentation",
  // Archives
  "application/zip", "application/x-zip-compressed", "application/gzip", "application/x-gzip", "application/x-tar",
  "application/x-7z-compressed", "application/vnd.rar", "application/x-rar-compressed",
] as const;

const ALLOWED = new Set<string>(CHAT_FILE_TYPES);

export function chatFileTypeAllowed(mimeType: string) {
  return ALLOWED.has(mimeType.trim().toLowerCase());
}
