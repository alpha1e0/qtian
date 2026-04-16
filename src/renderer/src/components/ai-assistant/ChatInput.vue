<template>
  <div class="chat-input">
    <!-- 输入区域 -->
    <div class="input-main">
      <el-input
        v-model="userInput"
        type="textarea"
        :rows="3"
        :placeholder="inputPlaceholder"
        @keydown.ctrl.enter.exact="handleSend"
        :disabled="isChatting"
        resize="none"
        aria-label="消息输入框"
      />
    </div>
    <!-- 底部操作栏：Agent/模型选择 + 发送按钮 -->
    <div class="input-footer">
      <div class="input-selectors">
        <el-select
          :model-value="selectedAgent"
          placeholder="选择Agent"
          @update:model-value="$emit('agent-change', $event)"
          size="small"
          aria-label="选择Agent"
        >
          <el-option
            v-for="agent in agents"
            :key="agent.name"
            :label="agent.alias || agent.name"
            :value="agent.name"
          />
        </el-select>
        <el-select
          :model-value="selectedLlmConfig"
          placeholder="选择模型"
          @update:model-value="$emit('llm-change', $event)"
          size="small"
          aria-label="选择模型"
        >
          <el-option
            v-for="config in llmConfigs"
            :key="config._configName"
            :label="config.alias || config.model"
            :value="config._configName"
          />
        </el-select>
      </div>
      <div class="input-actions">
        <el-button
          v-if="isChatting"
          type="danger"
          @click="$emit('stop-chat')"
          size="small"
        >
          停止
        </el-button>
        <el-button
          v-else
          type="primary"
          @click="handleSend"
          :disabled="!userInput.trim()"
          size="small"
        >
          发送
        </el-button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ChatInput',
  props: {
    agents: { type: Array, default: () => [] },
    selectedAgent: { type: String, default: '' },
    llmConfigs: { type: Array, default: () => [] },
    selectedLlmConfig: { type: String, default: '' },
    isChatting: { type: Boolean, default: false },
  },
  emits: ['send-message', 'agent-change', 'llm-change', 'stop-chat'],
  data() {
    return {
      userInput: '',
    };
  },
  computed: {
    inputPlaceholder() {
      return this.isChatting ? 'AI 正在回复中...' : '输入消息... (Ctrl+Enter 发送)';
    },
  },
  methods: {
    handleSend() {
      if (!this.userInput.trim() || this.isChatting) return;
      const message = this.userInput;
      this.userInput = '';
      this.$emit('send-message', message);
    },
  },
};
</script>

<style scoped>
.chat-input {
  border-top: 1px solid #e0e0e0;
  background: white;
  padding: 12px 20px 16px;
}

.input-main {
  margin-bottom: 8px;
}

.input-main :deep(.el-textarea__inner) {
  font-family: inherit;
  line-height: 1.6;
}

.input-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
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
</style>
