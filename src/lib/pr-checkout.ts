import { get } from "svelte/store";
import { connectorCheckoutPullRequest, gitCheckoutBranch } from "./ipc";
import { byKind } from "./stores/connectors";
import type { Pr } from "../types/generated/Pr";

/**
 * Put the working tree at `path` on the PR's code.
 *
 * A fork PR's `headRefName` is the fork's branch name, which is often `main`:
 * checking that name out would silently land on the local `main`, not the PR.
 * The connector fetches the PR's own commits, so forks go through it. A PR
 * from a branch of the repo itself is a local branch by name, as before.
 */
export async function checkoutPullRequest(path: string, repo: string, pr: Pr): Promise<void> {
  if (pr.isCrossRepository) {
    const connector = get(byKind).pullRequests;
    if (!connector) throw new Error("Connect a pull request service to check out a fork's PR");
    await connectorCheckoutPullRequest(connector.info.id, path, repo, pr.number);
  } else {
    await gitCheckoutBranch(path, pr.headRefName);
  }
}
