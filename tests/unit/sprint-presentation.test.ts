import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  sprintTimelinePersonName,
} from "@/lib/projects/sprint-presentation";

describe("sprint presentation", () => {
  it("uses neutral attribution fallbacks", () => {
    assert.equal(sprintTimelinePersonName(null), "A workspace member");
    assert.equal(sprintTimelinePersonName({ fullName: "  Ramanaidu Ch  " }), "Ramanaidu Ch");
  });
});
