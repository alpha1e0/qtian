<template>
  <div class="main-layout">
    <CustomTitleBar @switch-mode="handleSwitchMode" />
    <component
      :is="currentComponent"
      class="main-content"
      @navigate="handleNavigate"
      :initial-message="initialMessage"
      :initial-agent-id="initialAgentId"
      :initial-llm-config="initialLlmConfig"
      :initial-history-id="initialHistoryId"
    />
  </div>
</template>

<script>
import QuickModePage from './quick-mode/QuickModePage.vue';
import AiAssistantPage from './ai-assistant/AiAssistantPage.vue';
import TodoAppPage from './app-modules/todo-app/TodoAppPage.vue';
import CustomTitleBar from './common/TitleBar.vue';

/**
 * 主窗口根组件
 *
 * 多窗口架构下，主窗口默认显示普通模式（AiAssistantPage）。
 * 快捷模式已抽离到独立窗口，通过 Ctrl+Q 或菜单"功能→快捷模式"唤起。
 *
 * 跨窗口导航：快捷窗口"切换到完整对话模式"时，经主进程中转，
 * 通过 'qtian:quick-to-normal-navigate' 事件携带 payload 到达此处，
 * 设置 pending* 数据并切换到 AiAssistantPage。
 */
export default {
  name: 'MainComponent',

  components: {
    QuickModePage,
    AiAssistantPage,
    TodoAppPage,
    CustomTitleBar,
  },

  data() {
    return {
      /** 默认显示普通模式（快捷模式已迁至独立窗口） */
      currentComponent: 'AiAssistantPage',
      pendingMessage: '',
      pendingAgentId: '',
      pendingLlmConfig: '',
      pendingHistoryId: '',
    };
  },

  computed: {
    /**
     * 仅在切换到 AiAssistantPage 时传递初始消息
     */
    initialMessage() {
      return this.currentComponent === 'AiAssistantPage' ? this.pendingMessage : '';
    },
    /**
     * 仅在切换到 AiAssistantPage 时传递初始 Agent ID
     */
    initialAgentId() {
      return this.currentComponent === 'AiAssistantPage' ? this.pendingAgentId : '';
    },
    /**
     * 仅在切换到 AiAssistantPage 时传递初始模型配置
     */
    initialLlmConfig() {
      return this.currentComponent === 'AiAssistantPage' ? this.pendingLlmConfig : '';
    },
    /**
     * 仅在切换到 AiAssistantPage 时传递历史 ID（从快捷模式转来）
     */
    initialHistoryId() {
      return this.currentComponent === 'AiAssistantPage' ? this.pendingHistoryId : '';
    },
  },

  methods: {
    /**
     * 处理标题栏菜单的模式切换（主窗口内切换）
     * @param {string} mode - 'normal' / 'todo-app'
     */
    handleSwitchMode(mode) {
      if (mode === 'normal') {
        this.clearPending();
        this.currentComponent = 'AiAssistantPage';
      } else if (mode === 'todo-app') {
        this.currentComponent = 'TodoAppPage';
      }
      // 'quick' 由 TitleBar 自行调用 openQuickWindow，不再走本路径
    },

    /**
     * 清空待传递参数
     */
    clearPending() {
      this.pendingMessage = '';
      this.pendingAgentId = '';
      this.pendingLlmConfig = '';
      this.pendingHistoryId = '';
    },

    /**
     * 处理来自子组件的导航请求
     * @param {string} target - 目标组件名称
     * @param {object} params - 导航参数
     */
    handleNavigate(target, params) {
      switch (target) {
        case 'quick-mode':
          // 唤起独立快捷窗口
          window.electron.openQuickWindow();
          break;
        case 'ai-assistant':
          this.pendingMessage = params?.message || '';
          this.pendingAgentId = params?.agentId || '';
          this.pendingLlmConfig = params?.llmConfig || '';
          this.pendingHistoryId = params?.historyId || '';
          this.currentComponent = 'AiAssistantPage';
          break;
        default:
          console.warn('未知的导航目标:', target);
      }
    },

    /**
     * 接收来自快捷窗口的跨窗口导航（经主进程中转）
     * @param {object} payload - { message?, agentId?, llmConfig?, historyId? }
     */
    handleQuickToNormalNavigate(payload) {
      this.pendingMessage = payload?.message || '';
      this.pendingAgentId = payload?.agentId || '';
      this.pendingLlmConfig = payload?.llmConfig || '';
      this.pendingHistoryId = payload?.historyId || '';
      this.currentComponent = 'AiAssistantPage';
    },

    /**
     * 处理键盘快捷键
     */
    handleKeyDown(event) {
      if (event.ctrlKey && event.altKey) {
        if (event.key === 'a') {
          this.clearPending();
          this.currentComponent = 'AiAssistantPage';
        }
      }
    },
  },

  mounted() {
    // 监听跨窗口导航（快捷窗口 → 主进程 → 本窗口）
    window.electron.ipcRendererOn('qtian:quick-to-normal-navigate', this.handleQuickToNormalNavigate);

    document.addEventListener('keydown', this.handleKeyDown);
  },

  unmounted() {
    window.electron.ipcRendererOff('qtian:quick-to-normal-navigate', this.handleQuickToNormalNavigate);

    document.removeEventListener('keydown', this.handleKeyDown);
  },
};
</script>

<style scoped>
.main-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--surface-base);
}

.main-content {
  flex: 1;
  overflow: hidden;
}
</style>
