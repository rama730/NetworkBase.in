"use server";

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SupportedIde, SUPPORTED_IDES } from "@/lib/extension/ide-protocol";

export interface DetectedInstalledIdesResult {
  success: boolean;
  platform: "darwin" | "win32" | "linux" | "unknown";
  installedIds: SupportedIde[];
  detectedAt: number;
}

// In-memory cache to guarantee sub-millisecond response on subsequent calls
let cachedResult: DetectedInstalledIdesResult | null = null;
let lastScanTime = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

// O(1) exact macOS application name mappings
const MAC_EXACT_APPS: Record<string, SupportedIde> = {
  "visual studio code": "vscode",
  code: "vscode",
  "visual studio code - insiders": "vscode-insiders",
  "code - insiders": "vscode-insiders",
  cursor: "cursor",
  windsurf: "windsurf",
  "windsurf next": "windsurf",
  antigravity: "antigravity",
  "antigravity ide": "antigravity",
  vscodium: "vscodium",
  codium: "vscodium",
  trae: "trae",
  zed: "zed",
  "zed preview": "zed",
  webstorm: "webstorm",
  clion: "clion",
  goland: "goland",
  rustrover: "rustrover",
  rider: "rider",
  phpstorm: "phpstorm",
  fleet: "fleet",
  datagrip: "datagrip",
  rubymine: "rubymine",
};

const JETBRAINS_PREFIXES: Array<[string, SupportedIde]> = [
  ["intellij idea", "intellij-idea"],
  ["pycharm", "pycharm"],
  ["android studio", "android-studio"],
];

function matchMacAppName(name: string): SupportedIde | null {
  const n = name.replace(/\.app$/i, "").trim().toLowerCase();
  const direct = MAC_EXACT_APPS[n];
  if (direct) return direct;
  for (const [prefix, id] of JETBRAINS_PREFIXES) {
    if (n.startsWith(prefix)) return id;
  }
  return null;
}

async function checkAnyExists(paths: string[]): Promise<boolean> {
  const checks = await Promise.all(
    paths.map((p) =>
      fs
        .access(p)
        .then(() => true)
        .catch(() => false),
    ),
  );
  return checks.some(Boolean);
}

// Standard CLI paths for macOS
const MAC_CLI_PATHS: Partial<Record<SupportedIde, string[]>> = {
  cursor: ["/usr/local/bin/cursor", "/opt/homebrew/bin/cursor"],
  vscode: ["/usr/local/bin/code", "/opt/homebrew/bin/code"],
  "vscode-insiders": ["/usr/local/bin/code-insiders", "/opt/homebrew/bin/code-insiders"],
  windsurf: ["/usr/local/bin/windsurf", "/opt/homebrew/bin/windsurf"],
  antigravity: ["/usr/local/bin/antigravity", "/opt/homebrew/bin/antigravity"],
  vscodium: ["/usr/local/bin/codium", "/opt/homebrew/bin/codium"],
  zed: ["/usr/local/bin/zed", "/opt/homebrew/bin/zed"],
  trae: ["/usr/local/bin/trae", "/opt/homebrew/bin/trae"],
};

/**
 * Detects all IDEs actually installed on the user's laptop.
 * High-performance, non-blocking scan with in-memory caching.
 * Accepts optional clientPlatform to guard against remote cloud container scans.
 */
export async function detectInstalledLaptopIdesAction(
  clientPlatform?: "darwin" | "win32" | "linux" | "unknown",
): Promise<DetectedInstalledIdesResult> {
  const now = Date.now();
  const serverPlatform = os.platform();

  // If client OS does not match server host OS (e.g. client is Mac, server is Linux container),
  // do not return server disk contents as client installations.
  const isMismatch =
    clientPlatform &&
    clientPlatform !== "unknown" &&
    serverPlatform !== clientPlatform;

  if (isMismatch) {
    return {
      success: true,
      platform: clientPlatform,
      installedIds: [],
      detectedAt: now,
    };
  }

  // In production cloud hosting environments, server container disk contents do not reflect client installations.
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.AWS_EXECUTION_ENV ||
    process.env.FLY_APP_NAME ||
    process.env.RENDER ||
    process.env.KUBERNETES_SERVICE_HOST
  ) {
    return {
      success: true,
      platform: clientPlatform ?? "unknown",
      installedIds: [],
      detectedAt: now,
    };
  }

  if (cachedResult && now - lastScanTime < CACHE_TTL_MS) {
    return cachedResult;
  }

  const installedSet = new Set<SupportedIde>();

  try {
    if (serverPlatform === "darwin") {
      // 1. Scan macOS Applications directories
      const homeApplications = path.join(os.homedir(), "Applications");
      const scanDirs = [
        "/Applications",
        homeApplications,
        path.join(homeApplications, "JetBrains Toolbox"),
        "/Applications/Utilities",
      ];

      for (const dir of scanDirs) {
        try {
          const files = await fs.readdir(dir);
          for (const file of files) {
            if (!file.endsWith(".app")) continue;
            const matchedIde = matchMacAppName(file);
            if (matchedIde) {
              installedSet.add(matchedIde);
            }
          }
        } catch {
          // Directory might not exist
        }
      }

      // 2. Scan standard CLI symlinks
      await Promise.all(
        Object.entries(MAC_CLI_PATHS).map(async ([ideId, paths]) => {
          if (await checkAnyExists(paths)) {
            installedSet.add(ideId as SupportedIde);
          }
        }),
      );
    } else if (serverPlatform === "win32") {
      const localAppData = process.env.LOCALAPPDATA || "";
      const programFiles = process.env.ProgramFiles || "C:\\Program Files";
      const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

      const WIN_PATHS: Record<string, string[]> = {
        vscode: [
          path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"),
          path.join(programFiles, "Microsoft VS Code", "Code.exe"),
          path.join(programFilesX86, "Microsoft VS Code", "Code.exe"),
        ],
        cursor: [
          path.join(localAppData, "Programs", "cursor", "Cursor.exe"),
          path.join(programFiles, "Cursor", "Cursor.exe"),
        ],
        windsurf: [
          path.join(localAppData, "Programs", "Windsurf", "Windsurf.exe"),
          path.join(programFiles, "Windsurf", "Windsurf.exe"),
        ],
        antigravity: [
          path.join(localAppData, "Programs", "Antigravity", "Antigravity.exe"),
          path.join(programFiles, "Antigravity", "Antigravity.exe"),
        ],
        vscodium: [
          path.join(localAppData, "Programs", "VSCodium", "VSCodium.exe"),
          path.join(programFiles, "VSCodium", "VSCodium.exe"),
        ],
        trae: [path.join(localAppData, "Programs", "Trae", "Trae.exe")],
        zed: [path.join(localAppData, "Programs", "Zed", "Zed.exe")],
        "intellij-idea": [path.join(programFiles, "JetBrains", "IntelliJ IDEA", "bin", "idea64.exe")],
        pycharm: [path.join(programFiles, "JetBrains", "PyCharm", "bin", "pycharm64.exe")],
        webstorm: [path.join(programFiles, "JetBrains", "WebStorm", "bin", "webstorm64.exe")],
      };

      await Promise.all(
        Object.entries(WIN_PATHS).map(async ([ideId, paths]) => {
          if (await checkAnyExists(paths)) {
            installedSet.add(ideId as SupportedIde);
          }
        }),
      );
    } else if (serverPlatform === "linux") {
      const LINUX_BINS: Record<string, string[]> = {
        vscode: ["/usr/bin/code", "/usr/local/bin/code", "/snap/bin/code"],
        cursor: ["/usr/bin/cursor", "/usr/local/bin/cursor", "/snap/bin/cursor"],
        windsurf: ["/usr/bin/windsurf", "/usr/local/bin/windsurf"],
        antigravity: ["/usr/bin/antigravity", "/usr/local/bin/antigravity"],
        vscodium: ["/usr/bin/codium", "/usr/local/bin/codium"],
        zed: ["/usr/bin/zed", "/usr/local/bin/zed"],
        trae: ["/usr/bin/trae"],
      };

      await Promise.all(
        Object.entries(LINUX_BINS).map(async ([ideId, paths]) => {
          if (await checkAnyExists(paths)) {
            installedSet.add(ideId as SupportedIde);
          }
        }),
      );
    }
  } catch (err) {
    console.warn("Failed to detect installed laptop IDEs:", err);
  }

  const validInstalledIds = Array.from(installedSet).filter((id) => id in SUPPORTED_IDES);

  const result: DetectedInstalledIdesResult = {
    success: true,
    platform:
      serverPlatform === "darwin"
        ? "darwin"
        : serverPlatform === "win32"
          ? "win32"
          : serverPlatform === "linux"
            ? "linux"
            : "unknown",
    installedIds: validInstalledIds,
    detectedAt: now,
  };

  cachedResult = result;
  lastScanTime = now;
  return result;
}
