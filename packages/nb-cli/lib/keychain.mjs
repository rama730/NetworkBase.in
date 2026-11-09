// Where a token is kept on this computer (report A3.4): the macOS Keychain, the Linux Secret Service (secret-tool),
// or on Windows a DPAPI-encrypted value only this Windows account can read. Falls back to the owner-only file.
// Commands run with execFile (no shell); secret-tool and PowerShell read the token from stdin. `security` only
// takes it as an argument, so on macOS it's visible to this user's own processes for an instant.
import { execFileSync } from "node:child_process";

const SERVICE = "networkbase";

/** @param {NodeJS.ProcessEnv} env @returns {"keychain" | "secret-service" | "dpapi" | null} */
export function secureStore(env) {
  if (env.NB_CREDENTIAL_STORE === "file") return null;
  try {
    if (process.platform === "darwin") { execFileSync("security", ["-h"], { stdio: "ignore" }); return "keychain"; }
    if (process.platform === "linux") { execFileSync("secret-tool", ["--version"], { stdio: "ignore" }); return "secret-service"; }
    if (process.platform === "win32") return "dpapi";
  } catch {
    // The tool isn't installed: use the file.
  }
  return null;
}

/** Stores the token; returns what to keep in the credentials file instead of it. @param {"keychain" | "secret-service" | "dpapi"} store @param {string} account @param {string} token */
export function storeSecret(store, account, token) {
  if (store === "keychain") {
    execFileSync("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", token], { stdio: "ignore" });
    return {};
  }
  if (store === "secret-service") {
    execFileSync("secret-tool", ["store", "--label=NetworkBase CLI", "service", SERVICE, "account", account], { input: token, stdio: ["pipe", "ignore", "ignore"] });
    return {};
  }
  const sealed = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$t = [Console]::In.ReadToEnd(); ConvertTo-SecureString $t -AsPlainText -Force | ConvertFrom-SecureString"], { input: token, encoding: "utf8" }).trim();
  return { sealed };
}

/** @param {"keychain" | "secret-service" | "dpapi"} store @param {string} account @param {string | undefined} sealed */
export function readSecret(store, account, sealed) {
  try {
    if (store === "keychain") return execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    if (store === "secret-service") return execFileSync("secret-tool", ["lookup", "service", SERVICE, "account", account], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    if (!sealed) return null;
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$s = [Console]::In.ReadToEnd().Trim() | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"], { input: sealed, encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/** @param {"keychain" | "secret-service" | "dpapi"} store @param {string} account */
export function removeSecret(store, account) {
  try {
    if (store === "keychain") execFileSync("security", ["delete-generic-password", "-s", SERVICE, "-a", account], { stdio: "ignore" });
    else if (store === "secret-service") execFileSync("secret-tool", ["clear", "service", SERVICE, "account", account], { stdio: "ignore" });
  } catch {
    // Already gone.
  }
}

/** Where `nb whoami` says the token is. @param {string | undefined} storage */
export const storageWords = (storage) => ({ keychain: "the macOS Keychain", "secret-service": "the system keyring", dpapi: "Windows-encrypted file" })[/** @type {"keychain"} */ (storage)] ?? "~/.networkbase/credentials.json";
