import { createSignal } from 'solid-js';
import { showAlert, showChoice, showConfirm } from '../../components/Modal';

export function createMergeRebaseOps({
  repoPath,
  status,
  log,
  setOperating,
  setOutput,
  reloadRepo,
}) {
  const [interactiveRebase, setInteractiveRebase] = createSignal(null);

  async function doMerge(branch) {
    const strategy = await showChoice(
      `Merge "${branch}" into "${status.branch}"?`,
      '',
      [
        {
          label: 'Merge',
          description: 'Allow fast-forward if possible',
          value: 'ff',
        },
        {
          label: 'Merge (no ff)',
          description: 'Always create a merge commit',
          value: 'no-ff',
        },
      ],
    );
    if (!strategy) return;
    setOperating('Merging...');
    const opts = strategy === 'no-ff' ? { noFf: true } : {};
    const result = await window.api.gitMerge(repoPath, branch, opts);
    setOperating('');
    if (result.error) showAlert('Merge Failed', result.error);
    else if (result.conflict)
      setOutput(result.output || 'Merge conflicts detected', true);
    else setOutput(result.output || 'Merge complete');
    await reloadRepo();
  }

  async function doMergeAbort() {
    if (
      !(await showConfirm(
        'Abort merge?',
        'This will discard all merge changes.',
      ))
    )
      return;
    setOperating('Aborting merge...');
    const result = await window.api.gitMergeAbort(repoPath);
    setOperating('');
    if (result.error) showAlert('Error', result.error);
    else setOutput('Merge aborted');
    await reloadRepo();
  }

  async function doRebase(branch) {
    if (
      !(await showConfirm(
        `Rebase "${status.branch}" onto "${branch}"?`,
        '',
        { confirmLabel: 'Rebase', confirmStyle: 'primary' },
      ))
    )
      return;
    setOperating('Rebasing...');
    const result = await window.api.gitRebase(repoPath, branch);
    setOperating('');
    if (result.error) showAlert('Rebase Failed', result.error);
    else if (result.conflict)
      setOutput(
        result.output || 'Rebase conflicts detected — resolve and continue',
        true,
      );
    else setOutput(result.output || 'Rebase complete');
    await reloadRepo();
  }

  async function doRebaseContinue() {
    setOperating('Continuing rebase...');
    const result = await window.api.gitRebaseContinue(repoPath);
    setOperating('');
    if (result.error) showAlert('Rebase Continue Failed', result.error);
    else if (result.conflict)
      setOutput(
        result.output || 'More conflicts — resolve and continue',
        true,
      );
    else setOutput(result.output || 'Rebase complete');
    await reloadRepo();
  }

  async function doRebaseAbort() {
    if (
      !(await showConfirm(
        'Abort rebase?',
        'This will restore the branch to its original state.',
      ))
    )
      return;
    setOperating('Aborting rebase...');
    const result = await window.api.gitRebaseAbort(repoPath);
    setOperating('');
    if (result.error) showAlert('Error', result.error);
    else setOutput('Rebase aborted');
    await reloadRepo();
  }

  async function doCherryPick(hash) {
    if (
      !(await showConfirm(
        `Cherry-pick commit ${hash.substring(0, 8)}?`,
        '',
        { confirmLabel: 'Cherry-pick', confirmStyle: 'primary' },
      ))
    )
      return;
    setOperating('Cherry-picking...');
    const result = await window.api.gitCherryPick(repoPath, hash);
    setOperating('');
    if (result.error) showAlert('Cherry-pick Failed', result.error);
    else if (result.conflict)
      setOutput(
        result.output ||
          'Cherry-pick conflicts detected — resolve and commit',
        true,
      );
    else setOutput(result.output || 'Cherry-pick complete');
    await reloadRepo();
  }

  async function doRevert(hash) {
    if (
      !(await showConfirm(
        `Revert commit ${hash.substring(0, 8)}?`,
        'This creates a new commit that undoes the changes.',
        { confirmLabel: 'Revert', confirmStyle: 'primary' },
      ))
    )
      return;
    setOperating('Reverting...');
    const result = await window.api.gitRevert(repoPath, hash);
    setOperating('');
    if (result.error) showAlert('Revert Failed', result.error);
    else if (result.conflict)
      setOutput(
        result.output || 'Revert conflicts detected — resolve and commit',
        true,
      );
    else setOutput(result.output || 'Revert complete');
    await reloadRepo();
  }

  async function doDropCommit(hash) {
    if (
      !(await showConfirm(
        `Drop commit ${hash.substring(0, 8)}?`,
        'This will rebase to remove this commit. This cannot be easily undone.',
      ))
    )
      return;
    setOperating('Dropping commit...');
    const result = await window.api.gitDropCommit(repoPath, hash);
    setOperating('');
    if (result.error) showAlert('Drop Failed', result.error);
    else if (result.conflict)
      setOutput(
        result.output ||
          'Conflicts while dropping — resolve and continue rebase',
        true,
      );
    else setOutput(result.output || 'Commit dropped');
    await reloadRepo();
  }

  function startInteractiveRebase(baseHash) {
    const commits = [];
    for (const c of log.commits) {
      if (c.hash === baseHash) break;
      commits.push({
        action: 'pick',
        hash: c.short,
        fullHash: c.hash,
        subject: c.subject,
      });
    }
    if (commits.length === 0) return;
    commits.reverse();
    setInteractiveRebase({ baseHash, commits });
  }

  async function executeInteractiveRebase() {
    const state = interactiveRebase();
    if (!state) return;
    setInteractiveRebase(null);
    setOperating('Rebasing...');
    const result = await window.api.gitInteractiveRebase(
      repoPath,
      state.baseHash,
      state.commits,
    );
    setOperating('');
    if (result.error) showAlert('Rebase Failed', result.error);
    else if (result.conflict)
      setOutput(
        result.output || 'Rebase conflicts — resolve and continue',
        true,
      );
    else setOutput(result.output || 'Interactive rebase complete');
    await reloadRepo();
  }

  function cancelInteractiveRebase() {
    setInteractiveRebase(null);
  }

  return {
    doMerge,
    doMergeAbort,
    doRebase,
    doRebaseContinue,
    doRebaseAbort,
    doCherryPick,
    doRevert,
    doDropCommit,
    interactiveRebase,
    setInteractiveRebase,
    startInteractiveRebase,
    executeInteractiveRebase,
    cancelInteractiveRebase,
  };
}
