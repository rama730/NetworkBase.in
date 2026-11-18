import { headers } from "next/headers";
import { NotFoundPage } from "@/components/errors/ErrorPages";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { RootDocument, rootMetadata, rootViewport } from "./root-document";

export const metadata = { ...rootMetadata, title: "Page not found · NetworkBase" };
export const viewport = rootViewport;

/** An address that matches no route: the same full-page 404 as the site's. Rendered only for these, so it may ask who is signed in. */
export default async function GlobalNotFound() {
  const nonce = (await headers()).get("x-nonce") || undefined;
  const { user } = await getViewerAuthContext();
  return (
    <RootDocument nonce={nonce}>
      <NotFoundPage signedIn={Boolean(user)} />
    </RootDocument>
  );
}
