<template>
  <el-dialog
    :model-value="visible"
    :title="mode === 'rerun' ? '重跑任务' : '运行任务'"
    width="480px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="(v) => $emit('update:visible', v)"
    @open="handleOpen"
  >
    <el-form label-position="top" size="small">
      <el-form-item label="Agent">
        <el-select v-model="form.agentName" placeholder="选择 Agent" filterable>
          <el-option
            v-for="agent in agentOptions"
            :key="agent"
            :label="agent"
            :value="agent"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="LLM 配置">
        <el-select v-model="form.llmConfigName" placeholder="选择 LLM 配置" filterable>
          <el-option
            v-for="cfg in llmConfigOptions"
            :key="cfg"
            :label="cfg"
            :value="cfg"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="额外 prompt（可选）">
        <el-input
          v-model="form.extraPrompt"
          type="textarea"
          :rows="4"
          placeholder="补充本次任务的额外指令 / 上下文（将拼入 [运行时补充] 段落）"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="$emit('update:visible', false)">取消</el-button>
        <el-button
          type="primary"
          :disabled="!canConfirm"
          @click="handleConfirm"
        >
          {{ mode === 'rerun' ? '重跑' : '运行' }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import { ElMessage } from 'element-plus';

/**
 * TaskRunDialog —— 运行 / 重跑 Agent 任务对话框（Phase 5）
 *
 * 设计文档：docs/specs/100_todo-app-design.md §8.2 / §10 Phase 5
 *
 * 表单：
 * - Agent 选择（来自 window.aiAssistant.listAgents()）
 * - LLM 配置选择（来自 window.aiAssistant.listLlmConfigs()）
 * - 额外 prompt（可选，对应 §8.3 [运行时补充] 段落）
 *
 * 默认值：mounted 时读取 window.electron.getConfig() 的
 *        aiAssistant.defaultAgent / defaultLlmConfig（与 AI 助手一致）
 *
 * 事件：
 * - update:visible —— v-model
 * - confirm({ agentName, llmConfigName, extraPrompt }) —— 用户确认
 *
 * 标题随 mode 切换：「运行任务」/「重跑任务」
 */
export default {
  name: 'TaskRunDialog',
  emits: ['update:visible', 'confirm'],
  props: {
    // v-model:visible
    visible: { type: Boolean, default: false },
    // 模式：'run' 首次运行；'rerun' 重跑
    mode: { type: String, default: 'run' },
    // 当前 todo_item ID（仅用于日志上下文，不参与表单）
    itemId: { type: Number, default: null },
  },
  data() {
    return {
      form: {
        agentName: '',
        llmConfigName: '',
        extraPrompt: '',
      },
      agentOptions: [],
      llmConfigOptions: [],
    };
  },
  computed: {
    /** Agent 与 LLM 配置均非空时才允许确认 */
    canConfirm() {
      return Boolean(this.form.agentName && this.form.llmConfigName);
    },
  },
  methods: {
    /** 对话框 open 事件：加载选项 + 应用默认值 */
    async handleOpen() {
      await Promise.all([this.loadAgents(), this.loadLlmConfigs()]);
      await this.applyDefaults();
    },
    async loadAgents() {
      try {
        this.agentOptions = await window.aiAssistant.listAgents();
      } catch (err) {
        console.error('listAgents failed', err);
        ElMessage.error('加载 Agent 列表失败');
        this.agentOptions = [];
      }
    },
    async loadLlmConfigs() {
      try {
        this.llmConfigOptions = await window.aiAssistant.listLlmConfigs();
      } catch (err) {
        console.error('listLlmConfigs failed', err);
        ElMessage.error('加载 LLM 配置失败');
        this.llmConfigOptions = [];
      }
    },
    /** 应用 qtian.json 的 defaultAgent / defaultLlmConfig（仅在选项存在时） */
    async applyDefaults() {
      try {
        const appConfig = await window.electron.getConfig();
        const defaultAgent = appConfig?.aiAssistant?.defaultAgent;
        const defaultLlmConfig = appConfig?.aiAssistant?.defaultLlmConfig;
        if (defaultAgent && this.agentOptions.includes(defaultAgent)) {
          this.form.agentName = defaultAgent;
        } else if (this.agentOptions.length > 0 && !this.form.agentName) {
          this.form.agentName = this.agentOptions[0];
        }
        if (defaultLlmConfig && this.llmConfigOptions.includes(defaultLlmConfig)) {
          this.form.llmConfigName = defaultLlmConfig;
        } else if (this.llmConfigOptions.length > 0 && !this.form.llmConfigName) {
          this.form.llmConfigName = this.llmConfigOptions[0];
        }
      } catch (err) {
        console.error('apply defaults failed', err);
      }
    },
    handleConfirm() {
      if (!this.canConfirm) return;
      this.$emit('confirm', {
        agentName: this.form.agentName,
        llmConfigName: this.form.llmConfigName,
        extraPrompt: this.form.extraPrompt,
      });
      this.$emit('update:visible', false);
      // 重置额外 prompt（保留 Agent / LLM 选择作为下次默认）
      this.form.extraPrompt = '';
    },
  },
};
</script>

<style scoped>
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}
</style>
