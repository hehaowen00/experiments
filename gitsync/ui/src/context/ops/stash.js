import { showAlert, showConfirm, showPrompt } from '../../components/Modal';

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
    const message = await showPrompt(
      'Stash Message',
      '',
      '',
      'Optional message',
    );
    if (message === null) return;
    setOperating('Stashing...');
    const result = await window.api.gitStashPush(
      repoPath,
      message || '',
      true,
    );
    setOperating('');
    if (result.error) showAlert('Stash Failed', result.error);
    else setOutput(result.output || 'Changes stashed');
    await refresh();
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
    await refresh();
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
    loadStashes();
  }

  async function doStashDrop(ref) {
    if (!(await showConfirm(`Drop "${ref}"?`, 'This cannot be undone.')))
      return;
    const result = await window.api.gitStashDrop(repoPath, ref);
    if (result.error) showAlert('Error', result.error);
    else setOutput('Stash dropped');
    loadStashes();
  }

  async function viewStashDiff(ref) {
    if (stashDetail.ref === ref) {
      setStashDetail({ ref: null, diff: '' });
      return;
    }
    const result = await window.api.gitStashShow(repoPath, ref);
    if (result.error) showAlert('Error', result.error);
    else setStashDetail({ ref, diff: result.diff });
  }

  return {
    loadStashes,
    doStashPush,
    doStashPop,
    doStashApply,
    doStashDrop,
    viewStashDiff,
  };
}
