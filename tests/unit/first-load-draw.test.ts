import assert from "node:assert/strict";
import test from "node:test";
import { createFirstLoadWindow } from "../../src/lib/ui/first-load";

test("the first-load window is open on the server and while the page first opens, then closes once for everyone", async () => {
  const win = createFirstLoadWindow(30, true);
  assert.equal(win.getServerSnapshot(), true, "server HTML always carries the drawing cells");
  assert.equal(win.getSnapshot(), true);
  let told = 0;
  const stop = win.subscribe(() => { told += 1; });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(win.getSnapshot(), false, "after the window, avatars are drawn still");
  assert.equal(told, 1);
  stop();
  assert.equal(createFirstLoadWindow(30, false).getSnapshot(), false, "no window outside the browser");
});
