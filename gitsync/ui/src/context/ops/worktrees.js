import { showAlert, showConfirm } from '../../components/Modal';

export function createWorktreeOps({
  repoPath,
  repoData,
  worktrees,
  setWorktrees,
  setOperating,
  setOutput,
  onSwitchRepo,
}) {
  async function loadWorktrees() {
    setWorktrees('loading', true);
    const result = await window.api.gitWorktreeList(repoPath);
    if (!result.error)
      setWorktrees({ list: result.worktrees, loading: false });
    else setWorktrees('loading', false);
  }

  async function addWorktree(branchName, wtPath) {
    const branchResult = await window.api.gitBranchList(repoPath);
    const exists =
      branchResult.branches &&
      branchResult.branches.some(
        (b) =>
          b.name === branchName ||
          b.name === `remotes/origin/${branchName}`,
      );
    setOperating('Adding worktree...');
    const result = await window.api.gitWorktreeAdd(
      repoPath,
      wtPath,
      exists ? branchName : '',
      exists ? '' : branchName,
    );
    setOperating('');
    if (result.error) {
      showAlert('Add Worktree Failed', result.error);
      return false;
    }
    setOutput(result.output || `Worktree added at ${wtPath}`);
    loadWorktrees();
    return true;
  }

  async function removeWorktree(wtPath) {
    if (!(await showConfirm('Remove worktree?', wtPath))) return;
    setOperating('Removing worktree...');
    let result = await window.api.gitWorktreeRemove(
      repoPath,
      wtPath,
      false,
    );
    if (
      result.error &&
      result.error.includes('contains modified or untracked files')
    ) {
      if (
        await showConfirm(
          'Worktree has changes. Force remove?',
          'Untracked and modified files will be lost.',
        )
      ) {
        result = await window.api.gitWorktreeRemove(
          repoPath,
          wtPath,
          true,
        );
      }
    }
    setOperating('');
    if (result.error) showAlert('Remove Failed', result.error);
    else setOutput('Worktree removed');
    loadWorktrees();
  }

  async function pruneWorktrees() {
    const result = await window.api.gitWorktreePrune(repoPath);
    if (result.error) showAlert('Prune Failed', result.error);
    else setOutput('Stale worktrees pruned');
    loadWorktrees();
  }

  function openWorktree(wt) {
    onSwitchRepo({
      name: `${repoData.name} [${wt.branch || 'detached'}]`,
      path: wt.path,
    });
  }

  return {
    loadWorktrees,
    addWorktree,
    removeWorktree,
    pruneWorktrees,
    openWorktree,
  };
}
