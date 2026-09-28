import { RootDocument, rootMetadata, rootViewport } from "../root-document";

export const dynamic = "force-static";
export const metadata = rootMetadata;
export const viewport = rootViewport;

export default function LegalRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RootDocument>{children}</RootDocument>;
}
