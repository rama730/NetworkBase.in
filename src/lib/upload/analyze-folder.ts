'use client';

import {
    detectPackageTechnologies,
    detectRepositoryFileTechnologies,
    mergeDetectedTechnologies,
} from '@/lib/skills/repository-detection';

/**
 * Analyze uploaded folder to auto-detect project metadata.
 * Scans for package.json and README.md in the FileList.
 * Pure client-side - no server calls needed.
 */

/** Directories whose package.json / README describe a dependency or build output, not the project. */
const NON_PROJECT_DIRECTORIES = new Set(['node_modules', '.git', '.svn', '.hg', 'vendor', 'dist', 'build', '.next', '.system', '__macosx']);

function candidateDepth(file: File): number | null {
    const segments = (file.webkitRelativePath || file.name).split('/');
    if (segments.slice(0, -1).some((segment) => NON_PROJECT_DIRECTORIES.has(segment.toLowerCase()))) return null;
    return segments.length;
}

/**
 * Picks the document that describes the selected folder (API-021): the shallowest one, so the
 * folder's own root package.json/README wins over a nested workspace or example. Equal depth
 * resolves by path so the result never depends on file-listing order.
 */
function preferShallower(current: File | null, candidate: File): File {
    if (!current) return candidate;
    const a = candidateDepth(current) ?? Infinity;
    const b = candidateDepth(candidate) ?? Infinity;
    if (a !== b) return b < a ? candidate : current;
    return (candidate.webkitRelativePath || candidate.name) < (current.webkitRelativePath || current.name) ? candidate : current;
}

export interface FolderAnalysis {
    title: string;
    description: string;
    technologies: string[];
    detectedFramework: string | null;
}

/**
 * Analyze a folder from FileList to extract metadata.
 * Pure optimization: Early break, parallel reads, minimal iteration.
 */
export async function analyzeUploadedFolder(files: FileList, signal?: AbortSignal): Promise<FolderAnalysis> {
    const result: FolderAnalysis = {
        title: '',
        description: '',
        technologies: [],
        detectedFramework: null,
    };

    let packageJsonFile: File | null = null;
    let readmeFile: File | null = null;

    const repositoryPaths: string[] = [];

    // Keep a bounded path sample for stack markers without allocating an array for the whole FileList.
    // Especially important if someone drops a folder with 1M files (e.g. node_modules)
    for (let i = 0; i < files.length; i++) {
        if (signal?.aborted) return result;
        const file = files[i];
        if (!file) continue;
        const name = file.name.toLowerCase();
        if (repositoryPaths.length < 10_000) repositoryPaths.push(file.webkitRelativePath || file.name);

        if ((name === 'package.json' || name === 'readme.md') && candidateDepth(file) !== null) {
            if (name === 'package.json') packageJsonFile = preferShallower(packageJsonFile, file);
            else readmeFile = preferShallower(readmeFile, file);
        }

    }

    if (!packageJsonFile && !readmeFile) {
        result.technologies = detectRepositoryFileTechnologies(repositoryPaths);
        return result;
    }

    if (signal?.aborted) return result;

    // Parallel read: package.json AND README.md simultaneously
    // Optimization: only read if file is small (< 1MB) to prevent browser crash
    const [pkgContent, readmeContent] = await Promise.all([
        (packageJsonFile && packageJsonFile.size < 1024 * 1024) ? packageJsonFile.text() : Promise.resolve(null),
        (!result.description && readmeFile && readmeFile.size < 1024 * 1024) ? readmeFile.text() : Promise.resolve(null),
    ]);

    // Process package.json
    if (pkgContent) {
        try {
            const pkg = JSON.parse(pkgContent);
            if (pkg.name) result.title = pkg.name.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
            if (pkg.description) result.description = pkg.description;

            const detected = detectPackageTechnologies(pkg);
            result.technologies = detected.technologies;
            result.detectedFramework = detected.detectedFramework;
        } catch { /* Invalid JSON */ }
    }

    // Process Doc (only if no description from package.json)
    if (!result.description && readmeContent) {
        const lines = readmeContent.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('!'));
        if (lines.length) result.description = lines.slice(0, 2).join(' ').substring(0, 200);
    }

    result.technologies = mergeDetectedTechnologies(
        result.technologies,
        detectRepositoryFileTechnologies(repositoryPaths),
    );
    return result;
}
