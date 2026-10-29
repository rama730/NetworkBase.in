import { redirect } from "next/navigation";

/** The old review page moved into the staff console (docs/trust-and-safety-concept.md §17.1). */
export default function AdminReportsPage() {
    redirect("/admin/trust");
}
