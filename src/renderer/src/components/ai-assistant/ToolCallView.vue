<template>
  <div class="tool-call-view" :class="{ 'tool-call-error': isError }">
    <div class="tool-call-header" @click="isExpanded = !isExpanded">
      <span class="tool-name">{{ name }}</span>
      <el-icon class="expand-icon" :class="{ expanded: isExpanded }">
        <ArrowDown />
      </el-icon>
    </div>
    <div v-if="isExpanded" class="tool-call-body">
      <div class="tool-section">
        <span class="section-label">参数:</span>
        <pre class="tool-args">{{ formatArgs(arguments) }}</pre>
      </div>
      <div class="tool-section">
        <span class="section-label">结果:</span>
        <pre class="tool-result">{{ result }}</pre>
      </div>
    </div>
  </div>
</template>

<script>
import { ArrowDown } from '@element-plus/icons-vue';

export default {
  name: 'ToolCallView',
  components: { ArrowDown },
  props: {
    name: { type: String, required: true },
    arguments: { type: String, default: '{}' },
    result: { type: String, default: '' },
    isError: { type: Boolean, default: false },
  },
  data() {
    return {
      isExpanded: false,
    };
  },
  methods: {
    /**
     * 格式化参数 JSON，美化输出
     */
    formatArgs(argsStr) {
      try {
        return JSON.stringify(JSON.parse(argsStr || '{}'), null, 2);
      } catch {
        return argsStr || '{}';
      }
    },
  },
};
</script>

<style scoped>
.tool-call-view {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin: 8px 0;
  background: #fafafa;
  overflow: hidden;
}

.tool-call-error {
  border-color: #f56c6c;
  background: #fef0f0;
}

.tool-call-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  background: #f0f0f0;
  user-select: none;
}

.tool-call-error .tool-call-header {
  background: #fde2e2;
}

.tool-name {
  font-weight: 500;
  font-size: 13px;
  color: #606266;
}

.expand-icon {
  transition: transform 0.2s;
  font-size: 14px;
  color: #909399;
}

.expand-icon.expanded {
  transform: rotate(180deg);
}

.tool-call-body {
  padding: 10px 12px;
}

.tool-section {
  margin-bottom: 8px;
}

.tool-section:last-child {
  margin-bottom: 0;
}

.section-label {
  font-size: 12px;
  font-weight: 500;
  color: #909399;
  display: block;
  margin-bottom: 4px;
}

.tool-args,
.tool-result {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 8px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
}
</style>
