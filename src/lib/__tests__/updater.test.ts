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
    expect(isUpdaterConfigured("dW50cnVzdGVk")).toBe(true);
  });

  it("checks for updates now that the shipped config has a real pubkey", async () => {
    check.mockResolvedValue(null);
    expect(await checkForUpdate()).toEqual({ kind: "upToDate" });
    expect(check).toHaveBeenCalledOnce();
  });
});
