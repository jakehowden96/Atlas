import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc", () => ({
  connectorCheckoutPullRequest: vi.fn(),
  gitCheckoutBranch: vi.fn(),
}));

import { connectorCheckoutPullRequest, gitCheckoutBranch } from "../ipc";
import { checkoutPullRequest } from "../pr-checkout";
import { connectors } from "../stores/connectors";
import type { Pr } from "../../types/generated/Pr";

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
  beforeEach(() => {
    vi.clearAllMocks();
    connectors.set([
      {
        info: { id: "github", name: "GitHub", kind: "pullRequests" },
        status: { kind: "linked", account: "octocat" },
      } as never,
    ]);
  });

  it("fetches a fork PR by number instead of checking out its branch name", async () => {
    // The fork's branch is called `main`; `git checkout main` would land on the
    // local main and start the session on the wrong code.
    await checkoutPullRequest("/w/r", "o/r", pr({ isCrossRepository: true, headRefName: "main" }));

    expect(connectorCheckoutPullRequest).toHaveBeenCalledWith("github", "/w/r", "o/r", 7);
    expect(gitCheckoutBranch).not.toHaveBeenCalled();
  });

  it("checks out a same-repo PR's branch by name", async () => {
    await checkoutPullRequest("/w/r", "o/r", pr({}));

    expect(gitCheckoutBranch).toHaveBeenCalledWith("/w/r", "feature");
    expect(connectorCheckoutPullRequest).not.toHaveBeenCalled();
  });

  it("lets a failed checkout reject so the caller can toast it", async () => {
    vi.mocked(connectorCheckoutPullRequest).mockRejectedValueOnce("dirty tree");
    await expect(checkoutPullRequest("/w/r", "o/r", pr({ isCrossRepository: true }))).rejects.toBe(
      "dirty tree",
    );
  });

  it("rejects a fork checkout when no connector is linked", async () => {
    connectors.set([]);
    await expect(checkoutPullRequest("/w/r", "o/r", pr({ isCrossRepository: true }))).rejects.toThrow(
      /Connect/,
    );
  });
});
