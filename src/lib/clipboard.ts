import { toast } from "sonner";

/** Copy, then confirm only if it worked (the clipboard can refuse: permissions, insecure origin). */
export async function copyWithToast(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
    return true;
  } catch {
    toast.error("Couldn't copy. Your browser blocked the clipboard.");
    return false;
  }
}
