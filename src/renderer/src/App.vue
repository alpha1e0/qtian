<template>
  <!--
    根据 URL 参数 window=quick 路由到不同窗口根组件：
    - 主窗口（默认）：MainComponent（含 CustomTitleBar）
    - 快捷窗口：QuickModeWindow（含 QuickTitleBar）
    QuickModeWindow 异步加载以降低主窗口首屏开销。
  -->
  <component :is="rootComponent" />
</template>

<script>
import { defineAsyncComponent } from 'vue';
import MainComponent from './components/MainComponent.vue';

/** URL 参数值，标识快捷窗口（与主进程 QUICK_WINDOW_QUERY_VALUE 对应） */
const QUICK_WINDOW_QUERY_VALUE = 'quick';

export default {
  name: 'App',
  components: {
    MainComponent,
    QuickModeWindow: defineAsyncComponent(
      () => import('./components/quick-mode/QuickModeWindow.vue')
    ),
  },
  data() {
    return {
      /** 'main' 或 'quick'，由 mounted 时读取 URL 参数确定 */
      windowType: 'main',
    };
  },
  computed: {
    rootComponent() {
      return this.windowType === 'quick' ? 'QuickModeWindow' : 'MainComponent';
    },
  },
  mounted() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('window') === QUICK_WINDOW_QUERY_VALUE) {
      this.windowType = 'quick';
    }
  },
};
</script>

<style>
/*
 * 统一浅色主题设计令牌
 * --------------------------------------------------
 * 历史：原项目区分深色（todo-app / titlebar / sidebar）与浅色（chat / quick-mode）两套表面，
 * 通过保留 --surface-dark* / --text-on-dark* 命名但重映射为浅色值的方式，
 * 让所有现有 var(--surface-dark) 引用自动迁移，无需逐个文件替换。
 *
 * 配色基调：温润纸张色 + 靛蓝品牌色，营造编辑级「Aurora Library」质感。
 */
:root {
  /* === Surfaces（统一浅色：保留 *-dark 命名以减少迁移面） === */
  --surface-dark: #faf9f6;            /* 页面底层：温润米白（历史主进程底色，现为浅） */
  --surface-dark-secondary: #f3f1ec;  /* 侧栏 / 面板层：略深一档的暖灰白 */
  --surface-dark-hover: #ece9e0;      /* 悬停态：再深一档 */
  --surface-dark-active: #e2ded2;     /* 选中态：最深一档 */
  --surface-base: #faf9f6;            /* 主区域底色 */
  --surface-card: #ffffff;            /* 卡片 / 浮起表面 */

  /* === Text === */
  --text-on-dark: #1f1e2e;            /* 主文字（深墨色，在浅底上保持高对比） */
  --text-on-dark-secondary: #5f5e6f;  /* 次级文字 */
  --text-on-dark-muted: #908e9f;      /* 弱化文字 / 元信息 */
  --text-primary: #1f1e2e;
  --text-secondary: #5f5e6f;
  --text-muted: #908e9f;

  /* === Accent（保留靛蓝品牌色） === */
  --accent: #6366f1;
  --accent-hover: #7577f5;
  --accent-soft: rgba(99, 102, 241, 0.1);
  --accent-gradient: linear-gradient(135deg, #6366f1, #8b5cf6);
  /* 浅色主题下用作强调色文字（替代历史 #c7d2fe，后者在浅底上不可读） */
  --accent-text: #4f46e5;

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
  background: var(--surface-base);
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
