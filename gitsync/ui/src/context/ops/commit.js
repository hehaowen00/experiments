import { showAlert } from '../../components/Modal';

export function createCommitOps({
  repoPath,
  commit,
  setCommit,
  setDiff,
  setOutput,
  reloadRepo,
  refresh,
  commitKey,
}) {
  async function doCommit() {
    const subject = commit.message.trim();
    const desc = commit.description.trim();
    if (!subject && !commit.amend) {
      showAlert('Error', 'Commit message is required');
      return;
    }

    const fullMsg = desc ? `${subject}\n\n${desc}` : subject;
    setCommit('running', true);

    let result;
    try {
      if (commit.amend) {
        result = await window.api.gitCommit(
          repoPath,
          fullMsg || commit.originalAmendMsg,
        );
      } else {
        result = await window.api.gitCommit(repoPath, fullMsg);
      }
    } catch (e) {
      setCommit('running', false);
      showAlert('Commit Failed', e.message);
      return;
    }
    setCommit('running', false);
    if (result.error) {
      showAlert('Commit Failed', result.error);
    } else {
      setCommit({
        message: '',
        description: '',
        amend: false,
        originalAmendMsg: '',
        amendHash: null,
      });
      localStorage.removeItem(commitKey);
      setDiff({ content: '', filepath: null, staged: false, header: '' });
      setOutput(result.output || 'Committed successfully');
      await reloadRepo();
    }
  }

  async function toggleAmend() {
    const newAmend = !commit.amend;
    if (newAmend) {
      const resetResult = await window.api.gitResetSoftHead(repoPath);
      if (resetResult.error) {
        showAlert('Error', resetResult.error);
        return;
      }
      setCommit('amend', true);
      setCommit('amendHash', resetResult.hash);
      const showResult = await window.api.gitShow(repoPath, resetResult.hash);
      if (showResult.body) {
        const parts = showResult.body.split(/\n\n(.*)$/s);
        const subject = parts[0] || '';
        const desc = parts[1] || '';
        setCommit('message', subject);
        setCommit('description', desc);
        setCommit(
          'originalAmendMsg',
          desc ? `${subject}\n\n${desc}` : subject,
        );
      }
      await refresh();
    } else {
      if (commit.amendHash) {
        await window.api.gitResetSoftTo(repoPath, commit.amendHash);
      }
      setCommit({
        message: '',
        description: '',
        amend: false,
        originalAmendMsg: '',
        amendHash: null,
      });
      await refresh();
    }
  }

  return { doCommit, toggleAmend };
}
