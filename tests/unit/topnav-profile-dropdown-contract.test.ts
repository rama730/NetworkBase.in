import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("top-nav profile picture opens accessible dropdown with My profile and Sign out", () => {
  const topNav = source("src/components/layout/header/TopNav.tsx");

  // Profile avatar trigger is a dropdown trigger, not a raw Link
  assert.match(topNav, /<DropdownMenu open=\{isProfileMenuOpen\} onOpenChange=\{setIsProfileMenuOpen\}>/);
  assert.match(topNav, /<DropdownMenuTrigger asChild>/);
  assert.match(topNav, /data-testid="topnav-profile-menu-trigger"/);
  assert.match(topNav, /ref=\{profileMenuTriggerRef\}/);
  assert.match(topNav, /aria-label="User menu"/);
  // Shell redesign: a 36px pixel-person avatar in its own cell (whole 4px pixel cells).
  assert.match(topNav, /<ProfileAvatar profile=\{profile\} size=\{36\} priority \/>/);
  assert.match(topNav, /<PersonPresenceBadge userId=\{user\?\.id\} live size=\{16\}/);

  // Dropdown content matches design specification popover geometry
  assert.match(topNav, /<DropdownMenuContent[^>]*side="bottom"[^>]*align="end"[^>]*sideOffset=\{8\}[^>]*alignOffset=\{0\}[^>]*collisionPadding=\{12\}/);
  assert.match(topNav, /className="w-56[^\"]*rounded-\[8px\]/);
  assert.doesNotMatch(topNav, /className="w-48[^\"]*rounded-\[8px\]/);
  // The menu opens with you: your avatar, name and handle (shell redesign), and holds Theme now.
  assert.match(topNav, /<div className="flex items-center gap-2\.5 px-2 py-1\.5">\s*<ProfileAvatar profile=\{profile\} size=\{36\} \/>/);
  assert.match(topNav, /<span>Theme<\/span>/);
  assert.match(topNav, /bg-popover/);
  assert.match(topNav, /border-border/);

  // Header displays user info
  assert.match(topNav, /profile\?\.fullName \|\| profile\?\.username \|\| "Account"/);

  // My profile option
  assert.match(topNav, /<DropdownMenuItem asChild>/);
  assert.match(topNav, /href=\{ROUTES\.MY_PROFILE\}/);
  assert.match(topNav, /<UserRound/);
  assert.match(topNav, />My profile<\/span>/);

  // Sign out option
  assert.match(topNav, /<DropdownMenuItem[^>]*variant="destructive"[^>]*onSelect=\{[^}]*setShowSignOutConfirm\(true\)[^}]*\}/);
  assert.match(topNav, /<LogOut/);
  assert.match(topNav, />Sign out<\/span>/);

  // Every desktop entry point uses the shared sign-out confirmation contract.
  assert.match(topNav, /<SignOutConfirmDialog[^>]*open=\{showSignOutConfirm\}/);
  assert.match(topNav, /returnFocusRef=\{profileMenuTriggerRef\}/);
  assert.match(topNav, /onConfirm=\{signOut\}/);
});
