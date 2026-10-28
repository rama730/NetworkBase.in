import { notFound } from "next/navigation";

import { readAdminReportsAction } from "@/app/actions/trust";
import { AdminReportsClient } from "@/components/reports/AdminReportsClient";
import { isAdminUser } from "@/lib/security/admin";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 0;

/** Platform admin review (report §30.3): reports, Verified badge requests and suspended organizations. */
export default async function AdminReportsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!isAdminUser(user)) notFound();
    const data = await readAdminReportsAction();
    if (!data) notFound();
    return <AdminReportsClient data={data} />;
}
