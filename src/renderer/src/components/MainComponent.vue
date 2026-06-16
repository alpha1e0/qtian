<template>
  <div class="main-layout">
    <CustomTitleBar :is-quick-mode="currentComponent === 'QuickModePage'" @switch-mode="handleSwitchMode" />
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
      currentComponent: 'QuickModePage',
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
     * 处理标题栏菜单的模式切换
     * @param {string} mode - 'quick' 或 'normal'
     */
    handleSwitchMode(mode) {
      if (mode === 'quick') {
        this.switchToQuickMode();
      } else if (mode === 'normal') {
        this.clearPending();
        this.switchToAiAssistant();
      } else if (mode === 'todo-app') {
        this.currentComponent = 'TodoAppPage';
      }
    },

    /**
     * 切换到快捷模式
     */
    switchToQuickMode() {
      this.currentComponent = 'QuickModePage';
      this.clearPending();
    },

    /**
     * Ctrl+Q 切换行为：普通模式→快捷模式，快捷模式→隐藏窗口
     */
    handleCtrlQToggle() {
      if (this.currentComponent === 'QuickModePage') {
        window.electron.closeWindow();
      } else {
        this.switchToQuickMode();
      }
    },

    /**
     * 切换到 AI 助手（普通模式）
     */
    switchToAiAssistant() {
      this.currentComponent = 'AiAssistantPage';
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
      console.log('导航到:', target, params);
      switch (target) {
        case 'quick-mode':
          this.switchToQuickMode();
          break;
        case 'ai-assistant':
          this.pendingMessage = params?.message || '';
          this.pendingAgentId = params?.agentId || '';
          this.pendingLlmConfig = params?.llmConfig || '';
          this.pendingHistoryId = params?.historyId || '';
          this.switchToAiAssistant();
          break;
        default:
          console.warn('未知的导航目标:', target);
      }
    },

    /**
     * 处理键盘快捷键
     */
    handleKeyDown(event) {
      if (event.ctrlKey && event.altKey) {
        if (event.key === 'a') {
          this.switchToAiAssistant();
        }
      }
    },
  },

  mounted() {
    window.electron.ipcRendererOn('switch-to-quick-mode', this.switchToQuickMode);
    window.electron.ipcRendererOn('switch-to-aiassistant', this.switchToAiAssistant);
    window.electron.ipcRendererOn('qtian:ctrl-q-toggle', this.handleCtrlQToggle);

    document.addEventListener('keydown', this.handleKeyDown);
  },

  unmounted() {
    window.electron.ipcRendererOff('switch-to-quick-mode', this.switchToQuickMode);
    window.electron.ipcRendererOff('switch-to-aiassistant', this.switchToAiAssistant);
    window.electron.ipcRendererOff('qtian:ctrl-q-toggle', this.handleCtrlQToggle);

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
  background: var(--surface-dark);
}

.main-content {
  flex: 1;
  overflow: hidden;
}
</style>
