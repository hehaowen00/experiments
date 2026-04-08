export function createDiffOps({ repoPath, status, setDiff }) {
  async function viewDiff(filepath, staged) {
    const file = status.files.find((f) => f.path === filepath);
    const isUntracked = file && file.index === '?' && file.working === '?';
    let result;
    if (isUntracked) {
      result = await window.api.gitDiffUntracked(repoPath, filepath);
      if (result.error) {
        setDiff({ content: `Error: ${result.error}`, filepath, staged, header: '', structural: false });
      } else {
        setDiff({
          content: result.diff || '(no changes)',
          filepath,
          staged,
          header: '',
          structural: false,
        });
      }
    } else {
      // Try structural diff first, fall back to standard
      const structural = await window.api.gitDiffStructural(repoPath, filepath, staged);
      if (!structural.error && structural.diff) {
        result = await window.api.gitDiffRaw(repoPath, filepath, staged);
        setDiff({
          content: structural.diff,
          filepath,
          staged,
          header: result?.header || '',
          structural: true,
        });
        return;
      }
      result = await window.api.gitDiffRaw(repoPath, filepath, staged);
      if (result.error) {
        setDiff({ content: `Error: ${result.error}`, filepath, staged, header: '', structural: false });
      } else {
        setDiff({
          content: result.diff || '(no changes)',
          filepath,
          staged,
          header: result.header || '',
          structural: false,
        });
      }
    }
  }

  return { viewDiff };
}
