import type { OpenRoleInput } from "@/lib/validations/project";

const README_MAX_BYTES = 500 * 1024;

function cleanLine(value: unknown, fallback = "") {
    const text = typeof value === "string" ? value : fallback;
    return text.replace(/\s+/g, " ").trim();
}

function uniqueList(values: unknown[] | undefined) {
    return Array.from(new Set((values || []).map((value) => cleanLine(value)).filter(Boolean)));
}

export function buildProjectDocStarterDraft(input: {
    title: string;
    shortDescription?: string | null;
    description?: string | null;
    projectType?: string | null;
    technologies?: string[];
    tags?: string[];
    roles?: OpenRoleInput[];
    includeRoles?: boolean;
}) {
    const title = cleanLine(input.title, "Project doc") || "Project doc";
    const summary = cleanLine(input.shortDescription) || cleanLine(input.description) || "Describe what this project does, who it helps, and why it exists.";
    const type = cleanLine(input.projectType);
    const technologies = uniqueList(input.technologies);
    const tags = uniqueList(input.tags);
    const roles = (input.roles || [])
        .map((role) => ({
            role: cleanLine(role.role),
            count: Number.isFinite(role.count) ? role.count : 1,
            description: cleanLine(role.description),
        }))
        .filter((role) => role.role);

    const lines = [
        `# ${title}`,
        "",
        summary,
        "",
        "## Getting started",
        "",
        "```sh",
        "npm install",
        "npm run dev",
        "```",
        "",
        "## Project focus",
        "",
    ];

    if (type) lines.push(`- Type: ${type}`);
    if (technologies.length > 0) lines.push(`- Stack: ${technologies.join(", ")}`);
    if (tags.length > 0) lines.push(`- Tags: ${tags.join(", ")}`);
    if (!type && technologies.length === 0 && tags.length === 0) {
        lines.push("- Add the project scope, stack, and important links here.");
    }

    if (input.includeRoles !== false && roles.length > 0) {
        lines.push("", "## Roles needed", "");
        for (const role of roles) {
            const count = role.count > 1 ? `${role.count} openings` : "1 opening";
            lines.push(`- ${role.role} (${count})${role.description ? `: ${role.description}` : ""}`);
        }
    }

    lines.push("", "## Notes", "", "Add screenshots, demos, commands, and project references as the project grows.");

    return `${lines.join("\n").trim()}\n`;
}
