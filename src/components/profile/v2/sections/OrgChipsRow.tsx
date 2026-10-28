import Link from "next/link";
import { Building2 } from "lucide-react";

import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";

/** Overview: `[logo] CSE-3A · Student` chips for the orgs this person shows on their profile (report §24.4). */
export function OrgChipsRow({ contributions }: { contributions: ProfileCollaborationContribution[] }) {
  const orgs = contributions.filter((c) => c.projectKind === "organization");
  if (orgs.length === 0) return null;
  return (
    <ul aria-label="Organizations" className="mb-4 flex flex-wrap gap-2">
      {orgs.map((c) => {
        const label = <><Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{c.projectTitle}{c.title ? ` · ${c.title}` : ""}</span></>;
        return (
          <li key={c.id} className="max-w-full">
            {c.projectHref
              ? <Link href={c.projectHref} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[13px] hover:bg-muted">{label}</Link>
              : <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[13px]">{label}</span>}
          </li>
        );
      })}
    </ul>
  );
}
