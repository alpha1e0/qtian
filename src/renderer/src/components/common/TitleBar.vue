<template>
  <div class="title-bar">
    <div class="title-bar-drag">
      <span class="title-bar-text">Qtian</span>
    </div>
    <div class="title-bar-controls">
      <button class="title-btn" @click="handleMinimize" aria-label="最小化">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect y="5" width="12" height="1.5" fill="currentColor" />
        </svg>
      </button>
      <button class="title-btn" @click="handleMaximize" aria-label="最大化">
        <svg v-if="isMaximized" width="12" height="12" viewBox="0 0 12 12">
          <rect x="2" y="0" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2" />
          <rect y="3" width="9" height="9" fill="white" stroke="currentColor" stroke-width="1.2" />
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 12 12">
          <rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button class="title-btn title-btn-close" @click="handleClose" aria-label="关闭">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" stroke-width="1.4" />
          <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'TitleBar',

  data() {
    return {
      isMaximized: false,
    };
  },

  async mounted() {
    this.isMaximized = await window.electron.isMaximized();
    // 监听窗口大小变化以更新最大化状态
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
.title-bar {
  display: flex;
  align-items: center;
  height: 32px;
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
  -webkit-app-region: drag;
  user-select: none;
  flex-shrink: 0;
}

.title-bar-drag {
  flex: 1;
  padding-left: 12px;
}

.title-bar-text {
  font-size: 12px;
  color: #999;
  font-weight: 500;
}

.title-bar-controls {
  display: flex;
  -webkit-app-region: no-drag;
}

.title-btn {
  width: 46px;
  height: 32px;
  border: none;
  background: transparent;
  color: #666;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.title-btn:hover {
  background: #e8e8e8;
}

.title-btn-close:hover {
  background: #e81123;
  color: white;
}
</style>
