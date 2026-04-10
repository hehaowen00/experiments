import { produce } from 'solid-js/store';

const LOG_PAGE_SIZE = 100;
const LOG_MAX_COMMITS = 2000;

export function createLogOps({
  repoPath,
  log,
  setLog,
  commitDetail,
  setCommitDetail,
  setExpandedDetailFiles,
  logBranch,
  logSearch,
  logTopoOrder,
  setLogBranches,
}) {
  async function loadLog() {
    const isInitial = log.commits.length === 0;
    if (isInitial) setLog('loading', true);
    const branch = logBranch();
    const search = logSearch();
    const allBranches = branch === '__all__';
    const branchName =
      branch === '__current__' || branch === '__all__' ? null : branch;
    const count = Math.max(log.commits.length, LOG_PAGE_SIZE);
    const result = await window.api.gitLog(
      repoPath,
      count + 1,
      allBranches,
      branchName,
      0,
      search,
      logTopoOrder(),
    );
    if (!result.error) {
      const hasMore = result.commits.length > count;
      const commits = hasMore ? result.commits.slice(0, count) : result.commits;
      setLog({
        commits,
        loading: false,
        loadingMore: false,
        hasMore,
      });
    } else {
      setLog('loading', false);
    }
  }

  async function loadMoreLog() {
    if (log.loadingMore || !log.hasMore) return;
    setLog('loadingMore', true);
    const branch = logBranch();
    const search = logSearch();
    const allBranches = branch === '__all__';
    const branchName =
      branch === '__current__' || branch === '__all__' ? null : branch;
    const skip = log.commits.length;
    const result = await window.api.gitLog(
      repoPath,
      LOG_PAGE_SIZE + 1,
      allBranches,
      branchName,
      skip,
      search,
      logTopoOrder(),
    );
    if (!result.error) {
      const hasMore = result.commits.length > LOG_PAGE_SIZE;
      const newCommits = hasMore ? result.commits.slice(0, LOG_PAGE_SIZE) : result.commits;
      if (newCommits.length === 0) {
        setLog({ loadingMore: false, hasMore: false });
        return;
      }
      const atLimit = log.commits.length + newCommits.length >= LOG_MAX_COMMITS;
      const remaining = LOG_MAX_COMMITS - log.commits.length;
      setLog(produce((s) => {
        const toAdd = atLimit ? newCommits.slice(0, remaining) : newCommits;
        for (let i = 0; i < toAdd.length; i++) {
          s.commits.push(toAdd[i]);
        }
        s.loadingMore = false;
        s.hasMore = !atLimit && hasMore;
      }));
    } else {
      setLog('loadingMore', false);
    }
  }

  async function loadLogBranches() {
    const result = await window.api.gitBranchList(repoPath);
    if (!result.error) setLogBranches(result.branches);
  }

  async function selectCommit(hash) {
    if (commitDetail.hash === hash) {
      setCommitDetail({
        hash: null,
        body: '',
        author: '',
        email: '',
        date: '',
        parents: [],
        files: [],
        loading: false,
      });
      return;
    }
    setCommitDetail({
      hash,
      loading: true,
      body: '',
      files: [],
      author: '',
      email: '',
      date: '',
      parents: [],
    });
    setExpandedDetailFiles({});
    const result = await window.api.gitShow(repoPath, hash);
    if (result.error) {
      setCommitDetail({
        hash,
        loading: false,
        body: result.error,
        files: [],
        author: '',
        email: '',
        date: '',
        parents: [],
      });
    } else {
      setCommitDetail({
        hash,
        body: result.body,
        author: result.author,
        email: result.email,
        date: result.date,
        parents: result.parents,
        files: result.files || [],
        loading: false,
      });
    }
  }

  async function loadFileDiff(hash, filepath) {
    const isMerge = commitDetail.parents.length > 1;
    const result = await window.api.gitShowFileDiff(
      repoPath,
      hash,
      filepath,
      isMerge,
    );
    if (!result.error) {
      setExpandedDetailFiles({ [filepath]: result.diff });
    }
  }

  return { loadLog, loadMoreLog, loadLogBranches, selectCommit, loadFileDiff };
}
