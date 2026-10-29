import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";
import { getLegalIdentity } from "@/lib/legal/config";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export const metadata: Metadata = {
  title: "Help and support | NetworkBase",
  description:
    "Official customer support, technical assistance, security reporting, and privacy channels for NetworkBase.",
};

export default function SupportPage() {
  const i = getLegalIdentity();

  return (
    <LegalDocumentPage
      eyebrow="Help and Support"
      title="Help and support"
      summary="Guidance and official contact channels for member assistance, security coordination, privacy rights, and platform governance."
      version={LEGAL_VERSIONS.support}
      sections={[
        {
          id: "assistance",
          title: "1. Member assistance and helpdesk",
          content: (
            <>
              <p>
                For assistance with account setup, workspace collaboration, workspace permissions, or
                general questions regarding NetworkBase, our support desk is reached at{" "}
                <a className="underline" href={`mailto:${i.supportEmail}`}>
                  {i.supportEmail}
                </a>
                .
              </p>
              <p>
                When contacting support, include your registered account email, relevant workspace
                identifiers or URLs, and a concise summary of the issue. Our team operates Monday
                through Friday and typically acknowledges queries within 1 to 2 business days.
              </p>
            </>
          ),
        },
        {
          id: "troubleshooting",
          title: "2. Technical troubleshooting and self-service",
          content: (
            <>
              <p>
                Many routine operational questions can be resolved directly within your account
                controls:
              </p>
              <LegalList>
                <li>
                  <strong>Session and device management:</strong> Review active browsers, editor
                  sessions, and sign-in activity in{" "}
                  <Link href="/settings?tab=security" className="underline">
                    Settings &gt; Security
                  </Link>
                  .
                </li>
                <li>
                  <strong>Third-party integrations:</strong> Connect or disconnect GitHub and
                  development tools in{" "}
                  <Link href="/settings?tab=integrations" className="underline">
                    Settings &gt; Integrations
                  </Link>
                  .
                </li>
                <li>
                  <strong>Notification delivery:</strong> Configure in-app badges and browser push
                  alerts in{" "}
                  <Link href="/settings?tab=notifications" className="underline">
                    Settings &gt; Notifications
                  </Link>
                  .
                </li>
                <li>
                  <strong>Data export:</strong> Download a full machine-readable JSON archive of your
                  account data in{" "}
                  <Link href="/settings?tab=privacy-policies" className="underline">
                    Settings &gt; Privacy and Policies
                  </Link>
                  .
                </li>
              </LegalList>
            </>
          ),
        },
        {
          id: "security",
          title: "3. Security and vulnerability reporting",
          content: (
            <>
              <p>
                We treat platform security and responsible vulnerability disclosure with paramount
                priority. If you discover a potential vulnerability or technical security defect,
                report it directly to{" "}
                <a
                  className="underline"
                  href={`mailto:${i.supportEmail}?subject=${encodeURIComponent("Private security report")}`}
                >
                  {i.supportEmail}
                </a>{" "}
                in accordance with our{" "}
                <Link href="/security-reporting" className="underline">
                  Security reporting
                </Link>
                .
              </p>
              <p>
                Do not publicly disclose findings or access data belonging to other accounts before our
                team has completed investigation and remediation.
              </p>
            </>
          ),
        },
        {
          id: "grievances",
          title: "4. Grievance redressal and statutory governance",
          content: (
            <>
              <p>
                Pursuant to statutory requirements, including the Information Technology Rules, 2021,
                and applicable Indian consumer and data protection regulations, NetworkBase maintains a
                designated Grievance Officer.
              </p>
              <p>
                If an operational issue or complaint remains unresolved through general support, you
                may escalate the matter to{" "}
                <a className="underline" href={`mailto:${i.grievanceEmail}`}>
                  {i.grievanceEmail}
                </a>{" "}
                following the procedures set out in our{" "}
                <Link href="/grievances" className="underline">
                  Grievances and Redressal Policy
                </Link>
                .
              </p>
            </>
          ),
        },
        {
          id: "privacy-rights",
          title: "5. Privacy, data rights and account requests",
          content: (
            <>
              <p>
                For data protection questions, rights requests (such as correction, consent
                withdrawal, or deletion), and regulatory inquiries, contact our privacy mailbox at{" "}
                <a className="underline" href={`mailto:${i.privacyEmail}`}>
                  {i.privacyEmail}
                </a>
                .
              </p>
              <p>
                Our handling of personal data across profiles, workspaces, and connected services is
                governed by our{" "}
                <Link href="/privacy" className="underline">
                  Privacy Policy
                </Link>{" "}
                and the{" "}
                <Link href="/terms" className="underline">
                  Terms of Service
                </Link>
                .
              </p>
            </>
          ),
        },
        {
          id: "verified-communications",
          title: "6. Verified communications and anti-phishing safeguard",
          content: (
            <>
              <p>
                To protect our community from email phishing, spoofing, and unauthorized impersonation,
                NetworkBase authenticates all outbound communications using strict SPF, DKIM, and DMARC
                records on the verified domain <code>@networkbase.in</code> across four designated
                mailboxes:
              </p>
              <LegalList>
                <li>
                  <strong>welcome@networkbase.in</strong>: Account registration, onboarding steps, and
                  confirmation notices.
                </li>
                <li>
                  <strong>notifications@networkbase.in</strong>: Task updates, mentions, collaboration
                  alerts, and workspace messages.
                </li>
                <li>
                  <strong>support@networkbase.in</strong>: Member helpdesk, operational inquiries, and
                  technical customer care.
                </li>
                <li>
                  <strong>privacy@networkbase.in</strong>: Legal correspondence, privacy notices, and
                  formal data rights requests.
                </li>
              </LegalList>
              <p>
                NetworkBase will <strong>never</strong> ask for your password, recovery tokens, or
                private credentials over email. If you receive an email from any other address claiming
                to represent NetworkBase, forward it immediately to{" "}
                <a className="underline" href={`mailto:${i.supportEmail}`}>
                  {i.supportEmail}
                </a>
                .
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
