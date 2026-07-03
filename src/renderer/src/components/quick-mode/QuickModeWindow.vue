<template>
  <!--
    快捷窗口根组件
    布局：QuickTitleBar（32px）+ QuickModePage（flex:1）
    跨窗口导航经主进程中转：navigateToNormalMode → 主窗口 AiAssistantPage
  -->
  <div class="quick-window-layout">
    <QuickTitleBar
      :agent-name="agentName"
      @switch-to-normal="handleSwitchToNormal"
      @close="handleClose"
    />
    <QuickModePage
      ref="quickPage"
      class="quick-window-content"
      @navigate="handleNavigate"
      @agent-name-change="handleAgentNameChange"
    />
  </div>
</template>

<script>
import QuickTitleBar from './QuickTitleBar.vue';
import QuickModePage from './QuickModePage.vue';

/**
 * 快捷窗口根组件
 *
 * 职责：
 * - 渲染独立 TitleBar（关闭/切换到完整对话模式）
 * - 转发 QuickModePage 的导航请求到主进程（跨窗口）
 * - 上报 agentName 供 TitleBar 展示
 * - ESC 关闭窗口（主进程拦截为 hide，保留对话状态）
 */
export default {
  name: 'QuickModeWindow',
  components: { QuickTitleBar, QuickModePage },
  data() {
    return {
      /** 当前 Agent 展示名称（由 QuickModePage 上报） */
      agentName: 'AI 助手',
    };
  },
  mounted() {
    document.addEventListener('keydown', this.handleKeyDown);
  },
  unmounted() {
    document.removeEventListener('keydown', this.handleKeyDown);
  },
  methods: {
    /**
     * 全局键盘事件：ESC 关闭快捷窗口
     * Element Plus 下拉（el-select）会自行拦截 ESC 并 stopPropagation，
     * 因此展开下拉时按 ESC 仅关闭下拉，不会触发本回调。
     */
    handleKeyDown(event) {
      if (event.key === 'Escape') {
        this.handleClose();
      }
    },
    /**
     * QuickModePage 导航请求统一转发到主进程
     * payload: { message?, agentId?, llmConfig?, historyId? }
     */
    handleNavigate(_target, params) {
      // 快捷窗口内仅可能导航到 ai-assistant（完整对话模式）
      const payload = params || {};
      window.electron.navigateToNormalMode(payload);
    },
    /** TitleBar 切换按钮 → 委托 QuickModePage 按状态决定是否持久化历史 */
    handleSwitchToNormal() {
      this.$refs.quickPage?.requestSwitchToNormal();
    },
    handleAgentNameChange(name) {
      this.agentName = name;
    },
    handleClose() {
      // 主进程 close 事件被拦截为 hide，仅隐藏以保留对话状态
      window.electron.closeWindow();
    },
  },
};
</script>

<style scoped>
.quick-window-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--surface-base);
}

.quick-window-content {
  flex: 1;
  overflow: hidden;
}
</style>
