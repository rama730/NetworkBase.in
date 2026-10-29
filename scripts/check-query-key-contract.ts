import fs from "node:fs";
import path from "node:path";

type Violation = {
  file: string;
  excerpt: string;
};

const REPO_ROOT = process.cwd();

const TARGET_PREFIXES = [
  "src/components/my-work/",
  "src/components/discover/",
  "src/hooks/projects/",
  "src/hooks/useWorkspace",
  "src/hooks/useMessages",
  "src/components/messages/",
];

const TARGET_FILES = new Set<string>([
  "src/hooks/mutations/useProjectMutations.ts",
  "src/hooks/useSettingsQueries.ts",
  "src/hooks/useProfileData.ts",
  "src/hooks/useMessagesData.ts",
  "src/hooks/useConnections.ts",
  "src/components/profile/ProfileForm.tsx",
  "src/components/profile/edit/EditProfileEditor.tsx",
  "src/app/(site)/(onboarding)/onboarding/page.tsx",
]);

const FORBIDDEN_PATTERNS: RegExp[] = [
  /queryKey\s*:\s*\[\s*['"](my-work|hub|profile|settings)['"]/g,
  /invalidateQueries\(\s*\{\s*queryKey\s*:\s*\[\s*['"](my-work|hub|profile|settings)['"]/g,
  /cancelQueries\(\s*\{\s*queryKey\s*:\s*\[\s*['"](my-work|hub|profile|settings)['"]/g,
  /getQueryData\(\s*\[\s*['"](my-work|hub|profile|settings)['"]/g,
  /setQueryData\(\s*\[\s*['"](my-work|hub|profile|settings)['"]/g,
];

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isTarget(relPath: string): boolean {
  if (TARGET_FILES.has(relPath)) return true;
  return TARGET_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function listFiles(dirPath: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(dirPath);
  return out;
}

function extractExcerpt(content: string, index: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(content.length, index + 120);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

function main() {
  const srcDir = path.join(REPO_ROOT, "src");
  const files = listFiles(srcDir);
  const violations: Violation[] = [];

  for (const fullPath of files) {
    const relPath = toPosix(path.relative(REPO_ROOT, fullPath));
    if (!isTarget(relPath)) continue;
    const content = fs.readFileSync(fullPath, "utf8");

    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(content);
      if (!match) continue;
      violations.push({
        file: relPath,
        excerpt: extractExcerpt(content, match.index),
      });
      break;
    }
  }

  if (violations.length > 0) {
    console.error("[query-key-contract] violations detected:");
    for (const violation of violations) {
      console.error(` - ${violation.file}: ${violation.excerpt}`);
    }
    process.exit(1);
  }

  console.log("[query-key-contract] ok");
}

main();
