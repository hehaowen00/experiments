import { createStore } from 'solid-js/store';
import { showAlert } from '../../components/Modal';

export function createFileHistoryOps({ repoPath }) {
  const [fileHistory, setFileHistory] = createStore({
    open: false,
    filepath: null,
    commits: [],
    loading: false,
    selectedHash: null,
    diff: '',
    diffLoading: false,
  });

  async function openFileHistory(filepath) {
    setFileHistory({
      open: true,
      filepath,
      commits: [],
      loading: true,
      selectedHash: null,
      diff: '',
    });
    const result = await window.api.gitFileLog(repoPath, filepath, 100);
    if (!result.error) {
      setFileHistory({ commits: result.commits, loading: false });
    } else {
      setFileHistory({ loading: false });
      showAlert('File History Error', result.error);
    }
  }

  function closeFileHistory() {
    setFileHistory({
      open: false,
      filepath: null,
      commits: [],
      selectedHash: null,
      diff: '',
    });
  }

  async function selectFileHistoryCommit(hash) {
    setFileHistory({ selectedHash: hash, diff: '', diffLoading: true });
    const result = await window.api.gitFileShowAtCommit(
      repoPath,
      hash,
      fileHistory.filepath,
    );
    if (!result.error) {
      setFileHistory({
        diff: result.diff || '(no changes)',
        diffLoading: false,
      });
    } else {
      setFileHistory({
        diff: `Error: ${result.error}`,
        diffLoading: false,
      });
    }
  }

  return {
    fileHistory,
    openFileHistory,
    closeFileHistory,
    selectFileHistoryCommit,
  };
}
