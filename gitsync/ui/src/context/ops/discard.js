import { showConfirm } from '../../components/Modal';

export function createDiscardOps({
  repoPath,
  status,
  diff,
  setDiff,
  setOperating,
  refresh,
}) {
  async function withOperating(label, fn) {
    setOperating(label);
    try {
      await fn();
    } finally {
      setOperating('');
    }
  }

  async function discardFile(filepath) {
    if (
      await showConfirm(
        `Discard changes to "${filepath}"?`,
        'This cannot be undone.',
      )
    ) {
      await withOperating('Discarding...', async () => {
        await window.api.gitDiscard(repoPath, [filepath]);
        await refresh();
      });
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
      await withOperating('Discarding...', async () => {
        await window.api.gitDiscard(repoPath, filepaths);
        await refresh();
      });
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
      await withOperating('Discarding...', async () => {
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
      });
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
      await withOperating('Deleting...', async () => {
        await window.api.gitDeleteUntracked(repoPath, filepaths);
        await refresh();
      });
      if (filepaths.includes(diff.filepath))
        setDiff({ content: '', filepath: null });
    }
  }

  // Folder-level ops use a single pathspec so git walks the tree itself
  // instead of receiving thousands of explicit paths.
  async function discardFolder(dirPath, section) {
    const spec = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    const verb = section === 'untracked' ? 'Delete' : 'Discard changes in';
    if (
      !(await showConfirm(
        `${verb} "${dirPath}"?`,
        'This cannot be undone.',
      ))
    )
      return;

    await withOperating(
      section === 'untracked' ? 'Deleting...' : 'Discarding...',
      async () => {
        if (section === 'staged') {
          await window.api.gitUnstage(repoPath, [spec]);
          await window.api.gitDiscard(repoPath, [spec]);
          await window.api.gitDeleteUntracked(repoPath, [spec]);
        } else if (section === 'untracked') {
          await window.api.gitDeleteUntracked(repoPath, [spec]);
        } else {
          await window.api.gitDiscard(repoPath, [spec]);
        }
        await refresh();
      },
    );

    if (diff.filepath && diff.filepath.startsWith(spec))
      setDiff({ content: '', filepath: null });
  }

  return {
    discardFile,
    discardFiles,
    discardStagedFiles,
    deleteUntrackedFiles,
    discardFolder,
  };
}
