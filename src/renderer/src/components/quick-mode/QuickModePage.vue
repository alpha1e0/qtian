<template>
  <div class="quick-mode-container">
    <!-- 初始状态：仅输入框 -->
    <div v-if="pageState === 'initial'" class="initial-state">
      <div class="chat-input-section">
        <!-- 顶部行：左侧Agent名称 + 右侧切换按钮 -->
        <div class="section-header">
          <el-text class="mx-1" tag="B">{{ currentAgentName }}</el-text>
          <!-- <span class="agent-label">{{ currentAgentName }}</span> -->
          <el-tooltip content="切换到完整对话模式" placement="left" :show-after="300">
            <el-button
              circle
              size="small"
              type="primary"
              class="switch-full-btn"
              @click="handleSwitchToNormalMode"
              aria-label="切换到完整对话模式"
            >
              <el-icon><FullScreen /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
        <el-input
          v-model="message"
          type="textarea"
          placeholder="输入你想问的问题..."
          class="chat-input"
          :rows="3"
          resize="none"
          @keydown="handleKeyDown"
          aria-label="快捷模式输入框"
        />
        <!-- 底部操作栏：Agent/模型选择 + 发送按钮 -->
        <div class="input-footer">
          <div class="input-selectors">
            <el-select
              v-model="selectedAgent"
              placeholder="选择Agent"
              size="small"
              :teleported="false"
              aria-label="快捷模式选择Agent"
            >
              <el-option
                v-for="agent in agentObjects"
                :key="agent.name"
                :label="agent.alias || agent.name"
                :value="agent.name"
              />
            </el-select>
            <el-select
              v-model="selectedLlmConfig"
              placeholder="选择模型"
              size="small"
              :teleported="false"
              aria-label="快捷模式选择模型"
            >
              <el-option
                v-for="config in llmConfigObjects"
                :key="config._configName"
                :label="config.alias || config.model"
                :value="config._configName"
              />
            </el-select>
          </div>
          <div class="input-actions">
            <el-button
              type="primary"
              size="small"
              round
              :disabled="!message.trim()"
              @click="handleSend"
              aria-label="发送"
            >
              发送(Ctrl+Enter)
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 回答状态：用户问题 + AI回答 -->
    <div v-else class="answering-state">
      <div class="answering-card">
        <!-- 顶部行：右上角按钮 -->
        <div class="section-header">
          <el-text class="mx-1" tag="B">{{ currentAgentName }}</el-text>
          <el-tooltip content="切换到完整对话模式" placement="left" :show-after="300">
            <el-button
              circle
              size="small"
              type="primary"
              @click="handleConvertToNormalMode"
              :disabled="!assistantAnswer || isChatting"
              aria-label="切换到完整对话模式"
            >
              <el-icon><FullScreen /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
        <el-divider />

        <!-- 用户问题（只读卡片） -->
        <div class="question-card">
          {{ userQuestion }}
        </div>

        <!-- AI 回答区域 -->
        <div class="answer-area">
          <div v-if="isChatting && !assistantAnswer" class="loading-indicator">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>思考中...</span>
          </div>
          <div v-if="assistantAnswer" class="answer-content" v-html="renderedAnswer"></div>
          <div v-if="isError" class="error-message">{{ errorMessage }}</div>
        </div>

        <!-- 底部操作按钮（图标） -->
        <div class="answer-actions" v-if="!isChatting">
          <el-tooltip content="重新生成" placement="top" :show-after="500">
            <el-button
              circle
              size="small"
              type="primary"
              @click="handleRegenerate"
              :disabled="!assistantAnswer"
              aria-label="重新生成"
            >
              <el-icon><RefreshRight /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="创建新对话" placement="top" :show-after="500">
            <el-button
              circle
              size="small"
              type="primary"
              @click="handleReset"
              aria-label="创建新对话"
            >
              <el-icon><Plus /></el-icon>
            </el-button>
          </el-tooltip>
        </div>

        <!-- 正在对话时显示停止按钮 -->
        <div class="answer-actions" v-else>
          <el-button
            type="danger"
            circle
            size="small"
            @click="handleStopChat"
            aria-label="停止"
          >
            <el-icon><VideoPause /></el-icon>
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { Loading, FullScreen, RefreshRight, Plus, VideoPause } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

/** 使用 markdown-it 渲染 Markdown 文本 */
function renderMarkdown(text) {
  if (!text) return '';
  return md.render(text);
}

/**
 * 生成快捷模式的临时 historyId
 * 每次会话使用唯一 ID，防止后端 auto-save 导致旧消息被加载
 */
function generateQuickHistoryId() {
  return `__quick_${Date.now()}__`;
}

/** 快捷模式窗口尺寸常量（含 custom titlebar 高度 ~32px） */
const QUICK_MODE_SIZES = {
  /** 初始状态：仅输入框 */
  initial: { width: 1000, height: 215 },
  /** 回答状态：用户问题 + AI回答 */
  answering: { width: 1000, height: 932 },
  /** 普通模式窗口尺寸 */
  normal: { width: 1600, height: 932 },
};

export default {
  name: 'QuickModePage',

  components: { Loading, FullScreen, RefreshRight, Plus, VideoPause },

  emits: ['navigate'],

  data() {
    return {
      /** 页面状态：initial / answering */
      pageState: 'initial',
      /** 输入消息 */
      message: '',
      /** 用户发送的问题（回答状态下只读展示） */
      userQuestion: '',
      /** AI 回答内容（流式拼接） */
      assistantAnswer: '',
      /** 是否正在对话 */
      isChatting: false,
      /** 是否出错 */
      isError: false,
      /** 错误信息 */
      errorMessage: '',
      /** 当前对话的完整消息列表 */
      messages: [],
      /** 当前会话的临时 historyId（每次发消息生成新的） */
      currentHistoryId: '',
      /** Agent 列表 */
      agents: [],
      agentObjects: [],
      selectedAgent: '',
      /** LLM 配置 */
      llmConfigs: [],
      llmConfigObjects: [],
      selectedLlmConfig: '',
    };
  },

  computed: {
    /** 当前 Agent 展示名称 */
    currentAgentName() {
      const agent = this.agentObjects.find((a) => a.name === this.selectedAgent);
      return agent ? agent.alias || agent.name : 'AI 助手';
    },
    /** Markdown 渲染后的回答 */
    renderedAnswer() {
      return renderMarkdown(this.assistantAnswer);
    },
  },

  async mounted() {
    await this.loadAgents();
    await this.loadLlmConfigs();

    // 监听对话流式事件
    window.electron.ipcRendererOn('qtian:ai:chat-chunk', this.onChatChunk);
    window.electron.ipcRendererOn('qtian:ai:chat-complete', this.onChatComplete);
    window.electron.ipcRendererOn('qtian:ai:chat-error', this.onChatError);

    // 进入快捷模式时调整窗口大小
    await this.resizeWindow('initial');
  },

  unmounted() {
    window.electron.ipcRendererOff('qtian:ai:chat-chunk', this.onChatChunk);
    window.electron.ipcRendererOff('qtian:ai:chat-complete', this.onChatComplete);
    window.electron.ipcRendererOff('qtian:ai:chat-error', this.onChatError);

    // 离开快捷模式时恢复窗口大小
    const normalSize = QUICK_MODE_SIZES.normal;
    window.electron.resizeWindow(normalSize.width, normalSize.height, true);
  },

  methods: {
    /**
     * 调整窗口大小
     * @param {'initial' | 'answering'} state - 页面状态
     */
    async resizeWindow(state) {
      const size = QUICK_MODE_SIZES[state];
      if (size) {
        await window.electron.resizeWindow(size.width, size.height, false);
      }
    },

    /**
     * 加载 Agent 列表
     */
    async loadAgents() {
      try {
        this.agents = await window.aiAssistant.listAgents();
        this.agentObjects = await Promise.all(
          this.agents.map(async (id) => {
            try {
              return await window.aiAssistant.getAgent(id);
            } catch {
              return { name: id, description: id, tools: [], instructions: '' };
            }
          })
        );
        if (this.agentObjects.length > 0) {
          // 优先使用 qtian.json 中配置的 default_agent
          const appConfig = await window.electron.getConfig();
          const defaultAgent = appConfig?.aiAssistant?.defaultAgent;
          const agentNames = this.agentObjects.map((a) => a.name);
          if (defaultAgent && agentNames.includes(defaultAgent)) {
            this.selectedAgent = defaultAgent;
          } else {
            this.selectedAgent = this.agentObjects[0].name;
          }
        }
      } catch (err) {
        console.error('快捷模式加载Agent失败:', err);
      }
    },

    /**
     * 加载 LLM 配置列表
     */
    async loadLlmConfigs() {
      try {
        this.llmConfigs = await window.aiAssistant.listLlmConfigs();
        this.llmConfigObjects = await Promise.all(
          this.llmConfigs.map(async (name) => {
            try {
              const config = await window.aiAssistant.getLlmConfig(name);
              return { ...config, _configName: name };
            } catch {
              return { _configName: name, model: name };
            }
          })
        );
        if (this.llmConfigs.length > 0) {
          // 优先使用 qtian.json 中配置的 default_llm_config
          const appConfig = await window.electron.getConfig();
          const defaultConfig = appConfig?.aiAssistant?.defaultLlmConfig;
          if (defaultConfig && this.llmConfigs.includes(defaultConfig)) {
            this.selectedLlmConfig = defaultConfig;
          } else {
            this.selectedLlmConfig = this.llmConfigs[0];
          }
        }
      } catch (err) {
        console.error('快捷模式加载模型配置失败:', err);
      }
    },

    /**
     * Ctrl+Enter 发送
     */
    handleKeyDown(event) {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        this.handleSend();
      }
    },

    /**
     * 发送消息
     */
    async handleSend() {
      const trimmedMessage = this.message.trim();
      if (!trimmedMessage || this.isChatting) return;

      this.userQuestion = trimmedMessage;
      this.message = '';
      this.assistantAnswer = '';
      this.isError = false;
      this.errorMessage = '';
      this.messages = [];
      this.pageState = 'answering';
      this.isChatting = true;
      this.resizeWindow('answering');

      // 每次会话使用唯一的 historyId，避免后端 auto-save 加载旧消息
      this.currentHistoryId = generateQuickHistoryId();

      try {
        // 初始化对话（使用临时 historyId，不持久化）
        await window.aiAssistant.initChat(
          this.selectedAgent,
          this.currentHistoryId,
          this.selectedLlmConfig
        );

        // 发送消息
        await window.aiAssistant.chatMessage(
          this.selectedAgent,
          this.currentHistoryId,
          trimmedMessage
        );
      } catch (err) {
        this.isChatting = false;
        this.isError = true;
        this.errorMessage = err.message || '发送失败';
        console.error('快捷模式发送失败:', err);
      }
    },

    /**
     * 重新生成回答
     */
    async handleRegenerate() {
      if (!this.userQuestion || this.isChatting) return;

      this.assistantAnswer = '';
      this.isError = false;
      this.errorMessage = '';
      this.isChatting = true;

      try {
        // 重新初始化会话（使用新 historyId 确保干净状态）
        this.currentHistoryId = generateQuickHistoryId();
        await window.aiAssistant.initChat(
          this.selectedAgent,
          this.currentHistoryId,
          this.selectedLlmConfig
        );
        await window.aiAssistant.chatMessage(
          this.selectedAgent,
          this.currentHistoryId,
          this.userQuestion
        );
      } catch (err) {
        this.isChatting = false;
        this.isError = true;
        this.errorMessage = err.message || '重新生成失败';
        console.error('快捷模式重新生成失败:', err);
      }
    },

    /**
     * 停止对话
     */
    async handleStopChat() {
      try {
        await window.aiAssistant.stopChat(this.selectedAgent, this.currentHistoryId);
        this.isChatting = false;
      } catch (err) {
        console.error('停止对话失败:', err);
      }
    },

    /**
     * 切换到普通模式（不带消息）
     */
    handleSwitchToNormalMode() {
      this.$emit('navigate', 'ai-assistant', {
        agentId: this.selectedAgent,
        llmConfig: this.selectedLlmConfig,
      });
    },

    /**
     * 重置为初始状态
     */
    handleReset() {
      this.pageState = 'initial';
      this.resizeWindow('initial');
      this.userQuestion = '';
      this.assistantAnswer = '';
      this.isError = false;
      this.errorMessage = '';
      this.messages = [];
      this.isChatting = false;
    },

    /**
     * 转换为普通模式：创建持久化历史，导航到 AI 助手页面
     */
    async handleConvertToNormalMode() {
      if (this.messages.length === 0) return;

      try {
        const historyId = `chat_${Date.now()}`;
        const title = this.userQuestion.length > 20
          ? this.userQuestion.substring(0, 20) + '...'
          : this.userQuestion;

        const historyData = {
          id: historyId,
          agent_id: this.selectedAgent,
          title: title,
          // Vue reactive Proxy 无法通过 IPC structured clone，需转为纯对象
          messages: JSON.parse(JSON.stringify(this.messages)),
          created_at: Date.now(),
          updated_at: Date.now(),
        };

        await window.aiAssistant.createHistory(this.selectedAgent, historyId, historyData);

        // 导航到普通模式，携带历史信息
        this.$emit('navigate', 'ai-assistant', {
          agentId: this.selectedAgent,
          historyId: historyId,
          llmConfig: this.selectedLlmConfig,
        });

        // 重置状态
        this.handleReset();
      } catch (err) {
        console.error('转换到普通模式失败:', err);
        ElMessage.error('转换失败，请重试');
      }
    },

    // === 流式事件回调 ===

    onChatChunk({ chunk }) {
      this.assistantAnswer += chunk;
    },

    onChatComplete({ messages }) {
      this.messages = messages;
      this.isChatting = false;
    },

    onChatError({ error }) {
      this.isChatting = false;
      this.isError = true;
      this.errorMessage = error || 'AI 对话出错';
      console.error('快捷模式对话出错:', error);
    },
  },
};
</script>

<style scoped>
.quick-mode-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* justify-content: center; */
  justify-content: flex-start;
  overflow: hidden;
  padding-bottom: 8px;
}

/* ===== 初始状态 ===== */
.initial-state {
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 0px 8px 8px 8px;
}

.chat-input-section {
  width: 100%;
  max-width: 970px;
  background: #fff;
  border-radius: 2px;
  padding: 5px 10px 5px 10px;
  position: relative;
  -webkit-app-region: no-drag;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  height: 29px;
  padding: 2px 5px 2px 7px
}

.agent-label {
  font-size: 14px;
  font-weight: 500;
  color: #606266;
}

.chat-input {
  width: 100%;
}

.chat-input :deep(.el-textarea__inner) {
  border-radius: 8px;
  font-size: 16px;
  padding: 12px;
  border: none;
  box-shadow: none;
  background: #f5f5f5;
}

.input-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.input-selectors {
  display: flex;
  gap: 8px;
}

.input-selectors .el-select {
  width: 140px;
}

/* 下拉面板最多显示3条，超出滚动 */
.input-selectors :deep(.el-select-dropdown) {
  max-height: 108px;
  overflow-y: auto;
}

.input-actions {
  display: flex;
  gap: 8px;
}

/* ===== 回答状态 ===== */
.answering-state {
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 2px;
}

.answering-card {
  width: 100%;
  max-width: 950px;
  background: #fff;
  border-radius: 2px;
  padding: 5px 10px 5px 10px;
  position: relative;
  -webkit-app-region: no-drag;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.answering-card .section-header {
  margin-bottom: 0;
}

.answering-card :deep(.el-divider) {
  margin: 12px 0;
}

.question-card {
  background: #f0f5ff;
  border: 1px solid #d9e4f8;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  word-break: break-word;
  margin-bottom: 12px;
}

.answer-area {
  flex: 1;
  overflow-y: auto;
  min-height: 60px;
}

.answer-content {
  background: white;
  color: #333;
  border-radius: 12px 12px 12px 4px;
  padding: 10px 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

/* Markdown 渲染样式 */
.answer-content :deep(h1),
.answer-content :deep(h2),
.answer-content :deep(h3) {
  margin: 12px 0 8px;
  font-weight: 600;
}

.answer-content :deep(h1) { font-size: 18px; }
.answer-content :deep(h2) { font-size: 16px; }
.answer-content :deep(h3) { font-size: 15px; }

.answer-content :deep(pre) {
  background: #f5f5f5;
  border-radius: 6px;
  padding: 10px;
  overflow-x: auto;
  margin: 8px 0;
}

.answer-content :deep(code) {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
}

.answer-content :deep(pre code) {
  background: transparent;
  padding: 0;
}

.answer-content :deep(a) {
  color: #409eff;
  text-decoration: none;
}

.answer-content :deep(a:hover) {
  text-decoration: underline;
}

.answer-content :deep(li) {
  margin-left: 20px;
  list-style: disc;
}

.answer-content :deep(strong) {
  font-weight: 600;
}

.loading-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #999;
  padding: 8px 0;
}

.error-message {
  color: #f56c6c;
  font-size: 14px;
  padding: 8px 0;
}

.answer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

/* ===== 响应式 ===== */
@media (max-width: 768px) {
  .initial-state {
    padding: 20px;
  }

  .chat-input-section,
  .answering-card {
    max-width: 100%;
  }
}
</style>
