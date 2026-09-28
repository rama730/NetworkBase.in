import { headers } from "next/headers";
import { RootDocument, rootMetadata, rootViewport } from "../root-document";

export const metadata = rootMetadata;
export const viewport = rootViewport;

export default async function SiteRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") || undefined;
  return <RootDocument nonce={nonce}>{children}</RootDocument>;
}
