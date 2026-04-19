import { showAlert, showChoice, showPush, showPull } from '../../components/Modal';

export function createSyncOps({
  repoPath,
  status,
  setOperating,
  setOutput,
  reloadRepo,
  prePushBuildCheck,
}) {
  let lastRemote = null;
  let lastStrategy = null;

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
      const remoteResult = await window.api.gitRemoteList(repoPath);
      const remoteList = remoteResult.remotes || [];
      if (remoteList.length === 0) {
        showAlert('No Remotes', 'No remotes configured for this repository.');
        return;
      }
      const choice = await showPull(remoteList, lastRemote, lastStrategy);
      if (!choice) return;
      remote = choice.remote;
      if (!strategy) strategy = choice.strategy;
    }
    lastRemote = remote;
    if (strategy) lastStrategy = strategy;

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
            {
              label: 'Fast-forward only',
              value: 'ff-only',
              description:
                'Fail if not possible without creating a merge commit',
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
    if (prePushBuildCheck) {
      const proceed = await prePushBuildCheck();
      if (!proceed) return;
    }

    const remoteResult = await window.api.gitRemoteList(repoPath);
    const remoteList = remoteResult.remotes || [];
    if (remoteList.length === 0) {
      showAlert('No Remotes', 'No remotes configured for this repository.');
      return;
    }

    const choice = await showPush(remoteList, lastRemote, status.branch);
    if (!choice) return;
    const { remote, force, newBranch } = choice;
    lastRemote = remote;

    if (force) {
      setOperating('Force pushing...');
      const result = await window.api.gitPushForce(repoPath, remote);
      setOperating('');
      if (result.error) showAlert('Force Push Failed', result.error);
      else setOutput(result.output || 'Force push complete');
      await reloadRepo();
      return;
    }

    setOperating('Pushing...');
    let result;
    if (newBranch) {
      result = await window.api.gitPushSetUpstream(
        repoPath,
        remote,
        newBranch,
      );
    } else if (!status.upstream && status.branch) {
      result = await window.api.gitPushSetUpstream(
        repoPath,
        remote,
        status.branch,
      );
    } else {
      const headBefore = await window.api.gitRevParseHead(repoPath);
      setOperating('Pulling...');
      const pullResult = await window.api.gitPull(repoPath, null, remote);
      setOperating('');
      if (pullResult.error) {
        showAlert('Pull Failed', pullResult.error);
        await reloadRepo();
        return;
      }
      const headAfter = await window.api.gitRevParseHead(repoPath);
      if (!headBefore.error && !headAfter.error && headBefore.hash !== headAfter.hash) {
        setOutput('Pull brought in new changes — push aborted. Review the changes before pushing again.');
        await reloadRepo();
        return;
      }

      setOperating('Pushing...');
      result = await window.api.gitPush(repoPath, remote);
    }
    setOperating('');
    if (result.error) {
      showAlert('Push Failed', result.error);
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
