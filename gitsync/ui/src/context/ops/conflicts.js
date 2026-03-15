import { showAlert } from '../../components/Modal';

export function createConflictOps({ repoPath, setDiff, refresh }) {
  async function resolveOurs(filepaths) {
    const result = await window.api.gitResolveOurs(repoPath, filepaths);
    if (result.error) showAlert('Resolve Failed', result.error);
    else await refresh();
  }

  async function resolveTheirs(filepaths) {
    const result = await window.api.gitResolveTheirs(
      repoPath,
      filepaths,
    );
    if (result.error) showAlert('Resolve Failed', result.error);
    else await refresh();
  }

  async function viewConflictDiff(filepath) {
    const result = await window.api.gitDiffConflict(repoPath, filepath);
    if (result.error) {
      setDiff({
        content: `Error: ${result.error}`,
        filepath,
        staged: false,
      });
    } else {
      setDiff({
        content: result.diff || '(no changes)',
        filepath,
        staged: false,
      });
    }
  }

  return { resolveOurs, resolveTheirs, viewConflictDiff };
}
