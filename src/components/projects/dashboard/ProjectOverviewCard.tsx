"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { SkillList } from "@/components/skills/SkillList";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ProjectOverviewCardProps {
    project: any;
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
}: ProjectOverviewCardProps) {
    const [statement, setStatement] = useState<StatementSelection>(null);
    const projectSkills = useMemo(() => normalizeProjectSkills(project), [project]);
    const problemStatement = project?.problemStatement;
    const solutionStatement = project?.solutionStatement;

    const handleOpenProblem = useCallback(() => {
        if (problemStatement) {
            setStatement({ title: "The Problem", content: problemStatement, tone: "problem" });
        }
    }, [problemStatement]);

    const handleOpenSolution = useCallback(() => {
        if (solutionStatement) {
            setStatement({ title: "The Solution", content: solutionStatement, tone: "solution" });
        }
    }, [solutionStatement]);

    return (
        <div className="flex h-fit flex-col overflow-hidden rounded-[8px] border border-border bg-card shadow-none">
            <div className="p-5 sm:p-6">
                <div className="grid grid-cols-1 gap-8">
                    {project?.description ? (
                        <section>
                            <h3 className="nb-section-title mb-3 text-foreground">
                                Vision & Description
                            </h3>
                            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/85">
                                {project.description}
                            </p>
                        </section>
                    ) : null}

                    {(project?.problemStatement || project?.solutionStatement) ? (
                        <div className="grid items-stretch gap-6 md:grid-cols-2">
                            {project.problemStatement ? (
                                <StatementBox
                                    title="The Problem"
                                    content={project.problemStatement}
                                    tone="problem"
                                    onOpen={handleOpenProblem}
                                />
                            ) : null}
                            {project.solutionStatement ? (
                                <StatementBox
                                    title="The Solution"
                                    content={project.solutionStatement}
                                    tone="solution"
                                    onOpen={handleOpenSolution}
                                />
                            ) : null}
                        </div>
                    ) : null}

                    <div className="flex flex-wrap items-start gap-12 border-t border-border pt-5">
                        {project?.tags?.length > 0 ? (
                            <div className="space-y-3">
                                <h3 className="nb-micro">Tags</h3>
                                <div className="flex flex-wrap gap-1.5">
                                    {project.tags.map((tag: string) => (
                                        <span
                                            key={tag}
                                            className="inline-flex items-center rounded-[3px] border border-border bg-muted/50 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
                                        >
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {projectSkills.length > 0 ? (
                            <div className="space-y-3">
                                <h3 className="nb-micro">{"Skills & Tech"}</h3>
                                <SkillList skills={projectSkills} maxVisible={12} size="sm" />
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
