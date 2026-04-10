import { showAlert, showConfirm } from '../../components/Modal';

export function createBuildCheckOps({
  repoPath,
  status,
  setOperating,
  setOutput,
}) {
  function hasGoFiles() {
    return status.files.some(
      (f) => f.path.endsWith('.go'),
    );
  }

  async function runBuildCheck() {
    setOperating('Running build check...');
    const result = await window.api.gitBuildCheck(repoPath);
    setOperating('');
    if (result.error) {
      showAlert('Build Check', result.error);
      return false;
    }
    if (result.ok) {
      setOutput(result.output || 'Build succeeded');
      return true;
    }
    showAlert('Build Failed', result.output);
    return false;
  }

  async function doBuildCheck() {
    await runBuildCheck();
  }

  async function prePushBuildCheck() {
    if (!hasGoFiles()) return true;
    const passed = await runBuildCheck();
    if (!passed) {
      return await showConfirm(
        'Build check failed',
        'Push anyway?',
      );
    }
    return true;
  }

  return { doBuildCheck, prePushBuildCheck };
}
