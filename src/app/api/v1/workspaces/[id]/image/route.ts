import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { projects, storageAssets } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/workspace-access";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { streamPrivateObject } from "@/lib/storage/private-object-response";
import { jsonError, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { isLooseUuid } from "@/lib/validations/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function coverVersion(storageKey: string) {
    return createHash("sha256").update(storageKey).digest("base64url").slice(0, 16);
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {

    const { id: projectId } = await context.params;
    if (!isLooseUuid(projectId)) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    // Browser images use cookies; the IDE host supplies its verified device bearer.
    let user: { id: string } | null;
    if (/^bearer(\s|$)/i.test(request.headers.get("authorization")?.trim() || "")) {
        const auth = await requireAuthenticatedUser();
        if (auth.response) return auth.response;
        user = auth.user;
    } else {
        const supabase = await createClient();
        user = (await supabase.auth.getUser()).data.user;
    }
    // Access check and cover lookup don't depend on each other.
    const [access, [project]] = await Promise.all([
        getProjectAccessById(projectId, user?.id ?? null),
        db
            .select({ bucket: projects.coverImageBucket, key: projects.coverImageKey })
            .from(projects)
            .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
            .limit(1),
    ]);
    if (!access.project || !access.canRead) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    if (!project?.bucket || !project.key) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const version = coverVersion(project.key);
    const isPublicRequest = !user && access.canRead;
    // Object identity is immutable, but project visibility can change without
    // changing the key. Keep public caches inside the revocation budget.
    const cacheControl = isPublicRequest
        ? "public, max-age=300, s-maxage=300, must-revalidate"
        : "private, no-store";
    if (request.nextUrl.searchParams.get("v") !== version) {
        const canonicalUrl = request.nextUrl.clone();
        canonicalUrl.searchParams.set("v", version);
        return new Response(null, {
            status: 307,
            headers: { Location: canonicalUrl.toString(), "Cache-Control": cacheControl, Vary: "Cookie, Authorization" },
        });
    }

    const etag = `"project-cover-${projectId}-${version}"`;
    const admin = await createAdminClient();
    const [{ data: signedData, error: signError }, [asset]] = await Promise.all([
        admin.storage.from(project.bucket).createSignedUrl(project.key, 15 * 60),
        db
            .select({ size: storageAssets.verifiedSize, mimeType: storageAssets.verifiedMimeType })
            .from(storageAssets)
            .where(and(
                eq(storageAssets.bucket, project.bucket),
                eq(storageAssets.storageKey, project.key),
                eq(storageAssets.state, "verified"),
            ))
            .limit(1),
    ]);

    if (signError || !signedData?.signedUrl) {
        logger.warn("project.image_route_presign_failed", {
            module: "projects",
            projectId,
            bucket: project.bucket,
            key: project.key,
            error: signError?.message || "Missing signed URL",
        });
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    let totalSize = asset?.size ?? null;
    if (totalSize === null) {
        const { data: info } = await admin.storage.from(project.bucket).info(project.key);
        totalSize = typeof info?.size === "number" ? info.size : null;
    }

    return streamPrivateObject({
        request,
        signedUrl: signedData.signedUrl,
        totalSize,
        mimeType: asset?.mimeType || "application/octet-stream",
        filename: project.key.split("/").pop() || "project-cover",
        disposition: "inline",
        etag,
        cacheControl,
    });
}

export async function HEAD(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    return GET(request, context);
}
