// Android-style intent & protocol dispatcher for NetworkBase for VS Code.
// Governed by Ponytail: native platform APIs, 0 dependencies, 0ms server overhead.

export type SupportedIde =
  | "cursor"
  | "vscode"
  | "antigravity"
  | "windsurf"
  | "vscode-insiders"
  | "vscodium"
  | "trae"
  | "zed"
  | "intellij-idea"
  | "pycharm"
  | "webstorm"
  | "android-studio"
  | "clion"
  | "goland"
  | "rustrover"
  | "rider"
  | "phpstorm"
  | "fleet"
  | "datagrip"
  | "rubymine";

export interface IdeDefinition {
  id: SupportedIde;
  name: string;
  scheme: string;
  icon: string;
  description: string;
  category?: "ai" | "vscode" | "jetbrains" | "native";
}

export const SUPPORTED_IDES: Record<SupportedIde, IdeDefinition> = {
  cursor: {
    id: "cursor",
    name: "Cursor",
    scheme: "cursor",
    icon: "/ide-icons/cursor.png",
    description: "AI-first code editor",
    category: "ai",
  },
  vscode: {
    id: "vscode",
    name: "VS Code",
    scheme: "vscode",
    icon: "/ide-icons/vscode.png",
    description: "Visual Studio Code",
    category: "vscode",
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    scheme: "antigravity",
    icon: "/ide-icons/antigravity.png",
    description: "Google Antigravity Editor",
    category: "ai",
  },
  windsurf: {
    id: "windsurf",
    name: "Windsurf",
    scheme: "windsurf",
    icon: "/ide-icons/windsurf.svg",
    description: "Codeium Windsurf IDE",
    category: "ai",
  },
  trae: {
    id: "trae",
    name: "Trae",
    scheme: "trae",
    icon: "/ide-icons/trae.png",
    description: "Adaptive AI IDE",
    category: "ai",
  },
  zed: {
    id: "zed",
    name: "Zed",
    scheme: "zed",
    icon: "/ide-icons/zed.png",
    description: "High-performance code editor",
    category: "native",
  },
  "vscode-insiders": {
    id: "vscode-insiders",
    name: "VS Code Insiders",
    scheme: "vscode-insiders",
    icon: "/ide-icons/vscode.png",
    description: "Early-build Visual Studio Code",
    category: "vscode",
  },
  vscodium: {
    id: "vscodium",
    name: "VSCodium",
    scheme: "vscodium",
    icon: "/ide-icons/vscodium.png",
    description: "Open-source VS Code binaries",
    category: "vscode",
  },
  "intellij-idea": {
    id: "intellij-idea",
    name: "IntelliJ IDEA",
    scheme: "idea",
    icon: "/ide-icons/intellij-idea.svg",
    description: "JetBrains Java and Kotlin IDE",
    category: "jetbrains",
  },
  pycharm: {
    id: "pycharm",
    name: "PyCharm",
    scheme: "pycharm",
    icon: "/ide-icons/pycharm.svg",
    description: "JetBrains Python IDE",
    category: "jetbrains",
  },
  webstorm: {
    id: "webstorm",
    name: "WebStorm",
    scheme: "webstorm",
    icon: "/ide-icons/webstorm.svg",
    description: "JetBrains JavaScript and TypeScript IDE",
    category: "jetbrains",
  },
  "android-studio": {
    id: "android-studio",
    name: "Android Studio",
    scheme: "androidstudio",
    icon: "/ide-icons/intellij-idea.svg",
    description: "Google Android IDE",
    category: "jetbrains",
  },
  clion: {
    id: "clion",
    name: "CLion",
    scheme: "clion",
    icon: "/ide-icons/clion.svg",
    description: "JetBrains C and C++ IDE",
    category: "jetbrains",
  },
  goland: {
    id: "goland",
    name: "GoLand",
    scheme: "goland",
    icon: "/ide-icons/goland.svg",
    description: "JetBrains Go IDE",
    category: "jetbrains",
  },
  rustrover: {
    id: "rustrover",
    name: "RustRover",
    scheme: "rustrover",
    icon: "/ide-icons/rustrover.svg",
    description: "JetBrains Rust IDE",
    category: "jetbrains",
  },
  rider: {
    id: "rider",
    name: "Rider",
    scheme: "rider",
    icon: "/ide-icons/rider.svg",
    description: "JetBrains .NET IDE",
    category: "jetbrains",
  },
  phpstorm: {
    id: "phpstorm",
    name: "PhpStorm",
    scheme: "phpstorm",
    icon: "/ide-icons/phpstorm.svg",
    description: "JetBrains PHP IDE",
    category: "jetbrains",
  },
  fleet: {
    id: "fleet",
    name: "Fleet",
    scheme: "fleet",
    icon: "/ide-icons/fleet.svg",
    description: "JetBrains Next-gen IDE",
    category: "jetbrains",
  },
  datagrip: {
    id: "datagrip",
    name: "DataGrip",
    scheme: "datagrip",
    icon: "/ide-icons/datagrip.svg",
    description: "JetBrains Database IDE",
    category: "jetbrains",
  },
  rubymine: {
    id: "rubymine",
    name: "RubyMine",
    scheme: "rubymine",
    icon: "/ide-icons/rubymine.svg",
    description: "JetBrains Ruby and Rails IDE",
    category: "jetbrains",
  },
};

export const EXTENSION_URI_AUTHORITY = "nb-workspace.nb-vscode-sync";
export const IDE_PREFERENCE_STORAGE_KEY = "nb:preferred-ide";

export interface BuildIdeLaunchUriParams {
  ide?: SupportedIde | string;
  projectId: string;
  projectSlug?: string;
  fileId?: string | null;
  filePath?: string | null;
  taskId?: string | null;
}

/**
 * Builds an Android-style deep link URI to launch the desktop IDE and mount
 * the remote project workspace directly into the extension.
 */
export function buildIdeLaunchUri({
  ide = "cursor",
  projectId,
  projectSlug,
  fileId,
  filePath,
  taskId,
}: BuildIdeLaunchUriParams): string {
  const scheme = (
    ide in SUPPORTED_IDES ? SUPPORTED_IDES[ide as SupportedIde].scheme : ide
  ).toLowerCase();

  const params = new URLSearchParams();
  params.set("projectId", projectId);

  if (projectSlug) {
    params.set("slug", projectSlug);
  }
  if (fileId) {
    params.set("fileId", fileId);
  }
  if (filePath) {
    params.set("filePath", filePath);
  }
  if (taskId) {
    params.set("taskId", taskId);
  }

  return `${scheme}://${EXTENSION_URI_AUTHORITY}/open?${params.toString()}`;
}

/**
 * Builds the native in-editor marketplace URI to open the extension installer
 * directly inside the user's desktop IDE.
 */
export function buildIdeMarketplaceUri(ide: SupportedIde | string = "cursor"): string {
  const scheme = (
    ide in SUPPORTED_IDES ? SUPPORTED_IDES[ide as SupportedIde].scheme : ide
  ).toLowerCase();
  return `${scheme}:extension/${EXTENSION_URI_AUTHORITY}`;
}

/**
 * Resolves an active session to a supported IDE definition.
 */
export function resolveIdeFromSession(session: {
  editorName?: string | null;
  editorPlatform?: string | null;
}): SupportedIde {
  const name = (session.editorName || "").toLowerCase();
  if (name.includes("cursor")) return "cursor";
  if (name.includes("windsurf")) return "windsurf";
  if (name.includes("antigravity")) return "antigravity";
  if (name.includes("codium")) return "vscodium";
  if (name.includes("insiders")) return "vscode-insiders";
  if (name.includes("trae")) return "trae";
  if (name.includes("zed")) return "zed";
  if (name.includes("intellij") || name.includes("idea")) return "intellij-idea";
  if (name.includes("pycharm")) return "pycharm";
  if (name.includes("webstorm")) return "webstorm";
  if (name.includes("android")) return "android-studio";
  if (name.includes("clion")) return "clion";
  if (name.includes("goland")) return "goland";
  if (name.includes("rustrover")) return "rustrover";
  if (name.includes("rider")) return "rider";
  if (name.includes("phpstorm")) return "phpstorm";
  if (name.includes("fleet")) return "fleet";
  if (name.includes("datagrip")) return "datagrip";
  if (name.includes("rubymine")) return "rubymine";
  if (name.includes("code") || name.includes("vscode")) return "vscode";
  return "vscode";
}

/**
 * Reads user's preferred IDE from localStorage or defaults to 'cursor'.
 */
export function getPreferredIde(): SupportedIde {
  if (typeof window === "undefined") return "cursor";
  try {
    const saved = window.localStorage.getItem(IDE_PREFERENCE_STORAGE_KEY);
    if (saved && saved in SUPPORTED_IDES) {
      return saved as SupportedIde;
    }
  } catch {
    // ponytail: ignore localStorage errors in restricted sandboxes. ceiling: sandbox localStorage restriction. upgrade: in-memory state fallback if cookie-based persistence required.
  }
  return "cursor";
}

/**
 * Persists user's preferred IDE to localStorage for instant 1-click dispatch.
 */
export function setPreferredIde(ide: SupportedIde): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IDE_PREFERENCE_STORAGE_KEY, ide);
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Dispatches the deep-link protocol URI to the host OS.
 * Uses an Android-level blur/visibility detection pattern to detect if the OS
 * successfully handed off execution to an installed desktop editor.
 *
 * If the browser window never loses focus (e.g. protocol unregistered or extension
 * not installed), invokes `onFallback` after 1.4s so the UI can assist the user.
 */
export function dispatchIdeProtocol(
  uri: string,
  onFallback?: () => void,
): void {
  if (typeof window === "undefined") return;

  let appOpened = false;

  const handleBlur = () => {
    appOpened = true;
    window.removeEventListener("blur", handleBlur);
  };

  window.addEventListener("blur", handleBlur);

  // ponytail: standard invisible link click triggers native protocol handler without navigation abort. ceiling: OS protocol registration. upgrade: custom native messaging host if bidirectional app handshake needed.
  const anchor = document.createElement("a");
  anchor.href = uri;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  if (onFallback) {
    setTimeout(() => {
      window.removeEventListener("blur", handleBlur);
      // If browser window remained active and visible, protocol handler likely failed
      if (!appOpened && !document.hidden) {
        onFallback();
      }
    }, 1400);
  }
}
