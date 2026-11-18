import { NotFoundPage } from "@/components/errors/ErrorPages";

/**
 * A missing page outside the app's frame: the full-page 404 (prototype 18oAc8rbMB6hRsYTj2dxDy). Next sends this file
 * with every page of the site, so it does no work here; the 404 asks what it needs once it is on screen.
 */
export default function NotFound() {
  return <NotFoundPage />;
}
