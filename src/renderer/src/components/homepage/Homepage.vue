<template>
  <div class="homepage-container">
    <!-- 对话输入区域 -->
    <div class="chat-input-section">
      <el-input
        v-model="message"
        type="textarea"
        placeholder="输入你想问的问题..."
        class="chat-input"
        :rows="3"
        resize="none"
        @keydown="handleKeyDown"
        aria-label="对话输入框"
      />
      <!-- 底部操作栏：场景/模型选择 + 发送按钮 -->
      <div class="input-footer">
        <div class="input-selectors">
          <el-select
            v-model="selectedScenario"
            placeholder="选择场景"
            size="small"
            aria-label="首页选择场景"
          >
            <el-option
              v-for="scenario in scenarioObjects"
              :key="scenario.id"
              :label="scenario.name || scenario.id"
              :value="scenario.id"
            />
          </el-select>
          <el-select
            v-model="selectedLlmConfig"
            placeholder="选择模型"
            size="small"
            aria-label="首页选择模型"
          >
            <el-option
              v-for="name in llmConfigs"
              :key="name"
              :label="name"
              :value="name"
            />
          </el-select>
        </div>
        <div class="input-actions">
          <el-button
            type="primary"
            size="small"
            :disabled="!message.trim()"
            @click="handleSend"
            aria-label="发送"
          >
            发送
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Homepage',

  emits: ['navigate'],

  data() {
    return {
      message: '',
      scenarios: [],
      scenarioObjects: [],
      selectedScenario: '',
      llmConfigs: [],
      selectedLlmConfig: '',
    };
  },

  async mounted() {
    await this.loadScenarios();
    await this.loadLlmConfigs();
  },

  methods: {
    /**
     * 加载场景列表及完整对象
     */
    async loadScenarios() {
      try {
        this.scenarios = await window.aiAssistant.listScenarios();
        this.scenarioObjects = await Promise.all(
          this.scenarios.map(async (id) => {
            try {
              return await window.aiAssistant.getScenario(id);
            } catch {
              return { id, name: id };
            }
          })
        );
        // 自动选择第一个场景
        if (this.scenarioObjects.length > 0) {
          this.selectedScenario = this.scenarioObjects[0].id;
        }
      } catch (err) {
        console.error('首页加载场景失败:', err);
      }
    },

    /**
     * 加载 LLM 配置列表
     */
    async loadLlmConfigs() {
      try {
        this.llmConfigs = await window.aiAssistant.listLlmConfigs();
        // 自动选择第一个模型
        if (this.llmConfigs.length > 0) {
          this.selectedLlmConfig = this.llmConfigs[0];
        }
      } catch (err) {
        console.error('首页加载模型配置失败:', err);
      }
    },

    /**
     * 处理键盘事件，Ctrl+Enter 发送消息
     */
    handleKeyDown(event) {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        this.handleSend();
      }
    },

    /**
     * 发送消息并跳转到 AI 助手页面，携带场景和模型选择
     */
    handleSend() {
      const trimmedMessage = this.message.trim();
      if (!trimmedMessage) return;

      this.$emit('navigate', 'ai-assistant', {
        message: trimmedMessage,
        scenarioId: this.selectedScenario,
        llmConfig: this.selectedLlmConfig,
      });
      this.message = '';
    },
  },
};
</script>

<style scoped>
.homepage-container {
  width: 100%;
  height: 100vh;
  padding: 40px;
  overflow-y: auto;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* 对话输入区域 */
.chat-input-section {
  width: 100%;
  max-width: 640px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 12px 20px 16px;
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

.input-actions {
  display: flex;
  gap: 8px;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .homepage-container {
    padding: 20px;
  }

  .chat-input-section {
    max-width: 100%;
  }
}
</style>
