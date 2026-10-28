import AccountSettings from "@/components/settings/AccountSettings";
import AccountDeletionSettings from "@/components/settings/AccountDeletionSettings";
import AppearanceSettings from "@/components/settings/AppearanceSettings";
import IntegrationsSettings from "@/components/settings/IntegrationsSettings";
import { LegalAndDataRightsSection } from "@/components/settings/LegalAndDataRightsSection";
import NotificationsSettings from "@/components/settings/NotificationsSettings";
import PrivacySettings from "@/components/settings/PrivacySettings";
import SecuritySettings from "@/components/settings/SecuritySettings";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SETTINGS_SECTION_META } from "@/constants/settings";
import { OpenSettingsSections } from "@/components/settings/ui/SettingsSectionLayout";

function DocumentSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-settings-section
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-6 space-y-8"
    >
      <SettingsPageHeader title={title} description={description} level={2} headingId={`${id}-heading`} />
      {children}
    </section>
  );
}

export default function SettingsDocument() {
  return (
    <OpenSettingsSections>
      <div data-settings-document className="mx-auto w-full max-w-4xl pb-16">
        <div className="space-y-16">
          <DocumentSection id="settings-account" {...SETTINGS_SECTION_META.account}>
            <AccountSettings />
          </DocumentSection>

          <DocumentSection id="settings-security" {...SETTINGS_SECTION_META.security}>
            <SecuritySettings />
          </DocumentSection>

          <DocumentSection id="settings-privacy" {...SETTINGS_SECTION_META.privacy}>
            <PrivacySettings />
          </DocumentSection>

          <DocumentSection id="settings-notifications" {...SETTINGS_SECTION_META.notifications}>
            <NotificationsSettings />
          </DocumentSection>

          <DocumentSection id="settings-appearance" {...SETTINGS_SECTION_META.appearance}>
            <AppearanceSettings />
          </DocumentSection>

          <DocumentSection id="settings-integrations" {...SETTINGS_SECTION_META.integrations}>
            <IntegrationsSettings />
          </DocumentSection>

          <DocumentSection id="settings-privacy-policies" {...SETTINGS_SECTION_META["privacy-policies"]}>
            <LegalAndDataRightsSection />
          </DocumentSection>

          <DocumentSection id="settings-delete-account" title="Delete account" description="Permanently remove your account and its data.">
            <AccountDeletionSettings />
          </DocumentSection>
        </div>
        {/* Room below the last short sections, so each can scroll to the top when chosen in the nav. */}
        <div aria-hidden="true" className="h-[50vh]" />
      </div>
    </OpenSettingsSections>
  );
}
