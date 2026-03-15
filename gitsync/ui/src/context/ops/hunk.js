import { showAlert, showConfirm } from '../../components/Modal';
import { parseDiffHunks } from '../../utils/diff';

export function createHunkOps({ repoPath, diff, refresh, viewDiff }) {
  function buildHunkPatch(hunkIndex) {
    if (!diff.header || !diff.content) return null;
    const hunks = parseDiffHunks(diff.content);
    if (hunkIndex < 0 || hunkIndex >= hunks.length) return null;
    const hunk = hunks[hunkIndex];
    return diff.header + '\n' + hunk.rawLines.join('\n') + '\n';
  }

  async function stageHunk(hunkIndex) {
    const patch = buildHunkPatch(hunkIndex);
    if (!patch) return;
    const result = await window.api.gitStageHunk(repoPath, patch);
    if (result?.error) {
      showAlert('Stage Hunk Failed', result.error);
      return;
    }
    await refresh();
    if (diff.filepath) viewDiff(diff.filepath, diff.staged);
  }

  async function unstageHunk(hunkIndex) {
    const patch = buildHunkPatch(hunkIndex);
    if (!patch) return;
    const result = await window.api.gitUnstageHunk(repoPath, patch);
    if (result?.error) {
      showAlert('Unstage Hunk Failed', result.error);
      return;
    }
    await refresh();
    if (diff.filepath) viewDiff(diff.filepath, diff.staged);
  }

  async function discardHunk(hunkIndex) {
    if (
      !(await showConfirm(
        'Discard this hunk?',
        'This cannot be undone.',
      ))
    )
      return;
    const patch = buildHunkPatch(hunkIndex);
    if (!patch) return;
    const result = await window.api.gitDiscardHunk(repoPath, patch);
    if (result?.error) {
      showAlert('Discard Hunk Failed', result.error);
      return;
    }
    await refresh();
    if (diff.filepath) viewDiff(diff.filepath, diff.staged);
  }

  return { buildHunkPatch, stageHunk, unstageHunk, discardHunk };
}
