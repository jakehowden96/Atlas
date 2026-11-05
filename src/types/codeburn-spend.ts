/** `codeburn spend --format flow-json|branch-json` (codeburn 0.9.27), fields Atlas reads. */
export interface SpendFlow {
  period: { label: string };
  models: { id: string; label: string; cost: number }[];
  projects: { id: string; label: string; cost: number }[];
  links: { model: string; project: string; cost: number }[];
}

export interface SpendBranches {
  period: { label: string };
  projects: {
    id: string;
    label: string;
    totalCost: number;
    branches: { branch: string; cost: number; calls: number; sessions: number }[];
  }[];
}
