<template>
  <div class="main-layout">
    <SideBar :active-mode="activeMode" :is-syncing="isSyncing" @select="handleSidebarSelect" />
    <div class="main-pane">
      <CustomTitleBar :title="titleBarTitle" />
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
  </div>
</template>

<script>
import { ElMessage } from 'element-plus';
import AiAssistantPage from './ai-assistant/AiAssistantPage.vue';
import TodoAppPage from './app-modules/todo-app/TodoAppPage.vue';
import NoteAppPage from './app-modules/note-app/NoteAppPage.vue';
import CustomTitleBar from './common/TitleBar.vue';
import SideBar from './common/SideBar.vue';

/**
 * 主窗口根组件
 *
 * 外壳结构：SideBar（48px 图标列）+ 主面板（TitleBar + 内容区）。
 * 模式切换统一由 SideBar 触发 → handleSidebarSelect 分发。
 *
 * 多窗口架构下，主窗口默认显示普通模式（AiAssistantPage）。
 * 快捷模式已抽离到独立窗口，通过 SideBar「快捷模式」按钮或 Ctrl+Q 唤起。
 *
 * 跨窗口导航：快捷窗口"切换到完整对话模式"时，经主进程中转，
 * 通过 'qtian:quick-to-normal-navigate' 事件携带 payload 到达此处，
 * 设置 pending* 数据并切换到 AiAssistantPage。
 *
 * 设计文档：docs/specs/003_main-window-shell-design.md §3.3
 */
export default {
  name: 'MainComponent',

  components: {
    AiAssistantPage,
    TodoAppPage,
    NoteAppPage,
    CustomTitleBar,
    SideBar,
  },

  data() {
    return {
      /** 默认显示普通模式（快捷模式已迁至独立窗口） */
      currentComponent: 'AiAssistantPage',
      pendingMessage: '',
      pendingAgentId: '',
      pendingLlmConfig: '',
      pendingHistoryId: '',
      /** 数据同步进行中（控制 SideBar 同步按钮旋转动效） */
      isSyncing: false,
    };
  },

  computed: {
    /**
     * 当前激活模式，决定 SideBar 哪个按钮高亮
     * @returns {'ai-assistant' | 'todo-app' | 'note-app'}
     */
    activeMode() {
      if (this.currentComponent === 'TodoAppPage') return 'todo-app';
      if (this.currentComponent === 'NoteAppPage') return 'note-app';
      return 'ai-assistant';
    },
    /**
     * TitleBar 动态功能名
     * @returns {string}
     */
    titleBarTitle() {
      if (this.currentComponent === 'TodoAppPage') return '待办';
      if (this.currentComponent === 'NoteAppPage') return '笔记';
      return 'AI 助手';
    },
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
     * SideBar 选择统一入口
     * @param {string} key - 'ai-assistant' | 'quick-mode' | 'todo-app' | 'note-app' | 'settings' | 'quit'
     */
    handleSidebarSelect(key) {
      switch (key) {
        case 'ai-assistant':
          this.clearPending();
          this.currentComponent = 'AiAssistantPage';
          break;
        case 'todo-app':
          this.currentComponent = 'TodoAppPage';
          break;
        case 'note-app':
          this.currentComponent = 'NoteAppPage';
          break;
        case 'quick-mode':
          this.openQuickWindow();
          break;
        case 'settings':
          this.openSettings();
          break;
        case 'sync':
          this.handleSync();
          break;
        case 'quit':
          this.quitApp();
          break;
        default:
          console.warn('未知的侧栏选择:', key);
      }
    },

    /**
     * 退出应用（经 preload 的 appQuit IPC）
     */
    quitApp() {
      window.electron.appQuit();
    },

    /**
     * 唤起独立快捷窗口
     */
    openQuickWindow() {
      window.electron.openQuickWindow();
    },

    // TODO(settings): 后续随设置面板实现补全，当前仅占位
    openSettings() {
      console.info('设置面板尚未实现');
    },

    /**
     * 数据同步（WebDAV）
     *
     * 流程：检查配置 → 未配置提示 → 已配置执行 syncAuto → 旋转动效 + 结果提示。
     * 同步进行中忽略重复点击（按钮已禁用，此处双保险）。
     */
    async handleSync() {
      if (this.isSyncing) return;

      // 后端未装配 sync API 时降级提示（如构建未包含同步模块）
      if (!window.sync) {
        ElMessage.warning('同步功能未就绪');
        return;
      }

      // 1. 检查 WebDAV 配置
      let cfg;
      try {
        cfg = await window.sync.getConfig();
      } catch (err) {
        console.error('读取同步配置失败', err);
        ElMessage.error('读取同步配置失败');
        return;
      }
      if (!cfg) {
        ElMessage.warning('请先配置 WebDAV 同步（设置 → 数据同步）');
        return;
      }

      // 2. 执行同步（旋转动效期间禁用按钮）
      this.isSyncing = true;
      try {
        const result = await window.sync.syncAuto();
        if (result.success) {
          if (result.warnings && result.warnings.some((w) => w.includes('无变化'))) {
            ElMessage.info('已是最新，无需同步');
          } else {
            const dirText = result.direction === 'upload' ? '上传' : '下载';
            ElMessage.success(`同步成功（${dirText} ${result.fileCount} 项）`);
          }
        } else {
          const errMsg = (result.errors && result.errors[0]) || '同步失败';
          ElMessage.error(errMsg);
        }
      } catch (err) {
        console.error('同步异常', err);
        ElMessage.error(err?.message || '同步失败');
      } finally {
        this.isSyncing = false;
      }
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
          this.openQuickWindow();
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
          // 统一走 SideBar 入口
          this.handleSidebarSelect('ai-assistant');
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
  flex-direction: row;
  height: 100vh;
  overflow: hidden;
  background: var(--surface-base);
}

.main-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.main-content {
  flex: 1;
  overflow: hidden;
}
</style>
