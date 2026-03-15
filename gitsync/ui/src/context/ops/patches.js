import { showAlert } from '../../components/Modal';

export function createPatchOps({ repoPath, setOutput, refresh }) {
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

  return { exportStagedPatch, applyPatch };
}
