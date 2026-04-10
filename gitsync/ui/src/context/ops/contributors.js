import { createStore } from 'solid-js/store';

export function createContributorOps({ repoPath }) {
  const [contributors, setContributors] = createStore({
    list: [],
    loading: false,
    repoActivity: [],
    selectedEmail: null,
    selectedActivity: [],
    activityLoading: false,
  });

  async function loadContributors() {
    setContributors({ loading: true, list: [], repoActivity: [], selectedEmail: null, selectedActivity: [] });
    const [result, actResult] = await Promise.all([
      window.api.gitContributors(repoPath),
      window.api.gitRepoActivity(repoPath),
    ]);
    if (!result.error) {
      setContributors('list', result.contributors);
    }
    if (!actResult.error) {
      setContributors('repoActivity', actResult.weeks);
    }
    setContributors('loading', false);
  }

  async function selectContributor(email) {
    if (contributors.selectedEmail === email) {
      setContributors({ selectedEmail: null, selectedActivity: [] });
      return;
    }
    setContributors({ selectedEmail: email, activityLoading: true, selectedActivity: [] });
    const result = await window.api.gitContributorActivity(repoPath, email);
    if (!result.error) {
      setContributors('selectedActivity', result.weeks);
    }
    setContributors('activityLoading', false);
  }

  function clearContributors() {
    setContributors({ list: [], loading: false, repoActivity: [], selectedEmail: null, selectedActivity: [], activityLoading: false });
  }

  return { contributors, loadContributors, selectContributor, clearContributors };
}
