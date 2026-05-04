<template>
  <div class="custom-titlebar">
    <!-- 可拖拽区域 + 图标 + 标题 -->
    <div class="titlebar-drag">
      <img :src="'/icon.png'" alt="Qtian" class="titlebar-icon" />
      <span class="titlebar-title">Qtian</span>
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
      <button class="ctrl-btn" @click="handleMinimize" title="最小化">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect y="5" width="12" height="1.5" fill="currentColor" />
        </svg>
      </button>
      <button class="ctrl-btn" @click="handleMaximize" title="最大化">
        <svg v-if="isMaximized" width="12" height="12" viewBox="0 0 12 12">
          <rect x="2" y="0" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2" />
          <rect y="3" width="9" height="9" fill="white" stroke="currentColor" stroke-width="1.2" />
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 12 12">
          <rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button class="ctrl-btn ctrl-btn-close" @click="handleClose" title="关闭">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" stroke-width="1.4" />
          <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script>
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
    label: '帮助',
    items: [
      { id: 'about', label: '关于' },
    ],
  },
];

export default {
  name: 'CustomTitleBar',
  emits: ['switch-mode'],
  data() {
    return {
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
  height: 30px;
  background: #f0f0f0;
  border-bottom: 1px solid #dcdcdc;
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
  color: #555;
  font-weight: 500;
}

.titlebar-icon {
  width: 16px;
  height: 16px;
  margin-right: 6px;
}

.titlebar-menus {
  display: flex;
  align-items: center;
  margin-left: 16px;
  -webkit-app-region: no-drag;
  height: 100%;
}

.menu-item {
  padding: 0 10px;
  height: 30px;
  display: flex;
  align-items: center;
  cursor: pointer;
  color: #333;
  font-size: 13px;
  border-radius: 3px;
  transition: background 0.1s;
}

.menu-item:hover {
  background: rgba(0, 0, 0, 0.08);
}

.titlebar-controls {
  display: flex;
  margin-left: auto;
  -webkit-app-region: no-drag;
  height: 100%;
}

.ctrl-btn {
  width: 46px;
  height: 30px;
  border: none;
  background: transparent;
  color: #666;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.ctrl-btn:hover {
  background: #e0e0e0;
}

.ctrl-btn-close:hover {
  background: #e81123;
  color: white;
}

.menu-separator {
  height: 1px;
  background: #dcdcdc;
  margin: 4px 0;
}
</style>
