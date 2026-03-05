type BranchOption = {
  name: string;
  current: boolean;
};

export function resolveInitialBaseBranchSelection(
  branches: BranchOption[],
  lastPickedBranch?: string | null,
  currentCheckedOutBranch?: string
): string {
  const normalizedLastPicked = (lastPickedBranch ?? '').trim();
  if (normalizedLastPicked && branches.some((branch) => branch.name === normalizedLastPicked)) {
    return normalizedLastPicked;
  }

  const normalizedCurrentCheckedOut = (currentCheckedOutBranch ?? '').trim();
  if (normalizedCurrentCheckedOut) {
    return normalizedCurrentCheckedOut;
  }

  const discoveredCurrent = branches.find((branch) => branch.current)?.name?.trim();
  return discoveredCurrent || '';
}
