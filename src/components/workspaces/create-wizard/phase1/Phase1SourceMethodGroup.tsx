"use client";

import { Building2, Code2, FolderUp, Github, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkspaceSourceType = "scratch" | "github" | "upload";
/** The cards: the three project sources, plus Organization when organizations are on. */
export type StartingPoint = WorkspaceSourceType | "organization";

const SOURCE_OPTIONS: Array<{
  type: StartingPoint;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    type: "scratch",
    title: "Start empty",
    description: "Create an empty workspace and add its details manually.",
    icon: Code2,
  },
  {
    type: "github",
    title: "Import from GitHub",
    description: "Check a repository, choose its branch, and review its files.",
    icon: Github,
  },
  {
    type: "upload",
    title: "Upload a folder",
    description: "Inspect a local folder before creating the workspace.",
    icon: FolderUp,
  },
  {
    type: "organization",
    title: "Organization",
    description: "A class, company or club that holds people and their workspaces.",
    icon: Building2,
  },
];

export function Phase1SourceMethodGroup({
  value,
  onChange,
  showOrganization = false,
}: {
  value: StartingPoint;
  onChange: (value: StartingPoint) => void;
  showOrganization?: boolean;
}) {
  return (
    <fieldset
      className="space-y-4"
      data-testid="create-project-phase1-source-grid"
      aria-describedby="create-project-source-help"
    >
      <div>
        <legend className="nb-section-title text-foreground">
          How do you want to start?
        </legend>
        <p id="create-project-source-help" className="nb-compact mt-1 max-w-[64ch] text-muted-foreground">
          Select one source. You can change it here without leaving this phase.
        </p>
      </div>

      <div className={cn("grid grid-cols-1 gap-3 md:gap-4 md:grid-cols-2", showOrganization ? "xl:grid-cols-4" : "lg:grid-cols-3")}>
        {SOURCE_OPTIONS.filter((option) => showOrganization || option.type !== "organization").map((option) => {
          const Icon = option.icon;
          const selected = value === option.type;

          return (
            <label
              key={option.type}
              data-testid={`create-project-source-card-${option.type}`}
              className={cn(
                "group relative flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-left md:p-6 transition-[background-color,border-color,box-shadow] duration-[130ms] ease-[cubic-bezier(.2,.8,.3,1)]",
                selected
                  ? "border-primary bg-secondary"
                  : "border-border bg-card hover:border-input hover:bg-muted/60",
              )}
            >
              <input
                type="radio"
                name="create-project-source"
                value={option.type}
                checked={selected}
                onChange={() => onChange(option.type)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-md border bg-card transition-colors",
                  selected ? "border-primary text-primary" : "border-border text-muted-foreground",
                )}
                aria-hidden="true"
              >
                <Icon className="size-[18px]" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="nb-card-title block text-foreground">{option.title}</span>
                <span className="nb-compact mt-1 block text-muted-foreground">{option.description}</span>
              </span>
              <span className="pointer-events-none absolute inset-0 rounded-lg ring-ring ring-offset-2 ring-offset-background peer-focus-visible:ring-2" />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
