export function buildTree(files) {
  const root = { name: '', children: {}, files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      if (!node.children[dir]) {
        node.children[dir] = { name: dir, children: {}, files: [] };
      }
      node = node.children[dir];
    }
    node.files.push(file);
  }
  return root;
}

export function compactTree(node) {
  const dirKeys = Object.keys(node.children);
  for (const key of dirKeys) {
    node.children[key] = compactTree(node.children[key]);
  }
  if (dirKeys.length === 1 && node.files.length === 0 && node.name) {
    const childKey = dirKeys[0];
    const child = node.children[childKey];
    return {
      name: node.name + '/' + child.name,
      children: child.children,
      files: child.files,
    };
  }
  return node;
}

export function allFilesInTree(node) {
  const result = [...node.files];
  for (const child of Object.values(node.children)) {
    result.push(...allFilesInTree(child));
  }
  return result;
}
