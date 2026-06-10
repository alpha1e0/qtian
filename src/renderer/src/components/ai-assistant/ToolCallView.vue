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
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  margin: 8px 0;
  background: var(--surface-base);
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.tool-call-view:hover {
  border-color: var(--border-medium);
}

.tool-call-error {
  border-color: var(--color-danger);
  background: #fef2f2;
}

.tool-call-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.02);
  user-select: none;
  transition: background 0.15s ease;
}

.tool-call-header:hover {
  background: rgba(0, 0, 0, 0.04);
}

.tool-call-error .tool-call-header {
  background: #fee2e2;
}

.tool-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.expand-icon {
  transition: transform 0.25s ease;
  font-size: 14px;
  color: var(--text-muted);
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
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  display: block;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tool-args,
.tool-result {
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
  line-height: 1.5;
}
</style>
