export function createDiffOps({ repoPath, status, setDiff }) {
  async function viewDiff(filepath, staged) {
    // Clear previous diff immediately to free memory before loading
    setDiff({ content: '', filepath, staged, header: '' });

    const file = status.files.find((f) => f.path === filepath);
    const isUntracked = file && file.index === '?' && file.working === '?';
    let result;
    if (isUntracked) {
      result = await window.api.gitDiffUntracked(repoPath, filepath);
      if (result.error) {
        setDiff({ content: `Error: ${result.error}`, filepath, staged, header: '' });
      } else {
        setDiff({
          content: result.diff || '(no changes)',
          filepath,
          staged,
          header: '',
        });
      }
    } else {
      result = await window.api.gitDiffRaw(repoPath, filepath, staged);
      if (result.error) {
        setDiff({ content: `Error: ${result.error}`, filepath, staged, header: '' });
      } else {
        setDiff({
          content: result.diff || '(no changes)',
          filepath,
          staged,
          header: result.header || '',
        });
      }
    }
  }

  return { viewDiff };
}
