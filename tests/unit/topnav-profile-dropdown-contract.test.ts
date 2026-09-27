import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("top-nav profile picture opens accessible dropdown with My Profile and Sign Out", () => {
  const topNav = source("src/components/layout/header/TopNav.tsx");

  // Profile avatar trigger is a dropdown trigger, not a raw Link
  assert.match(topNav, /<DropdownMenu open=\{isProfileMenuOpen\} onOpenChange=\{setIsProfileMenuOpen\}>/);
  assert.match(topNav, /<DropdownMenuTrigger asChild>/);
  assert.match(topNav, /data-testid="topnav-profile-menu-trigger"/);
  assert.match(topNav, /aria-label="User menu"/);
  assert.match(topNav, /<ProfileAvatar profile=\{profile\} size=\{32\} priority \/>/);
  assert.match(topNav, /<OnlineIndicator online size="sm" \/>/);

  // Dropdown content matches design specification popover geometry
  assert.match(topNav, /<DropdownMenuContent[^>]*align="end"[^>]*sideOffset=\{8\}/);
  assert.match(topNav, /bg-popover/);
  assert.match(topNav, /border-border/);

  // Header displays user info
  assert.match(topNav, /profile\?\.fullName \|\| profile\?\.username \|\| "Account"/);

  // My Profile option
  assert.match(topNav, /<DropdownMenuItem asChild>/);
  assert.match(topNav, /href=\{ROUTES\.MY_PROFILE\}/);
  assert.match(topNav, /<UserRound/);
  assert.match(topNav, />My Profile<\/span>/);

  // Sign Out option
  assert.match(topNav, /<DropdownMenuItem[^>]*variant="destructive"[^>]*onSelect=\{[^}]*setShowSignOutConfirm\(true\)[^}]*\}/);
  assert.match(topNav, /<LogOut/);
  assert.match(topNav, />Sign Out<\/span>/);

  // Sign out ConfirmDialog
  assert.match(topNav, /<ConfirmDialog[^>]*open=\{showSignOutConfirm\}/);
  assert.match(topNav, /title="Sign out of your account\?"/);
  assert.match(topNav, /confirmLabel="Sign out"/);
  assert.match(topNav, /variant="destructive"/);
  assert.match(topNav, /loading=\{isSigningOut\}/);
  assert.match(topNav, /onConfirm=\{handleSignOut\}/);
});
