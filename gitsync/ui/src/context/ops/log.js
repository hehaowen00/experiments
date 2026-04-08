import { buildGraph, resetGraphColors } from '../../utils/graph';

const LOG_PAGE_SIZE = 100;
const LOG_MAX_COMMITS = 5000;

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
    const result = await window.api.gitLog(
      repoPath,
      LOG_PAGE_SIZE,
      allBranches,
      branchName,
      0,
      search,
      logTopoOrder(),
    );
    if (!result.error) {
      resetGraphColors();
      const { graph, maxCols, lanes } = buildGraph(result.commits, []);
      setLog({
        commits: result.commits,
        graph,
        maxCols,
        lanes,
        loading: false,
        loadingMore: false,
        hasMore: result.commits.length >= LOG_PAGE_SIZE,
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
      LOG_PAGE_SIZE,
      allBranches,
      branchName,
      skip,
      search,
      logTopoOrder(),
    );
    if (!result.error) {
      if (result.commits.length === 0) {
        setLog({ loadingMore: false, hasMore: false });
        return;
      }
      const {
        graph: newGraph,
        maxCols: newMaxCols,
        lanes,
      } = buildGraph(result.commits, log.lanes);
      const allCommits = [...log.commits, ...result.commits];
      const allGraph = [...log.graph, ...newGraph];
      const atLimit = allCommits.length >= LOG_MAX_COMMITS;
      setLog({
        commits: atLimit ? allCommits.slice(0, LOG_MAX_COMMITS) : allCommits,
        graph: atLimit ? allGraph.slice(0, LOG_MAX_COMMITS) : allGraph,
        maxCols: Math.max(log.maxCols, newMaxCols),
        lanes,
        loadingMore: false,
        hasMore: !atLimit && result.commits.length >= LOG_PAGE_SIZE,
      });
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
      setExpandedDetailFiles((prev) => ({ ...prev, [filepath]: result.diff }));
    }
  }

  return { loadLog, loadMoreLog, loadLogBranches, selectCommit, loadFileDiff };
}
