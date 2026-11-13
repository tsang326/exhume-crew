import { describe, expect, it } from "vitest";
import { themeMode } from "../../ui/src/lib/theme";

describe("themeMode", () => {
  it("reads Crew's prefixed data-theme values", () => {
    expect(themeMode("kiro-dark")).toBe("dark");
    expect(themeMode("kiro-light")).toBe("light");
    expect(themeMode("dark")).toBe("dark");
    expect(themeMode("light")).toBe("light");
  });
  it("falls back to light for anything else", () => {
    expect(themeMode("")).toBe("light");
    expect(themeMode("darkish")).toBe("light");
    expect(themeMode(undefined)).toBe("light");
  });
});
