import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";
import { getLegalIdentity } from "@/lib/legal/config";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export const metadata: Metadata = { title: "Acceptable Use Policy · NetworkBase", description: "The numbered community rules for NetworkBase, and how reports and appeals work." };

// The numbered rules (docs/trust-and-safety-concept.md §19.4, F3): every report reason, decision, notice and email
// links here as /acceptable-use#rule-N. Keep the numbers stable; lib/trust/rules.ts names them.
export default function AcceptableUsePage() {
  const i = getLegalIdentity();
  return <LegalDocumentPage eyebrow="Legal · Community safety" title="Acceptable Use Policy" summary="The rules that keep members, workspaces, organizations and NetworkBase itself safe. Each one has a number, so a decision can tell you exactly which rule it was about." version={LEGAL_VERSIONS.acceptableUse} sections={[
    { id: "rule-1", title: "§1 Threats and violence", content: <p>Don’t threaten, encourage or celebrate violence against anyone, and don’t share instructions that help someone cause serious harm. If someone is in immediate danger, contact local emergency services (112 in India) first.</p> },
    { id: "rule-2", title: "§2 Harassment and bullying", content: <p>Don’t target, insult, intimidate, stalk or pile on another person, in public or in private messages. Disagreeing is fine; making it personal isn’t.</p> },
    { id: "rule-3", title: "§3 Hate", content: <p>Don’t attack people for who they are, including caste, religion, race, ethnicity, nationality, gender, sexual orientation, disability or age.</p> },
    { id: "rule-4", title: "§4 Spam and manipulation", content: <p>Don’t post ads, repeated content or mass messages, and don’t fake engagement, attribution or contributions. Bots and automation follow the same rule (§14).</p> },
    { id: "rule-5", title: "§5 Impersonation", content: <p>Don’t pretend to be another person or organization, or misrepresent your affiliation. Parody must be clearly labelled.</p> },
    { id: "rule-6", title: "§6 Scams and fraud", content: <LegalList><li>No fake jobs, payment requests, phishing links or deceptive offers.</li><li>No unlawful gambling, money laundering, controlled goods, sanctions evasion or other conduct prohibited by law.</li></LegalList> },
    { id: "rule-7", title: "§7 Private information", content: <p>Don’t share anyone’s phone number, address, ID documents, private photos or other private details without their permission, and don’t upload live secrets such as passwords, private keys or access tokens.</p> },
    { id: "rule-8", title: "§8 Intimate images without consent", content: <p>Never share sexual or intimate images of someone without their consent. Reported images are hidden at once while we review.</p> },
    { id: "rule-9", title: "§9 Sexual and graphic content", content: <p>NetworkBase is a workplace. Don’t post sexual, violent or graphic content.</p> },
    { id: "rule-10", title: "§10 Child safety", content: <p>We have zero tolerance for content that sexualises or endangers minors. It is removed at once, the account is banned, and we report it to the authorities as the law requires. These decisions can’t be appealed.</p> },
    { id: "rule-11", title: "§11 Self-harm", content: <p>If someone may hurt themselves, we reach out with support, not penalties. In India you can talk to Tele-MANAS on 14416 or KIRAN on 1800-599-0019, any time. Content that encourages self-harm is removed.</p> },
    { id: "rule-12", title: "§12 Intellectual property", content: <p>Upload, import and share only what you have the right to use. Don’t infringe copyright, trademarks, patents, confidentiality or database rights. Rights holders can send notices through the <Link className="underline" href="/copyright">Copyright page</Link>.</p> },
    { id: "rule-13", title: "§13 Misusing reports and appeals", content: <p>Report honestly. Coordinated or knowingly false reports, and appeals made to harass, break this rule. Reports with no rule broken are fine; repeated bad-faith reports are not.</p> },
    { id: "rule-14", title: "§14 Systems, automation and fair use", content: <LegalList><li>Don’t upload malware or code designed to interrupt or compromise systems, and don’t access workspaces, messages, accounts, repositories, APIs or infrastructure without permission.</li><li>Don’t bypass rate limits, security controls, visibility settings, review gates or repository protections. Security research needs written authorization and must not touch other people’s data.</li><li>Don’t use bots, scraping, generated content or automated Git operations to spam, deceive, impersonate or evade enforcement. You’re responsible for what your account publishes, including AI-generated material.</li><li>Don’t overload NetworkBase, extract data in bulk without permission, resell access, create excessive accounts, or use the service as general storage, compute or attack infrastructure.</li></LegalList> },
    { id: "rule-15", title: "§15 Reports and enforcement", content: <>
      <LegalList>
        <li><strong>Reporting.</strong> Use Report in the “⋯” menu on anything you can see. We never tell the person who reported them. In an organization, its admins may see what you wrote in a report, but not your name. You can follow your reports in Settings → Privacy → Your reports.</li>
        <li><strong>Review.</strong> Urgent reports are reviewed within 1 hour, high within 24 hours and others within 3 days. Organization admins review their own organization’s everyday reports first; NetworkBase reviews everything else.</li>
        <li><strong>Decisions.</strong> We can hide or remove content, warn, limit an account for 7 or 30 days, suspend it, or ban it, and restrict, suspend or remove a workspace or organization. A broken rule usually adds a strike for 6 months; repeated strikes lead to longer limits.</li>
        <li><strong>Notices.</strong> When we act, you get a notice and an email that name the rule and the case number (NB-…). Safety notices are always sent, whatever your notification settings.</li>
        <li><strong>Appeals.</strong> You can appeal once per decision, within 30 days (60 for a ban), from the notice, the email or Settings → Account → Standing. Someone other than the original reviewer decides within 72 hours where possible. Child-safety decisions can’t be appealed.</li>
        <li><strong>Legal requests.</strong> Grievances and legal notices go to <Link className="underline" href="/grievances">Grievances</Link> or <a className="underline" href={`mailto:${i.grievanceEmail}`}>{i.grievanceEmail}</a>. We may preserve evidence and report conduct to authorities when the law requires it.</li>
      </LegalList>
    </> },
  ]} />;
}
