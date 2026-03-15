import { showAlert, showConfirm, showPrompt } from '../../components/Modal';

export function createRemoteOps({ repoPath, remotes, setRemotes }) {
  async function loadRemotes() {
    setRemotes('loading', true);
    const result = await window.api.gitRemoteList(repoPath);
    if (!result.error)
      setRemotes({ list: result.remotes, loading: false });
    else setRemotes('loading', false);
  }

  async function addRemote() {
    const name = await showPrompt('Remote Name', '', '', 'origin');
    if (!name) return;
    const url = await showPrompt('Remote URL', '', '', 'https://...');
    if (!url) return;
    const result = await window.api.gitRemoteAdd(
      repoPath,
      name.trim(),
      url.trim(),
    );
    if (result.error) showAlert('Error', result.error);
    else loadRemotes();
  }

  async function removeRemote(name) {
    if (
      await showConfirm(
        `Remove remote "${name}"?`,
        'This cannot be undone.',
      )
    ) {
      const result = await window.api.gitRemoteRemove(repoPath, name);
      if (result.error) showAlert('Error', result.error);
      else loadRemotes();
    }
  }

  async function editRemoteUrl(name, currentUrl) {
    const url = await showPrompt('Remote URL', currentUrl);
    if (!url) return;
    const result = await window.api.gitRemoteSetUrl(
      repoPath,
      name,
      url.trim(),
    );
    if (result.error) showAlert('Error', result.error);
    else loadRemotes();
  }

  return { loadRemotes, addRemote, removeRemote, editRemoteUrl };
}
