import { showAlert, showChoice } from '../../components/Modal';

export function createSyncOps({
  repoPath,
  status,
  setOperating,
  setOutput,
  reloadRepo,
}) {
  let lastRemote = null;

  async function pickRemote(title, description) {
    const remoteResult = await window.api.gitRemoteList(repoPath);
    const remoteList = remoteResult.remotes || [];
    if (remoteList.length === 0) return null;
    if (remoteList.length === 1) return remoteList[0].name;

    const choices = remoteList.map((r) => ({
      label: r.name + (r.name === lastRemote ? ' (last used)' : ''),
      value: r.name,
      description: r.fetch,
    }));
    if (lastRemote) {
      const idx = choices.findIndex((c) => c.value === lastRemote);
      if (idx > 0) choices.unshift(choices.splice(idx, 1)[0]);
    }

    return await showChoice(title, description, choices);
  }

  async function doPull(strategy, remote) {
    if (!remote) {
      remote = await pickRemote(
        'Pull from Remote',
        'Select which remote to pull from.',
      );
      if (!remote) return;
    }
    lastRemote = remote;

    setOperating('Pulling...');
    const result = await window.api.gitPull(repoPath, strategy, remote);
    setOperating('');
    if (result.error) {
      if (result.divergent) {
        const choice = await showChoice(
          'Divergent Branches',
          'Local and remote branches have diverged.',
          [
            {
              label: 'Fast-forward only',
              value: 'ff-only',
              description:
                'Fail if not possible without creating a merge commit',
            },
            {
              label: 'Rebase',
              value: 'rebase',
              description:
                'Replay local commits on top of remote changes',
            },
            {
              label: 'Merge',
              value: 'merge',
              description:
                'Create a merge commit combining both histories',
            },
          ],
        );
        if (choice) return doPull(choice, remote);
      } else {
        showAlert('Pull Failed', result.error);
      }
    } else {
      setOutput(result.output || 'Pull complete');
    }
    await reloadRepo();
  }

  async function doPush() {
    const remote = await pickRemote(
      'Push to Remote',
      'Select which remote to push to.',
    );
    if (!remote) return;
    lastRemote = remote;

    setOperating('Pushing...');
    let result;
    if (!status.upstream && status.branch) {
      result = await window.api.gitPushSetUpstream(
        repoPath,
        remote,
        status.branch,
      );
    } else {
      result = await window.api.gitPush(repoPath, remote);
    }
    setOperating('');
    if (result.error) {
      if (result.divergent) {
        const choice = await showChoice(
          'Push Rejected',
          "The remote has changes you don't have locally.",
          [
            {
              label: 'Pull (rebase) then push',
              value: 'pull-rebase',
              description:
                'Rebase local commits on top of remote, then push',
            },
            {
              label: 'Pull (merge) then push',
              value: 'pull-merge',
              description: 'Merge remote changes locally, then push',
            },
            {
              label: 'Force push',
              value: 'force',
              style: 'danger',
              description:
                'Overwrite remote with local (uses --force-with-lease)',
            },
          ],
        );
        if (choice === 'pull-rebase') {
          await doPull('rebase', remote);
          const retry = await window.api.gitPush(repoPath, remote);
          if (retry.error) showAlert('Push Failed', retry.error);
          else setOutput(retry.output || 'Push complete');
        } else if (choice === 'pull-merge') {
          await doPull('merge', remote);
          const retry = await window.api.gitPush(repoPath, remote);
          if (retry.error) showAlert('Push Failed', retry.error);
          else setOutput(retry.output || 'Push complete');
        } else if (choice === 'force') {
          setOperating('Force pushing...');
          const retry = await window.api.gitPushForce(repoPath, remote);
          setOperating('');
          if (retry.error) showAlert('Force Push Failed', retry.error);
          else setOutput(retry.output || 'Force push complete');
        }
      } else {
        showAlert('Push Failed', result.error);
      }
    } else {
      setOutput(result.output || 'Push complete');
    }
    await reloadRepo();
  }

  async function doFetch() {
    setOperating('Fetching...');
    const result = await window.api.gitFetch(repoPath);
    setOperating('');
    if (result.error) showAlert('Fetch Failed', result.error);
    else setOutput(result.output || 'Fetch complete');
    await reloadRepo();
  }

  return { doPull, doPush, doFetch, pickRemote };
}
