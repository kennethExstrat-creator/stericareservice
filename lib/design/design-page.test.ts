import { describe, expect, it } from "vitest";
import { isDesignPageEnabled } from "./design-page";

describe("isDesignPageEnabled", () => {
  it("shows the page outside production", () => {
    expect(isDesignPageEnabled({ nodeEnv: "development", enableDesignPage: undefined })).toBe(true);
    expect(isDesignPageEnabled({ nodeEnv: "test", enableDesignPage: undefined })).toBe(true);
  });

  it("hides the page in production unless the flag is exactly 'true'", () => {
    expect(isDesignPageEnabled({ nodeEnv: "production", enableDesignPage: undefined })).toBe(false);
    expect(isDesignPageEnabled({ nodeEnv: "production", enableDesignPage: "" })).toBe(false);
    expect(isDesignPageEnabled({ nodeEnv: "production", enableDesignPage: "1" })).toBe(false);
    expect(isDesignPageEnabled({ nodeEnv: "production", enableDesignPage: "true" })).toBe(true);
  });
});
