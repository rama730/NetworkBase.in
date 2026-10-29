"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { SkillList } from "@/components/skills/SkillList";
import { PROJECT_TYPE_OPTIONS } from "@/lib/projects/project-create-options";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ProjectOverviewCardProps {
    project: any;
    isCreator?: boolean;
    onEdit?: () => void;
    /** Organizations read the same columns as About / Who it's for / What happens here (report §34.11). */
    labels?: { description: string; problem: string; solution: string };
}

const StatementBox = memo(function StatementBox({
    title,
    content,
    onOpen,
}: {
    title: string;
    content: string;
    tone?: "problem" | "solution";
    onOpen: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onOpen}
            className="group flex h-full min-h-44 w-full flex-col rounded-[5px] border border-border bg-muted/30 p-5 text-left transition-[background-color,border-color] duration-[130ms] ease-[cubic-bezier(.2,.8,.3,1)] hover:border-foreground/30 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary active:translate-y-px"
        >
            <div className="mb-2.5 flex items-center justify-between gap-2">
                <h4 className="nb-card-title text-foreground">
                    {title}
                </h4>
            </div>
            <p className="nb-compact line-clamp-6 whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {content}
            </p>
            <span className="nb-micro mt-auto pt-4 text-muted-foreground group-hover:text-foreground">
                Click to read full text
            </span>
        </button>
    );
});

type StatementSelection = {
    title: string;
    content: string;
    tone: "problem" | "solution";
} | null;

function normalizeProjectSkills(project: any) {
    const values = [
        ...(Array.isArray(project?.skills) ? project.skills : []),
        ...(Array.isArray(project?.technologies_used) ? project.technologies_used : []),
        ...(Array.isArray(project?.technologiesUsed) ? project.technologiesUsed : []),
        ...(Array.isArray(project?.techStack) ? project.techStack : []),
    ];
    return Array.from(new Set(values.filter((skill): skill is string => typeof skill === "string" && skill.trim().length > 0).map((skill) => skill.trim())));
}

const ProjectOverviewCard = memo(function ProjectOverviewCard({
    project,
    isCreator,
    onEdit,
    labels = { description: "Vision and description", problem: "The problem", solution: "The solution" },
}: ProjectOverviewCardProps) {
    const [statement, setStatement] = useState<StatementSelection>(null);
    const [descriptionExpanded, setDescriptionExpanded] = useState(false);
    const categoryLabel = PROJECT_TYPE_OPTIONS.find((type) => type.id === project?.category)?.label ?? project?.category ?? null;
    const openRoleTitles = (Array.isArray(project?.openRoles) ? project.openRoles : [])
        .filter((role: any) => (role?.count || 0) - (role?.filled || 0) > 0)
        .map((role: any) => role?.title || role?.role)
        .filter(Boolean) as string[];
    const projectSkills = useMemo(() => normalizeProjectSkills(project), [project]);
    const problemStatement = project?.problemStatement;
    const solutionStatement = project?.solutionStatement;

    const handleOpenProblem = useCallback(() => {
        if (problemStatement) {
            setStatement({ title: labels.problem, content: problemStatement, tone: "problem" });
        }
    }, [labels.problem, problemStatement]);

    const handleOpenSolution = useCallback(() => {
        if (solutionStatement) {
            setStatement({ title: labels.solution, content: solutionStatement, tone: "solution" });
        }
    }, [labels.solution, solutionStatement]);

    const isEmpty = !project?.description && !problemStatement && !solutionStatement && (!project?.tags || project.tags.length === 0) && projectSkills.length === 0 && !categoryLabel && openRoleTitles.length === 0;

    if (isEmpty) {
        return (
            <div className="flex flex-col items-center justify-center rounded-[8px] border border-border bg-card p-8 text-center">
                <p className="nb-card-title text-foreground">No project details yet</p>
                <p className="nb-compact mt-1 text-muted-foreground">This project has not added an overview, description, or statement yet.</p>
                {isCreator && onEdit ? (
                    <button
                        type="button"
                        onClick={onEdit}
                        className="nb-touch-target mt-4 inline-flex h-[34px] items-center justify-center rounded-[5px] border border-border bg-card px-4 text-[13px] font-medium text-foreground hover:bg-muted"
                    >
                        Edit project details
                    </button>
                ) : null}
            </div>
        );
    }

    return (
        <div className="flex h-fit flex-col overflow-hidden rounded-[8px] border border-border bg-card shadow-none">
            <div className="p-4 md:p-6">
                <div className="grid grid-cols-1 gap-6 md:gap-8">
                    {/* Mobile key/value rows (spec §19: category and collaboration intent). */}
                    {categoryLabel || openRoleTitles.length > 0 ? (
                        <dl className="-mb-2 divide-y divide-border md:hidden">
                            {categoryLabel ? (
                                <div className="flex min-h-10 items-center justify-between gap-4">
                                    <dt className="nb-micro">Category</dt>
                                    <dd className="nb-compact text-right text-foreground">{categoryLabel}</dd>
                                </div>
                            ) : null}
                            <div className="flex min-h-10 items-center justify-between gap-4">
                                <dt className="nb-micro shrink-0">Looking for</dt>
                                <dd className="nb-compact min-w-0 truncate text-right text-foreground">
                                    {openRoleTitles.length > 0 ? openRoleTitles.join(", ") : "Not recruiting"}
                                </dd>
                            </div>
                        </dl>
                    ) : null}
                    {project?.description ? (
                        <section>
                            <h2 className="nb-section-title mb-3 text-foreground">
                                {labels.description}
                            </h2>
                            <p className={cn("whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/85", !descriptionExpanded && "max-md:line-clamp-6")}>
                                {project.description}
                            </p>
                            <button
                                type="button"
                                onClick={() => setDescriptionExpanded((value) => !value)}
                                aria-expanded={descriptionExpanded}
                                className="nb-touch-target nb-ui-label mt-2 inline-flex items-center text-primary md:hidden"
                            >
                                {descriptionExpanded ? "Show less" : "Read full description"}
                            </button>
                        </section>
                    ) : null}

                    {(project?.problemStatement || project?.solutionStatement) ? (
                        <div className="grid items-stretch gap-6 max-md:hidden md:grid-cols-2">
                            {project.problemStatement ? (
                                <StatementBox
                                    title={labels.problem}
                                    content={project.problemStatement}
                                    tone="problem"
                                    onOpen={handleOpenProblem}
                                />
                            ) : null}
                            {project.solutionStatement ? (
                                <StatementBox
                                    title={labels.solution}
                                    content={project.solutionStatement}
                                    tone="solution"
                                    onOpen={handleOpenSolution}
                                />
                            ) : null}
                        </div>
                    ) : null}

                    {(project?.problemStatement || project?.solutionStatement) ? (
                        <div className="divide-y divide-border rounded-[5px] border border-border md:hidden">
                            {[[labels.problem, project.problemStatement], [labels.solution, project.solutionStatement]].filter(([, text]) => text).map(([title, text]) => (
                                <details key={title} className="group">
                                    <summary className="nb-ui-label flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-foreground">
                                        {title}
                                        <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
                                    </summary>
                                    <p className="nb-compact whitespace-pre-wrap px-3 pb-3 text-muted-foreground">{text}</p>
                                </details>
                            ))}
                        </div>
                    ) : null}

                    <div className="flex flex-wrap items-start gap-12 border-t border-border pt-5 max-md:flex-col max-md:gap-4">
                        {project?.tags?.length > 0 ? (
                            <div className="space-y-3">
                                <h2 className="nb-micro">Tags</h2>
                                <div className="flex flex-wrap gap-1.5 max-md:[&>span:nth-child(n+7)]:hidden">
                                    {project.tags.map((tag: string) => (
                                        <span
                                            key={tag}
                                            className="inline-flex items-center rounded-[3px] border border-border bg-muted/50 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
                                        >
                                            #{tag}
                                        </span>
                                    ))}
                                    {project.tags.length > 6 ? (
                                        <b className="inline-flex items-center px-1 font-mono text-[11px] font-medium text-muted-foreground md:hidden">+{project.tags.length - 6}</b>
                                    ) : null}
                                </div>
                            </div>
                        ) : null}

                        {projectSkills.length > 0 ? (
                            <div className="space-y-3">
                                <h2 className="nb-micro">{"Skills and tech"}</h2>
                                <SkillList skills={projectSkills} maxVisible={12} size="sm" className="max-md:hidden" />
                                <SkillList skills={projectSkills} maxVisible={6} size="sm" className="md:hidden" />
                            </div>
                        ) : null}

                    </div>
                </div>
            </div>
            <Dialog open={Boolean(statement)} onOpenChange={(open) => !open && setStatement(null)}>
                <DialogContent className="max-h-[min(80vh,42rem)] overflow-y-auto sm:max-w-2xl rounded-[12px] border-border bg-card">
                    <DialogHeader>
                        <DialogTitle className="nb-card-title text-foreground">
                            {statement?.title}
                        </DialogTitle>
                    </DialogHeader>
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/85">
                        {statement?.content}
                    </p>
                </DialogContent>
            </Dialog>
        </div>
    );
});

export default ProjectOverviewCard;
