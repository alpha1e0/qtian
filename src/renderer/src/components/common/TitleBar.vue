<template>
  <div class="custom-titlebar">
    <!-- 可拖拽区域 + 图标 + 标题 -->
    <div class="titlebar-drag">
      <img :src="iconUrl" alt="Qtian" class="titlebar-icon" />
    </div>

    <!-- 内联菜单 -->
    <div class="titlebar-menus">
      <el-dropdown
        v-for="menu in menus"
        :key="menu.label"
        trigger="hover"
        @command="handleCommand"
      >
        <span class="menu-item">{{ menu.label }}</span>
        <template #dropdown>
          <el-dropdown-menu>
            <template v-for="item in menu.items" :key="item.id">
              <el-dropdown-item
                v-if="item.type !== 'separator'"
                :command="item.id"
                :divided="item.divided"
              >
                {{ item.label }}
              </el-dropdown-item>
              <div v-else class="menu-separator" />
            </template>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 窗口控制按钮 -->
    <div class="titlebar-controls">
      <button class="ctrl-btn" @click="handleMinimize" title="最小化" aria-label="最小化">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect y="5" width="12" height="1.5" fill="currentColor" />
        </svg>
      </button>
      <button v-if="!isQuickMode" class="ctrl-btn" @click="handleMaximize" title="最大化" aria-label="最大化">
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

/** 菜单定义 */
const menus = [
  {
    label: '功能',
    items: [
      { id: 'quick-mode', label: '快捷模式' },
      { id: 'normal-mode', label: '普通模式' },
      { id: 'sep1', type: 'separator' },
      { id: 'quit', label: '退出' },
    ],
  },
  {
    label: '应用',
    items: [
      { id: 'todo-app', label: '代办应用' },
    ],
  },
  {
    label: '帮助',
    items: [
      { id: 'about', label: '关于' },
    ],
  },
];

export default {
  name: 'CustomTitleBar',
  emits: ['switch-mode'],
  props: {
    isQuickMode: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      iconUrl,
      isMaximized: false,
      menus,
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
    /**
     * 处理菜单命令
     * @param {string} command - 菜单项 ID
     */
    handleCommand(command) {
      switch (command) {
        case 'quick-mode':
          this.$emit('switch-mode', 'quick');
          break;
        case 'normal-mode':
          this.$emit('switch-mode', 'normal');
          break;
        case 'todo-app':
          this.$emit('switch-mode', 'todo-app');
          break;
        case 'quit':
          window.electron.appQuit();
          break;
        case 'about':
          window.electron.showAbout();
          break;
      }
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

.titlebar-menus {
  margin-top: 2px;
  display: flex;
  align-items: center;
  margin-left: 4px;
  -webkit-app-region: no-drag;
  height: 100%;
}

.menu-item {
  padding: 0 10px;
  height: 28px;
  display: flex;
  align-items: center;
  cursor: pointer;
  color: var(--text-on-dark-secondary);
  font-size: 13px;
  border-radius: var(--radius-sm);
  transition: all 0.15s ease;
}

.menu-item:hover {
  background: var(--surface-dark-hover);
  color: var(--text-on-dark);
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

.menu-separator {
  height: 1px;
  background: var(--border-light);
  margin: 4px 0;
}
</style>
