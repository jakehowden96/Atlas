import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc", () => ({
  ghPrCheckout: vi.fn(),
  gitCheckoutBranch: vi.fn(),
}));

import { ghPrCheckout, gitCheckoutBranch } from "../ipc";
import { checkoutPullRequest } from "../pr-checkout";
import type { Pr } from "../../types/prs";

function pr(overrides: Partial<Pr>): Pr {
  return {
    number: 7,
    title: "t",
    url: "https://github.com/o/r/pull/7",
    author: { login: "a" },
    createdAt: "",
    updatedAt: "",
    isDraft: false,
    isCrossRepository: false,
    headRefName: "feature",
    ciState: "none",
    reviewState: "none",
    reviewRequestLogins: [],
    commentsCount: 0,
    ...overrides,
  };
}

describe("checkoutPullRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches a fork PR by number instead of checking out its branch name", async () => {
    // The fork's branch is called `main`; `git checkout main` would land on the
    // local main and start the session on the wrong code.
    await checkoutPullRequest("/w/r", "o/r", pr({ isCrossRepository: true, headRefName: "main" }));

    expect(ghPrCheckout).toHaveBeenCalledWith("/w/r", 7, "o/r");
    expect(gitCheckoutBranch).not.toHaveBeenCalled();
  });

  it("checks out a same-repo PR's branch by name", async () => {
    await checkoutPullRequest("/w/r", "o/r", pr({}));

    expect(gitCheckoutBranch).toHaveBeenCalledWith("/w/r", "feature");
    expect(ghPrCheckout).not.toHaveBeenCalled();
  });

  it("lets a failed checkout reject so the caller can toast it", async () => {
    vi.mocked(ghPrCheckout).mockRejectedValueOnce("gh: not signed in");
    await expect(checkoutPullRequest("/w/r", "o/r", pr({ isCrossRepository: true }))).rejects.toBe(
      "gh: not signed in",
    );
  });
});
