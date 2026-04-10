export function createDiffOps({ repoPath, status, setDiff, diffMethod }) {
  async function viewDiff(filepath, staged) {
    // Clear previous diff immediately to free memory before loading
    setDiff({ content: '', filepath, staged, header: '', structural: false });

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
      const method = diffMethod();

      // Try structural diff if method is 'auto' or 'structural'
      if (method === 'auto' || method === 'structural') {
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
