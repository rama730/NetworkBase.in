import AccountSettings from "@/components/settings/AccountSettings";
import AccountDeletionSettings from "@/components/settings/AccountDeletionSettings";
import AppearanceSettings from "@/components/settings/AppearanceSettings";
import IntegrationsSettings from "@/components/settings/IntegrationsSettings";
import { LegalAndDataRightsSection } from "@/components/settings/LegalAndDataRightsSection";
import NotificationsSettings from "@/components/settings/NotificationsSettings";
import PrivacySettings from "@/components/settings/PrivacySettings";
import SecuritySettings from "@/components/settings/SecuritySettings";
import { StandingSettings, YourReportsSettings } from "@/components/settings/TrustSafetySettings";
import { SettingsBand } from "@/components/settings/mix/SettingsBand";
import { SettingsCheckup } from "@/components/settings/mix/SettingsCheckup";
import { DeleteHeadline } from "@/components/settings/mix/DeleteHeadline";
import { SETTINGS_SECTION_META } from "@/constants/settings";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/settings/navigation";
import { OpenSettingsSections } from "@/components/settings/ui/SettingsSectionLayout";

/**
 * One section of the Settings page (mix): a hairline frame with "0N / 08 · Name", a serif line saying what it's for,
 * and one plain line; then its groups. `before` sits above the frame inside the section (the band and check-up
 * belong to Account, so landing on the page shows them).
 */
function DocumentSection({ section, children, before, danger, headline }: { section: SettingsSection; children: React.ReactNode; before?: React.ReactNode; danger?: boolean; headline?: React.ReactNode }) {
  const id = `settings-${section}`;
  const meta = SETTINGS_SECTION_META[section];
  const number = String(SETTINGS_SECTIONS.indexOf(section) + 1).padStart(2, "0");
  return (
    <section id={id} data-settings-section aria-labelledby={`${id}-heading`} className="nbs-doc scroll-mt-4">
      {before}
      <div className={danger ? "nbs-frame danger" : "nbs-frame"}>
        <div className="nbs-fhead">
          <p className="nbs-eyebrow">{number} / {String(SETTINGS_SECTIONS.length).padStart(2, "0")} · <b>{meta.title}</b></p>
          {headline ?? <h2 id={`${id}-heading`} tabIndex={-1}>{meta.headline}</h2>}
          <p>{meta.description}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

export default function SettingsDocument() {
  return (
    <OpenSettingsSections>
      <div data-settings-document className="mx-auto grid w-full max-w-[900px] gap-6 pb-16">
        <DocumentSection section="account" before={<><SettingsBand /><SettingsCheckup /></>}>
          <AccountSettings />
          <StandingSettings />
        </DocumentSection>

        <DocumentSection section="security">
          <SecuritySettings />
        </DocumentSection>

        <DocumentSection section="privacy">
          <PrivacySettings />
          <YourReportsSettings />
        </DocumentSection>

        <DocumentSection section="notifications">
          <NotificationsSettings />
        </DocumentSection>

        <DocumentSection section="appearance">
          <AppearanceSettings />
        </DocumentSection>

        <DocumentSection section="integrations">
          <IntegrationsSettings />
        </DocumentSection>

        <DocumentSection section="privacy-policies">
          <LegalAndDataRightsSection />
        </DocumentSection>

        <DocumentSection section="delete-account" danger headline={<DeleteHeadline />}>
          <AccountDeletionSettings />
        </DocumentSection>
        {/* Room below the last short sections, so each can scroll to the top when chosen in the nav. */}
        <div aria-hidden="true" className="h-[50vh]" />
      </div>
    </OpenSettingsSections>
  );
}
