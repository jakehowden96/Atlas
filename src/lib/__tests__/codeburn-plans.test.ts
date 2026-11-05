import { describe, expect, it } from "vitest";
import { resetCountdown } from "../components/stats/codeburn/plans";

describe("resetCountdown", () => {
  const now = Date.parse("2026-11-05T00:00:00Z");
  it("formats days, hours, minutes", () => {
    expect(resetCountdown("2026-11-07T04:30:00Z", now)).toBe("2d 4h");
    expect(resetCountdown("2026-11-05T03:20:00Z", now)).toBe("3h 20m");
    expect(resetCountdown("2026-11-05T00:12:00Z", now)).toBe("12m");
  });
  it("is now when past or invalid", () => {
    expect(resetCountdown("2026-11-04T00:00:00Z", now)).toBe("now");
    expect(resetCountdown("nope", now)).toBe("now");
  });
});
