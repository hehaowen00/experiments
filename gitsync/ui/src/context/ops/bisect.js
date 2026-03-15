import { createStore } from 'solid-js/store';
import { showAlert } from '../../components/Modal';

export function createBisectOps({
  repoPath,
  setOperating,
  setOutput,
  reloadRepo,
}) {
  const [bisect, setBisect] = createStore({
    active: false,
    selecting: null,
  });

  function startBisectSelect(commit) {
    setBisect({
      active: false,
      selecting: { badHash: commit.hash, badShort: commit.short },
    });
  }

  async function finishBisectSelect(goodCommit) {
    const bad = bisect.selecting;
    if (!bad) return;
    setBisect({ selecting: null });
    setOperating('Starting bisect...');
    const result = await window.api.gitBisectStart(
      repoPath,
      bad.badHash,
      goodCommit.hash,
    );
    setOperating('');
    if (result.error) {
      showAlert('Bisect Failed', result.error);
    } else {
      setOutput(
        result.output ||
          'Bisect started — test this commit and mark good/bad',
      );
    }
    await reloadRepo();
  }

  function cancelBisectSelect() {
    setBisect({ selecting: null });
  }

  async function doBisectMark(verdict) {
    setOperating(`Marking ${verdict}...`);
    const result = await window.api.gitBisectMark(repoPath, verdict);
    setOperating('');
    if (result.error) {
      showAlert('Bisect Error', result.error);
    } else if (result.done) {
      setOutput(
        result.output || 'Bisect complete — found the bad commit',
      );
    } else {
      setOutput(result.output || `Marked ${verdict} — test this commit`);
    }
    await reloadRepo();
  }

  async function doBisectReset() {
    setOperating('Resetting bisect...');
    const result = await window.api.gitBisectReset(repoPath);
    setOperating('');
    if (result.error) showAlert('Bisect Reset Failed', result.error);
    else setOutput('Bisect reset');
    await reloadRepo();
  }

  return {
    bisect,
    startBisectSelect,
    finishBisectSelect,
    cancelBisectSelect,
    doBisectMark,
    doBisectReset,
  };
}
