import { showConfirm } from '../../components/Modal';

export function createDiscardOps({
  repoPath,
  status,
  diff,
  setDiff,
  refresh,
}) {
  async function discardFile(filepath) {
    if (
      await showConfirm(
        `Discard changes to "${filepath}"?`,
        'This cannot be undone.',
      )
    ) {
      await window.api.gitDiscard(repoPath, [filepath]);
      await refresh();
      if (diff.filepath === filepath)
        setDiff({ content: '', filepath: null });
    }
  }

  async function discardFiles(filepaths) {
    const label =
      filepaths.length === 1
        ? `"${filepaths[0]}"`
        : `${filepaths.length} files`;
    if (
      await showConfirm(
        `Discard changes to ${label}?`,
        'This cannot be undone.',
      )
    ) {
      await window.api.gitDiscard(repoPath, filepaths);
      await refresh();
      if (filepaths.includes(diff.filepath))
        setDiff({ content: '', filepath: null });
    }
  }

  async function discardStagedFiles(filepaths) {
    const label =
      filepaths.length === 1
        ? `"${filepaths[0]}"`
        : `${filepaths.length} files`;
    if (
      await showConfirm(
        `Discard staged changes to ${label}?`,
        'This will unstage and discard all changes. This cannot be undone.',
      )
    ) {
      await window.api.gitUnstage(repoPath, filepaths);
      const newFiles = filepaths.filter((fp) => {
        const f = status.files.find((s) => s.path === fp);
        return f && f.index === 'A';
      });
      const modifiedFiles = filepaths.filter(
        (fp) => !newFiles.includes(fp),
      );
      if (modifiedFiles.length > 0) {
        await window.api.gitDiscard(repoPath, modifiedFiles);
      }
      if (newFiles.length > 0) {
        await window.api.gitDeleteUntracked(repoPath, newFiles);
      }
      await refresh();
      if (filepaths.includes(diff.filepath))
        setDiff({ content: '', filepath: null });
    }
  }

  async function deleteUntrackedFiles(filepaths) {
    const label =
      filepaths.length === 1
        ? `"${filepaths[0]}"`
        : `${filepaths.length} files`;
    if (
      await showConfirm(`Delete ${label}?`, 'This cannot be undone.')
    ) {
      await window.api.gitDeleteUntracked(repoPath, filepaths);
      await refresh();
      if (filepaths.includes(diff.filepath))
        setDiff({ content: '', filepath: null });
    }
  }

  return {
    discardFile,
    discardFiles,
    discardStagedFiles,
    deleteUntrackedFiles,
  };
}
