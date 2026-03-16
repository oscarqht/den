import assert from "node:assert";
import { describe, it } from "node:test";

import { getCodexModelOptions } from "./codex-models.ts";

describe("getCodexModelOptions", () => {
  it("exposes xhigh reasoning for gpt-5.4", () => {
    const gpt54 = getCodexModelOptions(null).find((model) => model.id === "gpt-5.4");

    assert.ok(gpt54);
    assert.deepStrictEqual(gpt54.reasoningEfforts, ["low", "medium", "high", "xhigh"]);
  });
});
