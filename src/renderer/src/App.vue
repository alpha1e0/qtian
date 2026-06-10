<template>
  <MainComponent />
</template>

<script>
import MainComponent from './components/MainComponent.vue';

export default {
  name: 'App',
  components: {
    MainComponent,
  },
};
</script>

<style>
:root {
  /* === Surfaces === */
  --surface-dark: #13121c;
  --surface-dark-secondary: #1c1b2e;
  --surface-dark-hover: #252440;
  --surface-dark-active: #2e2d4a;
  --surface-base: #f6f5f2;
  --surface-card: #ffffff;

  /* === Text === */
  --text-on-dark: #e4e4ed;
  --text-on-dark-secondary: #8b8aa0;
  --text-on-dark-muted: #5c5b72;
  --text-primary: #1a1a2e;
  --text-secondary: #5f6577;
  --text-muted: #9ca3b0;

  /* === Accent === */
  --accent: #6366f1;
  --accent-hover: #7577f5;
  --accent-soft: rgba(99, 102, 241, 0.1);
  --accent-gradient: linear-gradient(135deg, #6366f1, #8b5cf6);

  /* === Semantic === */
  --color-success: #10b981;
  --color-danger: #ef4444;
  --color-warning: #f59e0b;

  /* === Borders & Shadows === */
  --border-light: rgba(0, 0, 0, 0.06);
  --border-medium: rgba(0, 0, 0, 0.1);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.1);

  /* === Radius === */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;

  /* === Typography === */
  --font-sans: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Noto Sans SC', sans-serif;
  --font-mono: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace;

  /* === Element Plus Overrides === */
  --el-color-primary: #6366f1;
  --el-color-primary-light-3: #818cf8;
  --el-color-primary-light-5: #a5b4fc;
  --el-color-primary-light-7: #c7d2fe;
  --el-color-primary-light-8: #ddd6fe;
  --el-color-primary-light-9: #ede9fe;
  --el-color-primary-dark-2: #4f46e5;
  --el-border-radius-base: 8px;
  --el-border-color: rgba(0, 0, 0, 0.08);
  --el-border-color-light: rgba(0, 0, 0, 0.05);
}

#app {
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: var(--text-primary);
}

html,
body {
  height: 100%;
  margin: 0;
  background: var(--surface-dark);
}

#app {
  height: 100%;
}

/* Refined scrollbars */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.22);
}
</style>
