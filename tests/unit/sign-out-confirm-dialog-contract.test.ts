import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("shared confirmations follow the short-form dialog specification", () => {
  const confirm = source("src/components/ui/ConfirmDialog.tsx");
  const dialog = source("src/components/ui/dialog.tsx");

  assert.match(confirm, /size = "short"/);
  assert.match(confirm, /sm:max-w-\[460px\]/);
  assert.match(confirm, /text-\[20px\]/);
  assert.match(confirm, /text-\[15px\]/);
  assert.match(confirm, /sm:gap-2/);
  assert.match(confirm, /showCloseButton = false/);
  assert.match(confirm, /role="alertdialog"/);
  assert.match(confirm, /pendingLabel \?\? confirmLabel/);
  assert.match(confirm, /aria-busy=\{busy\}/);
  assert.match(confirm, /role="alert"/);
  assert.match(confirm, /onEscapeKeyDown/);
  assert.match(confirm, /onPointerDownOutside/);
  assert.match(confirm, /cancelButtonRef\.current\?\.focus\(\)/);
  assert.match(dialog, /bg-\[rgba\(13,17,20,0\.44\)\]/);
  assert.doesNotMatch(dialog, /focus-visible:ring-ring/);
});

test("all primary sign-out entry points share precise copy and behavior", () => {
  const signOut = source("src/components/auth/SignOutConfirmDialog.tsx");
  const topNav = source("src/components/layout/header/TopNav.tsx");
  const mobile = source("src/components/layout/header/MobileMenu.tsx");
  const account = source("src/components/settings/AccountSettings.tsx");

  assert.match(signOut, /title="Sign out on this device\?"/);
  assert.match(signOut, /You’ll need to sign in again to use NetworkBase on this device\./);
  assert.match(signOut, /pendingLabel="Signing out…"/);
  assert.match(signOut, /errorMessage="Failed to sign out\. Try again\."/);
  assert.match(signOut, /variant="destructive"/);

  assert.match(topNav, /<SignOutConfirmDialog/);
  assert.match(account, /<SignOutConfirmDialog/);
  assert.match(mobile, /<SignOutConfirmDialog/);
  assert.match(mobile, /props\.onClose\(\);\s*setShowSignOutConfirm\(true\);/);

  const mobileDialogClose = mobile.indexOf("</Dialog>");
  const mobileConfirm = mobile.indexOf("<SignOutConfirmDialog");
  assert.ok(mobileDialogClose > 0 && mobileConfirm > mobileDialogClose, "mobile confirmation must not be nested inside the navigation dialog");
});
