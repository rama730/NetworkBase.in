import Logo from "@/components/layout/header/Logo";
import { BackButton } from "@/components/layout/header/BackButton";
import type { ReactNode } from "react";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { LEGAL_EFFECTIVE_DATE } from "@/lib/legal/versions";

export type LegalSection = {
  id: string;
  title: string;
  content: ReactNode;
};

export function LegalDocumentPage({
  eyebrow,
  title,
  summary,
  version,
  sections,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  version: string;
  sections: LegalSection[];
}) {
  return (
    <main id="main-content" className="min-h-[100dvh] bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-20 pt-8 md:grid-cols-[220px_minmax(0,1fr)] md:px-8 md:pt-12">
        <aside className="md:sticky md:top-8 md:self-start">
          {/* A way back on every page, even in the installed app (unified back A1). */}
          <div className="flex items-center gap-2"><BackButton fallback="/" className="-ml-2" /><Logo /></div>
          <nav aria-label={`${title} sections`} className="mt-8 hidden space-y-1 md:block">
            {sections.map((section) => (
              <a key={section.id} href={`#${section.id}`} className="block rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-white hover:text-zinc-950 dark:hover:bg-zinc-900 dark:hover:text-white">
                {section.title}
              </a>
            ))}
          </nav>
        </aside>

        <article className="min-w-0">
          <header className="border-b border-zinc-200 pb-10 dark:border-zinc-800">
            <p className="nb-micro text-primary">{eyebrow}</p>
            <h1 className="mt-3 max-w-3xl text-balance text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-5 max-w-2xl text-pretty text-base leading-7 text-zinc-600 dark:text-zinc-300">{summary}</p>
            <dl className="mt-7 flex flex-wrap gap-x-8 gap-y-2 font-mono text-xs text-muted-foreground">
              <div><dt className="inline font-medium text-zinc-700 dark:text-zinc-200">Effective: </dt><dd className="inline">{LEGAL_EFFECTIVE_DATE}</dd></div>
              <div><dt className="inline font-medium text-zinc-700 dark:text-zinc-200">Version: </dt><dd className="inline tabular-nums">{version}</dd></div>
            </dl>
          </header>

          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-8 py-9">
                <h2 className="text-xl font-semibold tracking-[-0.015em]">{section.title}</h2>
                <div className="legal-copy mt-4 max-w-[64ch] space-y-4 text-[15px] leading-7 text-zinc-700 dark:text-zinc-300">
                  {section.content}
                </div>
              </section>
            ))}
          </div>

          <footer className="mt-6 border-t border-zinc-200 pt-8 dark:border-zinc-800">
            <LegalLinks align="start" />
            <p className="mt-5 text-xs leading-5 text-muted-foreground">
              Need help understanding these documents? Contact the addresses listed in the relevant policy. External providers have their own terms and privacy notices.
            </p>
          </footer>
        </article>
      </div>
    </main>
  );
}

export const LegalList = ({ children }: { children: ReactNode }) => (
  <ul className="list-disc space-y-2 pl-5 marker:text-zinc-400">{children}</ul>
);
