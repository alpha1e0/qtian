<template>
  <!--
    快捷窗口自定义 TitleBar（合并原 QuickModePage 的 section-header）
    整体可拖拽，按钮区设为 no-drag 以允许点击
  -->
  <div class="quick-titlebar">
    <div class="titlebar-left">
      <img :src="iconUrl" alt="Qtian" class="titlebar-icon" />
      <span class="agent-name" :title="agentName">{{ agentName }}</span>
    </div>

    <div class="titlebar-controls">
      <el-tooltip content="切换到完整对话模式" placement="bottom" :show-after="300">
        <button
          class="ctrl-btn switch-btn"
          @click="handleSwitchToNormal"
          aria-label="切换到完整对话模式"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.2" />
            <line x1="3.5" y1="0.5" x2="0.5" y2="0.5" stroke="currentColor" stroke-width="1.2" />
            <line x1="0.5" y1="0.5" x2="0.5" y2="3.5" stroke="currentColor" stroke-width="1.2" />
            <line x1="8.5" y1="11.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.2" />
            <line x1="11.5" y1="11.5" x2="11.5" y2="8.5" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
      </el-tooltip>
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
 * 快捷窗口 TitleBar
 *
 * 合并原 QuickModePage 中的 section-header（agentName + 切换按钮），
 * 并承载窗口关闭控制。整体可拖拽移动窗口，按钮区禁止拖拽。
 */
export default {
  name: 'QuickTitleBar',
  props: {
    /** 当前 Agent 展示名称（由 QuickModePage 上报） */
    agentName: {
      type: String,
      default: 'AI 助手',
    },
  },
  emits: ['switch-to-normal', 'close'],
  data() {
    return { iconUrl };
  },
  methods: {
    handleSwitchToNormal() {
      this.$emit('switch-to-normal');
    },
    handleClose() {
      this.$emit('close');
    },
  },
};
</script>

<style scoped>
.quick-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 4px 0 8px;
  background: var(--surface-dark-secondary);
  border-bottom: 1px solid var(--border-light);
  -webkit-app-region: drag;
  user-select: none;
  flex-shrink: 0;
  font-size: 13px;
}

.titlebar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.titlebar-icon {
  width: 16px;
  height: 16px;
  opacity: 0.9;
  flex-shrink: 0;
}

.agent-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-on-dark-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

.titlebar-controls {
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
  height: 100%;
}

.ctrl-btn {
  width: 36px;
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

.switch-btn {
  width: 32px;
}

.switch-btn:hover {
  color: var(--accent);
}

.ctrl-btn-close:hover {
  background: #e81123;
  color: white;
}
</style>
