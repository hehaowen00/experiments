const themes = {
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
      '--method-get': '#98c379',
      '--method-post': '#e5c07b',
      '--method-put': '#61afef',
      '--method-patch': '#c678dd',
      '--method-delete': '#e06c75',
    },
  },
};

const THEME_KEY = 'api-client-theme';

export function getThemeList() {
  return Object.entries(themes).map(([id, theme]) => ({
    id,
    name: theme.name,
  }));
}

export function getStoredThemeId() {
  const id = localStorage.getItem(THEME_KEY);
  return id && themes[id] ? id : 'onedark';
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
