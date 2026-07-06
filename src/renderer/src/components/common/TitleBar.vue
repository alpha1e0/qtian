<template>
  <div class="custom-titlebar">
    <!-- 可拖拽区域 + 图标 + 动态功能名 -->
    <div class="titlebar-drag">
      <img :src="iconUrl" alt="Qtian" class="titlebar-icon" />
      <span class="titlebar-title" :title="title">{{ title }}</span>
    </div>

    <!-- 窗口控制按钮 -->
    <div class="titlebar-controls">
      <button class="ctrl-btn" @click="handleMinimize" title="最小化" aria-label="最小化">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect y="5" width="12" height="1.5" fill="currentColor" />
        </svg>
      </button>
      <button class="ctrl-btn" @click="handleMaximize" title="最大化" aria-label="最大化">
        <svg v-if="isMaximized" width="12" height="12" viewBox="0 0 12 12">
          <rect x="2" y="0" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2" />
          <rect y="3" width="9" height="9" fill="white" stroke="currentColor" stroke-width="1.2" />
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 12 12">
          <rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button class="ctrl-btn ctrl-btn-close" @click="handleClose" title="关闭" aria-label="关闭">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" stroke-width="1.4" />
          <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script>
import iconUrl from '../../assets/icon.png';

/**
 * 主窗口自定义 TitleBar
 *
 * 极简结构：品牌图标 + 动态功能名 + 标准窗口控制按钮。
 * 历史「下拉菜单（功能 / 应用 / 帮助）」已随主窗口外壳重构移除，
 * 模式切换迁移至 SideBar，关于 / 退出后续随设置面板补回。
 *
 * 设计文档：docs/specs/003_main-window-shell-design.md §3.2
 */
export default {
  name: 'CustomTitleBar',
  props: {
    /**
     * 动态功能名（由 MainComponent 根据 currentComponent 计算）
     */
    title: {
      type: String,
      default: 'AI 助手',
    },
  },
  data() {
    return {
      iconUrl,
      isMaximized: false,
    };
  },
  async mounted() {
    this.isMaximized = await window.electron.isMaximized();
    window.electron.ipcRendererOn('window-maximize-state-changed', this.onMaximizeStateChanged);
  },
  unmounted() {
    window.electron.ipcRendererOff('window-maximize-state-changed', this.onMaximizeStateChanged);
  },
  methods: {
    async handleMinimize() {
      await window.electron.minimizeWindow();
    },
    async handleMaximize() {
      await window.electron.maximizeWindow();
      this.isMaximized = await window.electron.isMaximized();
    },
    async handleClose() {
      await window.electron.closeWindow();
    },
    onMaximizeStateChanged(state) {
      this.isMaximized = state;
    },
  },
};
</script>

<style scoped>
.custom-titlebar {
  display: flex;
  align-items: center;
  height: 32px;
  background: var(--surface-dark-secondary);
  border-bottom: 1px solid var(--border-light);
  -webkit-app-region: drag;
  user-select: none;
  flex-shrink: 0;
  font-size: 13px;
}

.titlebar-drag {
  padding-left: 12px;
  display: flex;
  align-items: center;
}

.titlebar-title {
  font-size: 12px;
  color: var(--text-on-dark-secondary);
  font-weight: 500;
  letter-spacing: 0.3px;
}

.titlebar-icon {
  width: 16px;
  height: 16px;
  margin-right: 6px;
  opacity: 0.9;
}

.titlebar-controls {
  display: flex;
  margin-left: auto;
  -webkit-app-region: no-drag;
  height: 100%;
}

.ctrl-btn {
  width: 46px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-on-dark-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.ctrl-btn:hover {
  background: var(--surface-dark-hover);
  color: var(--text-on-dark);
}

.ctrl-btn-close:hover {
  background: #e81123;
  color: white;
}
</style>
