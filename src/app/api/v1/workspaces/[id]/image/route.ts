import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaces, storageAssets } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { publicRequestUrl } from "@/lib/auth/redirects";
import { streamPrivateObject } from "@/lib/storage/private-object-response";
import { enforceFileReadLimit, jsonError, requireAuthenticatedUser } from "@/app/api/v1/_shared";
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
    const limited = await enforceFileReadLimit(request, "files:public-read", 300, 60, user?.id);
    if (limited) return limited;
    // Access check and cover lookup don't depend on each other.
    const [access, [project]] = await Promise.all([
        getWorkspaceAccessById(projectId, user?.id ?? null),
        db
            .select({ bucket: workspaces.coverImageBucket, key: workspaces.coverImageKey })
            .from(workspaces)
            .where(and(eq(workspaces.id, projectId), isNull(workspaces.deletedAt)))
            .limit(1),
    ]);
    if (!access.project || !access.canRead) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    if (!project?.bucket || !project.key) {
        return jsonError("Not found", 404, "NOT_FOUND");
    }

    const version = coverVersion(project.key);
    // Object identity is immutable, but project visibility can change without
    // changing the key. Keep every cache inside the revocation budget.
    const cacheControl = access.project.visibility === "public"
        ? "public, max-age=300, s-maxage=300, must-revalidate"
        : "private, max-age=300, must-revalidate";
    if (request.nextUrl.searchParams.get("v") !== version) {
        const canonicalUrl = publicRequestUrl(request);
        canonicalUrl.searchParams.set("v", version);
        return new Response(null, {
            status: 307,
            headers: { Location: canonicalUrl.toString(), "Cache-Control": cacheControl, Vary: "Cookie, Authorization" },
        });
    }

    const etag = `"project-cover-${projectId}-${version}"`;
    // The browser already holds these bytes: no signed URL, no storage read.
    if (request.headers.get("if-none-match") === etag) {
        return new Response(null, {
            status: 304,
            headers: { ETag: etag, "Cache-Control": cacheControl, Vary: "Cookie, Authorization" },
        });
    }
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

    // A cover whose bytes never passed verification is not served, even as a download.
    if (!asset) return jsonError("Not found", 404, "NOT_FOUND");
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

    return streamPrivateObject({
        request,
        signedUrl: signedData.signedUrl,
        totalSize: asset.size,
        mimeType: asset.mimeType,
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
