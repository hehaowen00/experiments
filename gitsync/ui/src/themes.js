const themes = {
  dark: {
    name: 'AMOLED Dark',
    colors: {
      '--bg': '#000000',
      '--surface': '#0a0a0a',
      '--surface2': '#141414',
      '--border': '#222222',
      '--text': '#e0e0f0',
      '--text-dim': '#8888aa',
      '--accent': '#7c5cfc',
      '--accent-hover': '#9b7eff',
      '--danger': '#e05555',
      '--danger-hover': '#f06666',
      '--success': '#50c878',
      '--warning': '#f0a030',
      '--bg-hover': '#0d0d0d',
      '--method-get': '#50c878',
      '--method-post': '#f0a030',
      '--method-put': '#5090f0',
      '--method-patch': '#c070f0',
      '--method-delete': '#e05555',
    },
  },
  light: {
    name: 'Light',
    colors: {
      '--bg': '#f5f5f8',
      '--surface': '#ffffff',
      '--surface2': '#eaeaef',
      '--border': '#d0d0da',
      '--text': '#1e1e2e',
      '--text-dim': '#6e6e8a',
      '--accent': '#6040d0',
      '--accent-hover': '#7c5cfc',
      '--danger': '#d03030',
      '--danger-hover': '#e04040',
      '--success': '#2a8a4a',
      '--warning': '#c08020',
      '--bg-hover': '#eaeaef',
      '--method-get': '#2a8a4a',
      '--method-post': '#c08020',
      '--method-put': '#3060c0',
      '--method-patch': '#9050c0',
      '--method-delete': '#d03030',
    },
  },
  midnight: {
    name: 'Midnight',
    colors: {
      '--bg': '#0d1117',
      '--surface': '#161b22',
      '--surface2': '#21262d',
      '--border': '#30363d',
      '--text': '#c9d1d9',
      '--text-dim': '#6e7681',
      '--accent': '#58a6ff',
      '--accent-hover': '#79c0ff',
      '--danger': '#f85149',
      '--danger-hover': '#ff7b72',
      '--success': '#3fb950',
      '--warning': '#d29922',
      '--bg-hover': '#141920',
      '--method-get': '#3fb950',
      '--method-post': '#d29922',
      '--method-put': '#58a6ff',
      '--method-patch': '#bc8cff',
      '--method-delete': '#f85149',
    },
  },
  tokyonight: {
    name: 'Tokyo Night',
    colors: {
      '--bg': '#222436',
      '--surface': '#1e2030',
      '--surface2': '#2f334d',
      '--border': '#3b4261',
      '--text': '#c8d3f5',
      '--text-dim': '#636da6',
      '--accent': '#82aaff',
      '--accent-hover': '#a0c4ff',
      '--danger': '#ff757f',
      '--danger-hover': '#ff8a92',
      '--success': '#c3e88d',
      '--warning': '#ffc777',
      '--bg-hover': '#282d42',
      '--method-get': '#c3e88d',
      '--method-post': '#ffc777',
      '--method-put': '#82aaff',
      '--method-patch': '#c099ff',
      '--method-delete': '#ff757f',
    },
  },
  onedark: {
    name: 'One Dark',
    colors: {
      '--bg': '#282c34',
      '--surface': '#21252b',
      '--surface2': '#2c313a',
      '--border': '#3e4451',
      '--text': '#abb2bf',
      '--text-dim': '#636d83',
      '--accent': '#61afef',
      '--accent-hover': '#80c4ff',
      '--danger': '#e06c75',
      '--danger-hover': '#f07880',
      '--success': '#98c379',
      '--warning': '#e5c07b',
      '--bg-hover': '#2c313a',
      '--method-get': '#98c379',
      '--method-post': '#e5c07b',
      '--method-put': '#61afef',
      '--method-patch': '#c678dd',
      '--method-delete': '#e06c75',
    },
  },
  campbell: {
    name: 'Campbell',
    colors: {
      '--bg': '#000000',
      '--surface': '#1a1a1a',
      '--surface2': '#2a2a2a',
      '--border': '#3a3a3a',
      '--text': '#cccccc',
      '--text-dim': '#767676',
      '--accent': '#3a96dd',
      '--accent-hover': '#61b0ef',
      '--danger': '#c50f1f',
      '--danger-hover': '#e74856',
      '--success': '#13a10e',
      '--warning': '#c19c00',
      '--bg-hover': '#111111',
      '--method-get': '#13a10e',
      '--method-post': '#c19c00',
      '--method-put': '#3a96dd',
      '--method-patch': '#881798',
      '--method-delete': '#c50f1f',
    },
  },
};

const THEME_KEY = 'gitsync-theme';

const themeList = Object.entries(themes).map(([id, theme]) => ({
  id,
  name: theme.name,
}));

export function getThemeList() {
  return themeList;
}

export function getStoredThemeId() {
  const id = localStorage.getItem(THEME_KEY);
  return id && themes[id] ? id : 'tokyonight';
}

export function applyTheme(themeId) {
  const theme = themes[themeId];
  if (!theme) return;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(theme.colors)) {
    root.style.setProperty(prop, value);
  }
  localStorage.setItem(THEME_KEY, themeId);
}

export default themes;
