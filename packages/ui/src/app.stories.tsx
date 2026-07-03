import type { Meta, StoryObj } from "@storybook/react";
import { TwoFAUApp } from "@/app";
import { MockVaultService } from "@/core/mock-vault-service";
import type { StoredAccount } from "@/core/types";

// base64 of the 20-byte RFC seed, so codes are real in the browser.
const secret = btoa("12345678901234567890");

function stored(id: string, issuer: string, label: string, type: "Totp" | "Hotp" = "Totp"): StoredAccount {
  return {
    account: { id, issuer, label, otp_type: type, algorithm: "Sha1", digits: 6, period: 30, counter: 0 },
    secret,
    modified_at: 0,
  };
}

const few: StoredAccount[] = [
  stored("1", "Google", "alice@gmail.com"),
  stored("2", "GitHub", "alice"),
  stored("3", "AWS", "root", "Hotp"),
];

const many: StoredAccount[] = Array.from({ length: 8 }, (_, i) =>
  stored(String(i), `Service ${i}`, `user${i}@example.com`),
);

const meta: Meta<typeof TwoFAUApp> = {
  title: "App/TwoFAUApp",
  component: TwoFAUApp,
  parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof TwoFAUApp>;

export const Default: Story = {
  render: () => <TwoFAUApp service={new MockVaultService({ seed: few })} onQuit={() => {}} />,
};

export const Empty: Story = {
  render: () => <TwoFAUApp service={new MockVaultService({ seed: [] })} onQuit={() => {}} />,
};

export const ManyAccountsWithSearch: Story = {
  render: () => <TwoFAUApp service={new MockVaultService({ seed: many })} onQuit={() => {}} />,
};

export const Locked: Story = {
  render: () => (
    <TwoFAUApp service={new MockVaultService({ seed: few, startUnlocked: false })} onQuit={() => {}} />
  ),
};

export const ExtensionCapabilities: Story = {
  name: "Extension (no screen-scan)",
  render: () => (
    <TwoFAUApp
      service={new MockVaultService({ seed: few, capabilities: { scanScreen: false, paste: true, qrImage: true } })}
    />
  ),
};
