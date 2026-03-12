import { showAlert, showConfirm } from '../../components/Modal';

export function createStagingOps({ repoPath, status, diff, setDiff, setOutput, selectedFiles, setSelectedFiles, refresh }) {
  async function stageFile(filepath) {
    await window.api.gitStage(repoPath, [filepath]);
    await refresh();
    if (diff.filepath === filepath) viewDiff(filepath, true);
  }

  async function unstageFile(filepath) {
    await window.api.gitUnstage(repoPath, [filepath]);
    await refresh();
    if (diff.filepath === filepath) viewDiff(filepath, false);
  }

  async function stageAll(files) {
    if (files && files.length > 0) {
      await window.api.gitStage(repoPath, files.map(f => f.path));
    } else {
      await window.api.gitStageAll(repoPath);
    }
    await refresh();
  }

  async function unstageAll() {
    await window.api.gitUnstageAll(repoPath);
    await refresh();
  }

  async function stageSelected() {
    const files = [...selectedFiles()];
    if (files.length === 0) return;
    await window.api.gitStage(repoPath, files);
    setSelectedFiles(new Set());
    await refresh();
  }

  async function unstageSelected() {
    const files = [...selectedFiles()];
    if (files.length === 0) return;
    await window.api.gitUnstage(repoPath, files);
    setSelectedFiles(new Set());
    await refresh();
  }

  async function viewDiff(filepath, staged) {
    const file = status.files.find(f => f.path === filepath);
    const isUntracked = file && file.index === '?' && file.working === '?';
    let result;
    if (isUntracked) {
      result = await window.api.gitDiffUntracked(repoPath, filepath);
    } else {
      result = await window.api.gitDiff(repoPath, filepath, staged);
    }
    if (result.error) {
      setDiff({ content: `Error: ${result.error}`, filepath, staged });
    } else {
      setDiff({ content: result.diff || '(no changes)', filepath, staged });
    }
  }

  async function discardFile(filepath) {
    if (await showConfirm(`Discard changes to "${filepath}"?`, 'This cannot be undone.')) {
      await window.api.gitDiscard(repoPath, [filepath]);
      await refresh();
      if (diff.filepath === filepath) setDiff({ content: '', filepath: null });
    }
  }

  async function discardFiles(filepaths) {
    const label = filepaths.length === 1 ? `"${filepaths[0]}"` : `${filepaths.length} files`;
    if (await showConfirm(`Discard changes to ${label}?`, 'This cannot be undone.')) {
      await window.api.gitDiscard(repoPath, filepaths);
      await refresh();
      if (filepaths.includes(diff.filepath)) setDiff({ content: '', filepath: null });
    }
  }

  async function deleteUntrackedFiles(filepaths) {
    const label = filepaths.length === 1 ? `"${filepaths[0]}"` : `${filepaths.length} files`;
    if (await showConfirm(`Delete ${label}?`, 'This cannot be undone.')) {
      await window.api.gitDeleteUntracked(repoPath, filepaths);
      await refresh();
      if (filepaths.includes(diff.filepath)) setDiff({ content: '', filepath: null });
    }
  }

  async function resolveOurs(filepaths) {
    const result = await window.api.gitResolveOurs(repoPath, filepaths);
    if (result.error) showAlert('Resolve Failed', result.error);
    else await refresh();
  }

  async function resolveTheirs(filepaths) {
    const result = await window.api.gitResolveTheirs(repoPath, filepaths);
    if (result.error) showAlert('Resolve Failed', result.error);
    else await refresh();
  }

  async function viewConflictDiff(filepath) {
    const result = await window.api.gitDiffConflict(repoPath, filepath);
    if (result.error) {
      setDiff({ content: `Error: ${result.error}`, filepath, staged: false });
    } else {
      setDiff({ content: result.diff || '(no changes)', filepath, staged: false });
    }
  }

  async function exportStagedPatch() {
    const result = await window.api.gitExportStagedPatch(repoPath);
    if (result.error) showAlert('Export Failed', result.error);
    else if (result.ok) setOutput(`Patch saved to ${result.path}`);
  }

  async function applyPatch() {
    const result = await window.api.gitApplyPatch(repoPath);
    if (result.canceled) return;
    if (result.error) showAlert('Apply Patch Failed', result.error);
    else {
      setOutput(result.output || 'Patch applied');
      await refresh();
    }
  }

  return {
    stageFile, unstageFile, stageAll, unstageAll, stageSelected, unstageSelected,
    viewDiff, discardFile, discardFiles, deleteUntrackedFiles,
    resolveOurs, resolveTheirs, viewConflictDiff,
    exportStagedPatch, applyPatch,
  };
}
