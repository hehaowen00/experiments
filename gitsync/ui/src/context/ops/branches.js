import { showAlert, showConfirm, showPrompt } from '../../components/Modal';

export function createBranchOps({
  repoPath,
  status,
  branches,
  setOperating,
  setOutput,
  reloadRepo,
  loadBranches,
  pickRemote,
}) {
  async function checkoutBranch(name) {
    setOperating('Checking out...');
    const result = await window.api.gitCheckout(repoPath, name);
    setOperating('');
    if (result.error) {
      showAlert('Checkout Failed', result.error);
    } else {
      setOutput(result.output || `Switched to ${name}`);
      await reloadRepo();
      loadBranches();
    }
  }

  async function checkoutRemoteBranch(remoteBranch) {
    const parts = remoteBranch.replace(/^remotes\//, '').split('/');
    const remote = parts[0];
    const localName = parts.slice(1).join('/');
    const trackRef = `${remote}/${localName}`;
    const localExists = branches.list.some(
      (b) => !b.remote && b.name === localName,
    );
    if (localExists) return checkoutBranch(localName);
    setOperating('Checking out...');
    const result = await window.api.gitCheckoutRemote(
      repoPath,
      localName,
      trackRef,
    );
    setOperating('');
    if (result.error) {
      showAlert('Checkout Failed', result.error);
    } else {
      setOutput(
        result.output || `Checked out ${localName} tracking ${trackRef}`,
      );
      await reloadRepo();
      loadBranches();
    }
  }

  async function createBranch() {
    const name = await showPrompt('New Branch', '', '', 'branch-name');
    if (!name || !name.trim()) return;
    setOperating('Creating branch...');
    const result = await window.api.gitCheckoutNewBranch(
      repoPath,
      name.trim(),
    );
    setOperating('');
    if (result.error) {
      showAlert('Error', result.error);
    } else {
      setOutput(
        result.output || `Created and switched to ${name.trim()}`,
      );
      await reloadRepo();
      loadBranches();
    }
  }

  async function checkoutCommit(hash) {
    if (
      !(await showConfirm(
        `Checkout commit ${hash.substring(0, 8)}?`,
        'This will put you in detached HEAD state.',
        { confirmLabel: 'Checkout', confirmStyle: 'primary' },
      ))
    )
      return;
    setOperating('Checking out...');
    const result = await window.api.gitCheckout(repoPath, hash);
    setOperating('');
    if (result.error) {
      showAlert('Checkout Failed', result.error);
    } else {
      setOutput(
        result.output ||
          `Checked out ${hash.substring(0, 8)} (detached HEAD)`,
      );
      await reloadRepo();
      loadBranches();
    }
  }

  async function doPushBranch(branch) {
    const remote = await pickRemote(
      'Push Branch',
      `Push "${branch}" to remote.`,
    );
    if (!remote) return;
    setOperating('Pushing...');
    const result = await window.api.gitPushSetUpstream(
      repoPath,
      remote,
      branch,
    );
    setOperating('');
    if (result.error) showAlert('Push Failed', result.error);
    else setOutput(result.output || `Pushed "${branch}" to ${remote}`);
    await reloadRepo();
  }

  async function doDeleteBranch(branch) {
    if (!(await showConfirm(`Delete branch "${branch}"?`, ''))) return;
    setOperating('Deleting branch...');
    let result = await window.api.gitBranchDelete(repoPath, branch, false);
    if (result.error && result.error.includes('not fully merged')) {
      if (
        await showConfirm(
          `Branch "${branch}" is not fully merged. Force delete?`,
          'Unmerged changes will be lost.',
        )
      ) {
        result = await window.api.gitBranchDelete(repoPath, branch, true);
      }
    }
    setOperating('');
    if (result.error) showAlert('Delete Failed', result.error);
    else setOutput(result.output || `Branch "${branch}" deleted`);
    await reloadRepo();
    loadBranches();
  }

  async function doRenameBranch(oldName) {
    const newName = await showPrompt(
      'Rename Branch',
      '',
      oldName,
      'New branch name',
    );
    if (!newName || newName === oldName) return;
    setOperating('Renaming branch...');
    const result = await window.api.gitBranchRename(
      repoPath,
      oldName,
      newName,
    );
    setOperating('');
    if (result.error) showAlert('Rename Failed', result.error);
    else setOutput(result.output || `Branch renamed to "${newName}"`);
    await reloadRepo();
    loadBranches();
  }

  return {
    checkoutBranch,
    checkoutRemoteBranch,
    createBranch,
    checkoutCommit,
    doPushBranch,
    doDeleteBranch,
    doRenameBranch,
  };
}
