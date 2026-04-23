import { showAlert, showChoice, showConfirm, showPrompt } from '../../components/Modal';

export function createStashOps({
  repoPath,
  stashes,
  setStashes,
  stashDetail,
  setStashDetail,
  setCollapsedSections,
  setOperating,
  setOutput,
  refresh,
  reloadRepo,
}) {
  async function loadStashes() {
    setStashes('loading', true);
    const result = await window.api.gitStashList(repoPath);
    if (!result.error) {
      setStashes({ list: result.stashes, loading: false });
      setCollapsedSections((prev) => {
        const next = new Set(prev);
        if (result.stashes.length > 0) next.delete('stashes');
        else next.add('stashes');
        return next;
      });
    } else {
      setStashes('loading', false);
    }
  }

  async function doStashPush() {
    const mode = await showChoice(
      'Stash Changes',
      'What would you like to stash?',
      [
        {
          label: 'All changes',
          value: 'all',
          description: 'Stash staged and unstaged changes',
        },
        {
          label: 'Staged only',
          value: 'staged',
          description: 'Stash staged changes; leave working tree changes in place',
        },
        {
          label: 'Unstaged only',
          value: 'unstaged',
          description: 'Stash working tree changes; leave staged changes in the index',
        },
      ],
    );
    if (!mode) return;

    const message = await showPrompt(
      'Stash Message',
      '',
      '',
      'Optional message',
    );
    if (message === null) return;

    setOperating('Stashing...');
    let result;
    if (mode === 'staged') {
      result = await window.api.gitStashPushStaged(repoPath, message || '');
    } else if (mode === 'unstaged') {
      result = await window.api.gitStashPushUnstaged(repoPath, message || '');
    } else {
      result = await window.api.gitStashPush(repoPath, message || '', false);
    }
    setOperating('');
    if (result.error) showAlert('Stash Failed', result.error);
    else setOutput(result.output || 'Changes stashed');
    await reloadRepo();
    loadStashes();
  }

  async function doStashPop(ref) {
    setOperating('Popping stash...');
    const result = await window.api.gitStashPop(repoPath, ref);
    setOperating('');
    if (result.error) showAlert('Stash Pop Failed', result.error);
    else if (result.conflict)
      setOutput(result.output || 'Stash applied with conflicts', true);
    else setOutput(result.output || 'Stash popped');
    await reloadRepo();
    loadStashes();
  }

  async function doStashApply(ref) {
    setOperating('Applying stash...');
    const result = await window.api.gitStashApply(repoPath, ref);
    setOperating('');
    if (result.error) showAlert('Stash Apply Failed', result.error);
    else if (result.conflict)
      setOutput(result.output || 'Stash applied with conflicts', true);
    else setOutput(result.output || 'Stash applied');
    await refresh();
  }

  async function doStashDrop(ref) {
    if (!(await showConfirm(`Drop "${ref}"?`, 'This cannot be undone.')))
      return;
    const result = await window.api.gitStashDrop(repoPath, ref);
    if (result.error) showAlert('Error', result.error);
    else setOutput('Stash dropped');
    await reloadRepo();
    loadStashes();
  }

  async function viewStashDiff(ref) {
    if (stashDetail.ref === ref) {
      setStashDetail({ ref: null, files: [] });
      return;
    }
    const result = await window.api.gitStashShow(repoPath, ref);
    if (result.error) showAlert('Error', result.error);
    else setStashDetail({ ref, files: result.files || [] });
  }

  async function loadStashFileDiff(ref, filepath) {
    const result = await window.api.gitStashShowFileDiff(
      repoPath,
      ref,
      filepath,
    );
    return result.error ? null : result.diff;
  }

  return {
    loadStashes,
    doStashPush,
    doStashPop,
    doStashApply,
    doStashDrop,
    viewStashDiff,
    loadStashFileDiff,
  };
}
