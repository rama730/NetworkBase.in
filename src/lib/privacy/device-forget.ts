import { keys as idbKeys, delMany } from "idb-keyval";

/**
 * After a block or unblock, this device drops what it kept about the other person (Blocking B35): their
 * notifications still on screen, and offline search previews that could list them.
 */
export async function forgetOnDevice(otherUserId: string) {
  try {
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    const shown = registration ? await registration.getNotifications() : [];
    for (const notification of shown) {
      const data = notification.data as { actorUserId?: string } | null;
      if (data?.actorUserId === otherUserId) notification.close();
    }
  } catch {
    // Notifications are optional on this device.
  }
  await forgetOfflineSearch();
}

/** Drops every offline search copy on this device: after a block, and on sign-out (a shared computer). */
export async function forgetOfflineSearch() {
  try {
    const stored = await idbKeys();
    const search = stored.filter((key) => typeof key === "string" && key.startsWith("offline:search:"));
    if (search.length) await delMany(search);
  } catch {
    // Storage may be blocked; nothing was kept then.
  }
}

