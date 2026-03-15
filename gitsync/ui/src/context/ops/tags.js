import { showAlert, showConfirm } from '../../components/Modal';

export function createTagOps({ repoPath, tags, setTags, setOutput }) {
  async function loadTags() {
    setTags('loading', true);
    const result = await window.api.gitTagList(repoPath);
    if (!result.error) setTags({ list: result.tags, loading: false });
    else setTags('loading', false);
  }

  async function doCreateTag(name, message, target) {
    const result = await window.api.gitTagCreate(
      repoPath,
      name,
      message || '',
      target || '',
    );
    if (result.error) showAlert('Tag Failed', result.error);
    else loadTags();
  }

  async function doDeleteTag(name) {
    if (!(await showConfirm(`Delete tag "${name}"?`, ''))) return;
    const result = await window.api.gitTagDelete(repoPath, name);
    if (result.error) showAlert('Delete Tag Failed', result.error);
    else loadTags();
  }

  async function doPushTag(remote, name) {
    const result = await window.api.gitTagPush(
      repoPath,
      remote,
      name,
      false,
    );
    if (result.error) showAlert('Push Tag Failed', result.error);
    else setOutput(`Tag "${name}" pushed to ${remote}`);
  }

  async function doDeleteRemoteTag(remote, name) {
    if (
      !(await showConfirm(
        `Delete tag "${name}" from remote "${remote}"?`,
        '',
      ))
    )
      return;
    const result = await window.api.gitTagPush(
      repoPath,
      remote,
      name,
      true,
    );
    if (result.error)
      showAlert('Delete Remote Tag Failed', result.error);
    else setOutput(`Tag "${name}" deleted from ${remote}`);
  }

  return { loadTags, doCreateTag, doDeleteTag, doPushTag, doDeleteRemoteTag };
}
