import { InlineNotFound } from "@/components/errors/ErrorPages";

/** A bad conversation or project link: say so here, so the chat sidebar stays (not the site's 404). Messages is signed in only. */
export default function MessagesNotFound() {
  return <div className="h-full bg-card"><InlineNotFound signedIn section="messages" /></div>;
}
