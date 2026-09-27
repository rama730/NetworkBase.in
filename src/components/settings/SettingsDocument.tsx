import type { LucideIcon } from "lucide-react";
import { Bell, Lock, Palette, Plug, Scale, Shield, User } from "lucide-react";
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

function DocumentSection({
  id,
  title,
  description,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-settings-section className="scroll-mt-6 space-y-5">
      <div className="flex items-start gap-3 border-b border-border pb-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <SettingsPageHeader title={title} description={description} level={2} />
      </div>
      {children}
    </section>
  );
}

export default function SettingsDocument() {
  return (
    <div data-settings-document className="mx-auto w-full max-w-[800px] space-y-10 pb-16">
      <SettingsPageHeader
        title="Settings"
        description="Manage your account, security, privacy, notifications, appearance, integrations, and data rights in one place."
      />

      <div className="space-y-16">
        <DocumentSection id="settings-account" icon={User} {...SETTINGS_SECTION_META.account}>
          <AccountSettings embedded />
        </DocumentSection>

        <DocumentSection id="settings-security" icon={Shield} {...SETTINGS_SECTION_META.security}>
          <SecuritySettings embedded />
        </DocumentSection>

        <DocumentSection id="settings-privacy" icon={Lock} {...SETTINGS_SECTION_META.privacy}>
          <PrivacySettings embedded />
        </DocumentSection>

        <DocumentSection id="settings-notifications" icon={Bell} {...SETTINGS_SECTION_META.notifications}>
          <NotificationsSettings embedded />
        </DocumentSection>

        <DocumentSection id="settings-appearance" icon={Palette} {...SETTINGS_SECTION_META.appearance}>
          <AppearanceSettings embedded />
        </DocumentSection>

        <DocumentSection id="settings-integrations" icon={Plug} {...SETTINGS_SECTION_META.integrations}>
          <IntegrationsSettings embedded />
        </DocumentSection>

        <DocumentSection
          id="settings-privacy-policies"
          icon={Scale}
          title="Legal and data rights"
          description="Review current terms and manage your account data rights."
        >
          <LegalAndDataRightsSection />
        </DocumentSection>

        <section id="settings-delete-account" className="scroll-mt-6">
          <AccountDeletionSettings />
        </section>
      </div>
    </div>
  );
}
