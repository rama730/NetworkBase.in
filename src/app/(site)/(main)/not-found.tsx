import { InlineNotFound } from "@/components/errors/ErrorPages";

/**
 * A missing workspace, profile or page inside the app: the app's bar and sidebar stay, the card says what's missing.
 * Sent with every app page, so it does no work here; the card asks what it needs once it is on screen.
 */
export default function MainNotFound() {
  return <InlineNotFound />;
}
