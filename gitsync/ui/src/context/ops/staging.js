import { showAlert } from '../../components/Modal';

export function createStagingOps({
  repoPath,
  diff,
  setDiff,
  selectedFiles,
  setSelectedFiles,
  refresh,
  viewDiff,
}) {
  async function stageFile(filepath) {
    const result = await window.api.gitStage(repoPath, [filepath]);
    if (result?.error) {
      showAlert('Stage Failed', result.error);
      return;
    }
    await refresh();
    if (diff.filepath === filepath) viewDiff(filepath, true);
  }

  async function unstageFile(filepath) {
    const result = await window.api.gitUnstage(repoPath, [filepath]);
    if (result?.error) {
      showAlert('Unstage Failed', result.error);
      return;
    }
    await refresh();
    if (diff.filepath === filepath) viewDiff(filepath, false);
  }

  async function stageAll(files) {
    let result;
    if (files && files.length > 0) {
      result = await window.api.gitStage(
        repoPath,
        files.map((f) => f.path),
      );
    } else {
      result = await window.api.gitStageAll(repoPath);
    }
    if (result?.error) {
      showAlert('Stage Failed', result.error);
      return;
    }
    await refresh();
  }

  async function unstageAll() {
    const result = await window.api.gitUnstageAll(repoPath);
    if (result?.error) {
      showAlert('Unstage Failed', result.error);
      return;
    }
    await refresh();
  }

  async function stageSelected() {
    const files = [...selectedFiles()];
    if (files.length === 0) return;
    const result = await window.api.gitStage(repoPath, files);
    if (result?.error) {
      showAlert('Stage Failed', result.error);
      return;
    }
    setSelectedFiles(new Set());
    await refresh();
  }

  async function unstageSelected() {
    const files = [...selectedFiles()];
    if (files.length === 0) return;
    const result = await window.api.gitUnstage(repoPath, files);
    if (result?.error) {
      showAlert('Unstage Failed', result.error);
      return;
    }
    setSelectedFiles(new Set());
    await refresh();
  }

  return {
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    stageSelected,
    unstageSelected,
  };
}
