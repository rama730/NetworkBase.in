import "server-only";

const EXTENSION_URI_AUTHORITY = "nb-workspace.nb-vscode-sync";
const AUTH_CALLBACK_PATH = "/auth-callback";
const REVOKED_CALLBACK_PATH = "/session-revoked";

function callbackUriForScheme(scheme: string) {
  return `${scheme}://${EXTENSION_URI_AUTHORITY}${AUTH_CALLBACK_PATH}`;
}

/** Accept only this extension's URI handler or a local CLI loopback callback, and discard untrusted URL parts. */
export function normalizeExtensionCallbackUri(value: string | null | undefined) {
  if (!value) return null;

  try {
    const uri = new URL(value);
    const isLoopbackCliCallback =
      uri.protocol === "http:" &&
      (uri.hostname === "127.0.0.1" || uri.hostname === "localhost") &&
      Boolean(uri.port) &&
      uri.pathname === AUTH_CALLBACK_PATH;

    const isIdeSchemeCallback =
      Boolean(uri.protocol) &&
      uri.protocol !== "http:" &&
      uri.protocol !== "https:" &&
      uri.hostname === EXTENSION_URI_AUTHORITY &&
      uri.pathname === AUTH_CALLBACK_PATH;

    if (!isLoopbackCliCallback && !isIdeSchemeCallback) {
      return null;
    }
    uri.search = "";
    uri.hash = "";
    return uri.toString();
  } catch {
    return null;
  }
}

export function buildExtensionRevocationUri(
  callbackUri: string | null | undefined,
  sessionId: string,
) {
  const normalized = normalizeExtensionCallbackUri(callbackUri);
  if (!normalized) return null;

  const uri = new URL(normalized);
  if (uri.protocol === "http:" || uri.protocol === "https:") {
    return null;
  }
  uri.pathname = REVOKED_CALLBACK_PATH;
  uri.searchParams.set("sessionId", sessionId);
  return uri.toString();
}

/** Supports sessions issued before callback_uri was introduced. */
export function inferExtensionCallbackUri(
  editorHost: string | null | undefined,
  editorName: string | null | undefined,
) {
  switch ((editorHost || "").toLowerCase()) {
    case "vscode":
    case "vscode-insiders":
    case "cursor":
    case "windsurf":
    case "vscodium":
    case "trae":
    case "zed":
    case "antigravity":
      return callbackUriForScheme((editorHost || "").toLowerCase());
    default: {
      const name = (editorName || "").toLowerCase();
      if (name.includes("antigravity")) return callbackUriForScheme("antigravity");
      if (name.includes("cursor")) return callbackUriForScheme("cursor");
      if (name.includes("windsurf")) return callbackUriForScheme("windsurf");
      if (name.includes("vscodium") || name.includes("codium")) return callbackUriForScheme("vscodium");
      if (name.includes("trae")) return callbackUriForScheme("trae");
      if (name.includes("zed")) return callbackUriForScheme("zed");
      if (name.includes("visual studio code") || name.includes("vscode")) return callbackUriForScheme("vscode");
      return null;
    }
  }
}
