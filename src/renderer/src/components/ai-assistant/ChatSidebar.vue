<template>
  <div class="chat-sidebar">
    <!-- 场景选择 -->
    <div class="sidebar-section">
      <div class="section-title">场景</div>
      <el-select
        :model-value="selectedScenario"
        placeholder="选择场景"
        @update:model-value="$emit('scenario-change', $event)"
        style="width: 100%"
        aria-label="选择场景"
      >
        <el-option
          v-for="id in scenarios"
          :key="id"
          :label="id"
          :value="id"
        />
      </el-select>
    </div>

    <!-- LLM 配置 -->
    <div class="sidebar-section" v-if="scenarios.length > 0">
      <div class="section-title">模型</div>
      <el-select
        :model-value="selectedLlmConfig"
        placeholder="选择模型"
        @update:model-value="$emit('llm-change', $event)"
        style="width: 100%"
        aria-label="选择模型"
      >
        <el-option
          v-for="name in llmConfigs"
          :key="name"
          :label="name"
          :value="name"
        />
      </el-select>
    </div>

    <!-- 对话历史 -->
    <div class="sidebar-section" v-if="selectedScenario">
      <div class="section-title">
        对话历史
        <el-button size="small" type="primary" @click="showNewDialog = true">+ 新建</el-button>
      </div>
      <el-select
        :model-value="selectedHistory"
        placeholder="选择对话"
        @update:model-value="$emit('history-change', $event)"
        style="width: 100%"
        aria-label="选择对话历史"
      >
        <el-option
          v-for="id in histories"
          :key="id"
          :label="id"
          :value="id"
        />
      </el-select>
    </div>

    <!-- 新建对话弹窗 -->
    <el-dialog v-model="showNewDialog" title="新建对话" width="400px">
      <el-input v-model="newHistoryTitle" placeholder="输入对话标题" />
      <template #footer>
        <el-button @click="showNewDialog = false">取消</el-button>
        <el-button type="primary" @click="createHistory">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
export default {
  name: 'ChatSidebar',
  props: {
    scenarios: { type: Array, default: () => [] },
    selectedScenario: { type: String, default: '' },
    llmConfigs: { type: Array, default: () => [] },
    selectedLlmConfig: { type: String, default: '' },
    histories: { type: Array, default: () => [] },
    selectedHistory: { type: String, default: '' },
  },
  emits: ['scenario-change', 'llm-change', 'history-change', 'create-history'],
  data() {
    return {
      showNewDialog: false,
      newHistoryTitle: '',
    };
  },
  methods: {
    createHistory() {
      if (!this.newHistoryTitle.trim()) {
        this.$message.warning('请输入对话标题');
        return;
      }
      this.$emit('create-history', this.newHistoryTitle.trim());
      this.newHistoryTitle = '';
      this.showNewDialog = false;
    },
  },
};
</script>

<style scoped>
.chat-sidebar {
  width: 250px;
  background: #f5f5f5;
  padding: 20px;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-weight: 600;
  font-size: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
