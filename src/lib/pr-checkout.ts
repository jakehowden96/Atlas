import { ghPrCheckout, gitCheckoutBranch } from "./ipc";
import type { Pr } from "../types/generated/Pr";

/**
 * Put the working tree at `path` on the PR's code.
 *
 * A fork PR's `headRefName` is the fork's branch name, which is often `main`:
 * checking that name out would silently land on the local `main`, not the PR.
 * `gh pr checkout` fetches the PR's own commits, so forks go through it. A PR
 * from a branch of the repo itself is a local branch by name, as before.
 */
export async function checkoutPullRequest(path: string, repo: string, pr: Pr): Promise<void> {
  if (pr.isCrossRepository) {
    await ghPrCheckout(path, pr.number, repo);
  } else {
    await gitCheckoutBranch(path, pr.headRefName);
  }
}
