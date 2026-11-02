import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const check = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...a: unknown[]) => check(...a) }));

import { checkForUpdate, isUpdaterConfigured, PUBKEY_PLACEHOLDER } from "../updater";

describe("updater", () => {
  beforeEach(() => check.mockReset());

  it("treats the placeholder and empty values as unconfigured", () => {
    expect(isUpdaterConfigured(PUBKEY_PLACEHOLDER)).toBe(false);
    expect(isUpdaterConfigured("")).toBe(false);
    expect(isUpdaterConfigured(undefined)).toBe(false);
    expect(isUpdaterConfigured("dW50cnVzdGVk")).toBe(true);
  });

  it("makes no network call while the shipped config is the placeholder", async () => {
    expect(await checkForUpdate()).toEqual({ kind: "notConfigured" });
    expect(check).not.toHaveBeenCalled();
  });
});
