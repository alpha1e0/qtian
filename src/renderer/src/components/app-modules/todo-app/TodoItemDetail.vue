<template>
  <div class="todo-item-detail-inner">
    <!--
      固定页头：基本信息 / AI任务 双 tab（复用 sidebar 的 radio-button toggle 样式）。
      放在滚动容器之外，保证表单再长也能随时切换 tab。
    -->
    <div class="detail-header">
      <el-radio-group v-model="view" size="small" class="view-toggle">
        <el-radio-button value="basic">基本信息</el-radio-button>
        <el-radio-button value="task">AI任务</el-radio-button>
      </el-radio-group>
    </div>

    <!--
      内部滚动容器：根元素 .todo-item-detail-inner 因 Vue attribute inheritance
      会与父组件传入的 .todo-item-detail 合并到同一 DOM 元素，无法既当外层 wrapper
      （需要 flex:9 横向占位）又当滚动容器（需要 overflow-y:auto）。
      这里再分一层 .item-detail-scroll 专门承担滚动，与 .todo-sidebar / .todo-list-panel 同款。
    -->
    <div class="item-detail-scroll">
      <!--
        保存状态指示条（VSCode/Notion 风格自动保存反馈）：
        字段失焦/值变化触发 IPC 时显示"保存中"，IPC 完成后切到"已保存"或"保存失败"，
        2.5s 后淡出回 idle。sticky top 让滚动时也可见。
      -->
      <div
        v-if="!loading && formData"
        class="save-status-bar"
        :class="`is-${saveStatus}`"
        aria-live="polite"
      >
        <span class="status-text">
          <el-icon v-if="saveStatus === 'saving'" class="is-loading"><Loading /></el-icon>
          <el-icon v-else-if="saveStatus === 'saved'"><Check /></el-icon>
          <el-icon v-else-if="saveStatus === 'error'"><Close /></el-icon>
          <template v-if="saveStatus === 'saving'">保存中…</template>
          <template v-else-if="saveStatus === 'saved'">已保存</template>
          <template v-else-if="saveStatus === 'error'">保存失败</template>
        </span>
      </div>
      <div v-if="loading" class="loading-hint">加载中...</div>
      <div v-else-if="!formData" class="empty-hint">待办条目不存在</div>

      <!-- =============== 基本信息 tab =============== -->
      <div v-else-if="view === 'basic'" class="detail-content">
        <el-form label-position="top" size="small">
          <el-form-item label="标题">
            <el-input v-model="formData.title" @blur="handleSave" />
          </el-form-item>

          <el-form-item label="状态">
            <el-radio-group v-model="formData.status" class="status-group" @change="handleStatusChange">
              <el-radio-button value="init">初始</el-radio-button>
              <el-radio-button value="in_progress">进行中</el-radio-button>
              <el-radio-button value="done">已完成</el-radio-button>
              <el-radio-button value="abandoned">已放弃</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="优先级">
            <!--
              每个 radio 的 label 字体颜色对应优先级，配色与 TodoItemRow priority-dot 一致：
              urgent=危险红 / important=警示橙 / normal=主色 indigo / hint=弱化灰。
              选中态圆点同色，强化"当前优先级"的视觉反馈（对应列表里的实色 priority-dot）。
            -->
            <el-radio-group v-model="formData.priority" class="priority-group" @change="handleSave">
              <el-radio value="urgent" class="prio-radio prio-urgent">紧急</el-radio>
              <el-radio value="important" class="prio-radio prio-important">重要</el-radio>
              <el-radio value="normal" class="prio-radio prio-normal">普通</el-radio>
              <el-radio value="hint" class="prio-radio prio-hint">提示</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="截止时间">
            <el-date-picker
              v-model="formData.dueAt"
              type="datetime"
              placeholder="选择截止时间"
              format="YYYY-MM-DD HH:mm"
              value-format="x"
              @change="handleSave"
            />
          </el-form-item>

          <el-form-item label="描述">
            <el-input
              v-model="formData.description"
              type="textarea"
              :rows="9"
              @blur="handleSave"
            />
          </el-form-item>

          <el-form-item label="进度">
            <div class="progress-row">
              <el-slider
                v-model="formData.progress"
                :disabled="formData.is_manual_progress === false && hasChildren"
                @change="handleSave"
              />
              <span class="progress-value">{{ formData.progress }}%</span>
            </div>
          </el-form-item>

          <el-form-item>
            <div class="manual-progress-toggle">
              <el-switch v-model="formData.is_manual_progress" @change="handleManualToggle" />
              <span class="toggle-label">手动设置进度（关闭则由子项平均）</span>
            </div>
          </el-form-item>
        </el-form>

        <!-- 文档区域 -->
        <div class="docs-section">
          <div class="docs-header">
            <span class="section-title">关联文档</span>
            <el-button size="small" text @click="handleCreateDoc">
              <el-icon><Plus /></el-icon> 新建
            </el-button>
          </div>
          <div v-if="documents.length === 0" class="empty-hint">暂无文档</div>
          <div
            v-for="doc in documents"
            :key="doc.id"
            class="doc-item"
            @click="handleOpenDoc(doc)"
          >
            <el-icon><Document /></el-icon>
            <span class="doc-name">{{ doc.name }}</span>
          </div>
        </div>
      </div>

      <!-- =============== AI任务 tab =============== -->
      <div v-else class="detail-content">
        <el-form label-position="top" size="small">
          <el-form-item label="任务提示词（task_prompt）">
            <el-input
              v-model="formData.task_prompt"
              type="textarea"
              :rows="5"
              placeholder="驱动 AI 任务时的上下文提示词（给 agent 看的额外指令 / 约束 / 参考资料）"
              @blur="handleSave"
            />
          </el-form-item>
        </el-form>

        <!--
          任务运行配置（原 TaskRunDialog 表单内联）：
          Agent / LLM 配置 / 额外 prompt。首次切到 AI任务 tab 时懒加载选项并应用默认值。
        -->
        <div class="task-config-section">
          <div class="docs-header">
            <span class="section-title">运行配置</span>
          </div>
          <el-form label-position="top" size="small">
            <el-form-item label="Agent">
              <el-select v-model="taskForm.agentName" placeholder="选择 Agent" filterable>
                <el-option
                  v-for="agent in agentOptions"
                  :key="agent"
                  :label="agent"
                  :value="agent"
                />
              </el-select>
            </el-form-item>

            <el-form-item label="LLM 配置">
              <el-select v-model="taskForm.llmConfigName" placeholder="选择 LLM 配置" filterable>
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
                v-model="taskForm.extraPrompt"
                type="textarea"
                :rows="4"
                placeholder="补充本次任务的额外指令 / 上下文（将拼入 [运行时补充] 段落）"
              />
            </el-form-item>
          </el-form>

          <div class="task-actions">
            <!-- 首次运行：agent_task_id 为空 -->
            <el-button
              v-if="!formData.agent_task_id"
              type="primary"
              size="small"
              :disabled="!canRunTask"
              @click="handleRunTask"
            >
              <el-icon><VideoPlay /></el-icon> 运行任务
            </el-button>
            <!-- 已有任务：查看面板 + 重跑 -->
            <template v-else>
              <el-button size="small" @click="$emit('view-task')">
                <el-icon><View /></el-icon> 查看任务面板
              </el-button>
              <el-button
                type="primary"
                size="small"
                :disabled="!canRunTask"
                @click="handleRunTask"
              >
                <el-icon><Refresh /></el-icon> 重跑
              </el-button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { Plus, Document, VideoPlay, View, Refresh, Loading, Check, Close } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

/**
 * TodoItemDetail —— todo_item 详情面板（基本信息 / AI任务 双 tab）。
 *
 * 基本信息 tab：标题 / 状态 / 优先级 / 截止时间 / 描述 / 进度 / 手动进度 / 关联文档
 * AI任务 tab：task_prompt + Agent / LLM 配置 / 额外 prompt 内联表单 + 运行/重跑/查看面板
 *
 * 自动保存：字段失焦或值变化触发 IPC，顶部 save-status-bar 反馈 saving/saved/error。
 * 任务运行：表单内联（原 TaskRunDialog 已移除），点击「运行任务」/「重跑」直接 emit
 *   run-task({ agentName, llmConfigName, extraPrompt })，由父组件调用 createTaskFromItem。
 */
export default {
  name: 'TodoItemDetail',
  components: { Plus, Document, VideoPlay, View, Refresh, Loading, Check, Close },
  // run-task 携带 { agentName, llmConfigName, extraPrompt } 负载（首次运行 + 重跑共用）
  emits: ['updated', 'open-doc', 'run-task', 'view-task'],
  props: {
    itemId: { type: Number, required: true },
  },
  data() {
    return {
      // 当前 tab：'basic' | 'task'
      view: 'basic',
      loading: true,
      formData: null,
      documents: [],
      hasChildren: false,
      saveTimer: null,
      // 顶部状态条：'idle' | 'saving' | 'saved' | 'error'
      // idle 时不渲染文字；saved/error 2.5s 后回 idle 避免长时间残留
      saveStatus: 'idle',
      saveStatusTimer: null,
      // AI任务 tab 的运行配置表单（不写入 todo_item，仅用于发起任务）
      taskForm: {
        agentName: '',
        llmConfigName: '',
        extraPrompt: '',
      },
      agentOptions: [],
      llmConfigOptions: [],
      // 懒加载标记：首次切到 AI任务 tab 才拉 Agent/LLM 选项，避免每个 item 都打两个 IPC
      taskOptionsLoaded: false,
    };
  },
  computed: {
    /** Agent 与 LLM 配置均非空时才允许运行/重跑 */
    canRunTask() {
      return Boolean(this.taskForm.agentName && this.taskForm.llmConfigName);
    },
  },
  watch: {
    itemId() {
      this.loadDetail();
    },
    // 切到 AI任务 tab 时懒加载选项（仅首次）
    view(val) {
      if (val === 'task') this.ensureTaskOptionsLoaded();
    },
  },
  async mounted() {
    await this.loadDetail();
  },
  beforeUnmount() {
    // 清理状态条定时器，避免组件卸载后回调触发 setState on unmounted
    if (this.saveStatusTimer) clearTimeout(this.saveStatusTimer);
  },
  methods: {
    /**
     * 包装异步保存操作，统一驱动顶部状态条：
     *   saving → (await fn) → saved/error → 2.5s 后回 idle
     * 用法：const ok = await this.runSave(() => window.todoApp.updateTodoItem(...))
     * @param {() => Promise<unknown>} fn - 实际调用 IPC 的异步函数
     * @returns {Promise<boolean>} true=成功，false=失败（已弹 ElMessage.error）
     */
    async runSave(fn) {
      this.setSaveStatus('saving');
      try {
        await fn();
        this.setSaveStatus('saved');
        return true;
      } catch (err) {
        this.setSaveStatus('error');
        ElMessage.error(err?.message || '保存失败');
        return false;
      }
    },
    /**
     * 设置状态条状态并管理自动淡出定时器。
     * saved/error 2.5s 后回 idle（让用户看到反馈但不长期占用视觉空间）；
     * saving 不自动重置，由 runSave 在 IPC 返回后显式切换。
     */
    setSaveStatus(status) {
      this.saveStatus = status;
      if (this.saveStatusTimer) {
        clearTimeout(this.saveStatusTimer);
        this.saveStatusTimer = null;
      }
      if (status === 'saved' || status === 'error') {
        this.saveStatusTimer = setTimeout(() => {
          this.saveStatus = 'idle';
          this.saveStatusTimer = null;
        }, 2500);
      }
    },
    async loadDetail() {
      this.loading = true;
      try {
        const item = await window.todoApp.getTodoItem(this.itemId);
        if (item) {
          this.formData = {
            title: item.title,
            description: item.description,
            task_prompt: item.task_prompt,
            status: item.status,
            progress: item.progress,
            priority: item.priority,
            dueAt: item.due_at ? String(item.due_at) : null,
            is_manual_progress: item.is_manual_progress,
            agent_task_id: item.agent_task_id ?? null,
          };
          await this.loadDocuments();
        } else {
          this.formData = null;
        }
      } catch (err) {
        ElMessage.error('加载详情失败');
        console.error(err);
      } finally {
        this.loading = false;
      }
    },
    async loadDocuments() {
      try {
        this.documents = await window.todoApp.listDocsByItem(this.itemId);
      } catch (err) {
        console.error(err);
      }
    },
    async handleSave() {
      if (!this.formData) return;
      const ok = await this.runSave(() => window.todoApp.updateTodoItem(this.itemId, {
        title: this.formData.title,
        description: this.formData.description,
        task_prompt: this.formData.task_prompt,
        priority: this.formData.priority,
        due_at: this.formData.dueAt ? parseInt(this.formData.dueAt, 10) : null,
      }));
      if (ok) this.$emit('updated');
    },
    async handleStatusChange(status) {
      const ok = await this.runSave(() => window.todoApp.updateTodoItemStatus(this.itemId, status));
      await this.loadDetail();
      if (ok) this.$emit('updated');
    },
    async handleManualToggle(val) {
      const ok = await this.runSave(() => window.todoApp.updateTodoItem(this.itemId, {
        is_manual_progress: val,
        progress: this.formData.progress,
      }));
      await this.loadDetail();
      if (ok) this.$emit('updated');
    },
    /**
     * 首次切到 AI任务 tab 时加载 Agent / LLM 配置选项，并应用 qtian.json 默认值。
     * 后续切换不重复拉取（选项在会话内稳定，避免无谓 IPC）。
     */
    async ensureTaskOptionsLoaded() {
      if (this.taskOptionsLoaded) return;
      this.taskOptionsLoaded = true; // 先置位，防止并发 watch 触发重复加载
      await Promise.all([this.loadAgents(), this.loadLlmConfigs()]);
      await this.applyTaskDefaults();
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
    /** 应用 qtian.json 的 defaultAgent / defaultLlmConfig（仅在选项存在且当前未选时） */
    async applyTaskDefaults() {
      try {
        const appConfig = await window.electron.getConfig();
        const defaultAgent = appConfig?.aiAssistant?.defaultAgent;
        const defaultLlmConfig = appConfig?.aiAssistant?.defaultLlmConfig;
        if (defaultAgent && this.agentOptions.includes(defaultAgent)) {
          this.taskForm.agentName = defaultAgent;
        } else if (this.agentOptions.length > 0 && !this.taskForm.agentName) {
          this.taskForm.agentName = this.agentOptions[0];
        }
        if (defaultLlmConfig && this.llmConfigOptions.includes(defaultLlmConfig)) {
          this.taskForm.llmConfigName = defaultLlmConfig;
        } else if (this.llmConfigOptions.length > 0 && !this.taskForm.llmConfigName) {
          this.taskForm.llmConfigName = this.llmConfigOptions[0];
        }
      } catch (err) {
        console.error('apply task defaults failed', err);
      }
    },
    /**
     * 运行 / 重跑任务：emit run-task 携带表单负载，由父组件调用 createTaskFromItem。
     * 发起后清空 extraPrompt（保留 Agent / LLM 选择作为下次默认，与原 dialog 行为一致）。
     */
    handleRunTask() {
      if (!this.canRunTask) return;
      this.$emit('run-task', {
        agentName: this.taskForm.agentName,
        llmConfigName: this.taskForm.llmConfigName,
        extraPrompt: this.taskForm.extraPrompt,
      });
      this.taskForm.extraPrompt = '';
    },
    /**
     * 新建文档：先弹框收集名称，落库后通知父组件切换到编辑器视图。
     * 这里采用"创建+打开"两步，保证父组件能拿到真实 docId。
     */
    async handleCreateDoc() {
      try {
        const { value } = await ElMessageBox.prompt('请输入文档名称', '新建关联文档', {
          confirmButtonText: '创建',
          cancelButtonText: '取消',
        });
        if (!value || !value.trim()) return;
        const created = await window.todoApp.saveDocument({
          name: value.trim(),
          content: '',
          todo_item_id: this.itemId,
          todo_list_id: null,
        });
        await this.loadDocuments();
        this.$emit('open-doc', {
          id: created.id,
          itemId: this.itemId,
          titlePath: `${this.formData?.title || ''} / ${created.name}`,
        });
        ElMessage.success('文档已创建');
      } catch (err) {
        if (err === 'cancel') return;
        ElMessage.error(err.message || '创建失败');
      }
    },
    handleOpenDoc(doc) {
      this.$emit('open-doc', {
        id: doc.id,
        itemId: this.itemId,
        titlePath: `${this.formData?.title || ''} / ${doc.name}`,
      });
    },
  },
};
</script>

<style scoped>
/*
 * 三段式布局（与 .todo-sidebar / .todo-list-panel 同款）：
 *   .todo-item-detail (来自父组件 TodoAppPage；flex:9, overflow-y:auto)
 *     └─ .todo-item-detail-inner (与 .todo-item-detail 合并到同一 DOM 元素：Vue attribute inheritance)
 *          ├─ .detail-header (flex-shrink:0) ← tab toggle 固定页头
 *          └─ .item-detail-scroll (flex:1, min-height:0, overflow-y:auto) ← 真正的滚动容器
 */
.todo-item-detail-inner {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 固定页头：基本信息 / AI任务 tab toggle（不随内容滚动） */
.detail-header {
  flex-shrink: 0;
  padding: 14px 18px 4px;
}

/* 真正的滚动容器：承担所有可滚动内容（表单 + 关联文档 / 任务配置） */
.item-detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 18px 28px;
}

/*
 * 保存状态指示条（VSCode/Notion 风格自动保存反馈）：
 * sticky top 让滚动时也可见；idle 时透明且不占视觉空间（高度由内容撑开为 0）；
 * saving/saved/error 切换配色，2.5s 后由 JS 回 idle 触发淡出。
 */
.save-status-bar {
  position: sticky;
  top: -18px; /* 抵消 .item-detail-scroll 的 padding-top，让条贴住滚动区顶部 */
  z-index: 2;
  display: flex;
  justify-content: center; /* 居中显示在详情面板顶部 */
  margin: -18px -18px 12px;
  pointer-events: none;
}

.save-status-bar .status-text {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.08);
  color: var(--text-on-dark-secondary);
  letter-spacing: 0.04em;
  font-weight: 500;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.save-status-bar.is-saving .status-text,
.save-status-bar.is-saved .status-text,
.save-status-bar.is-error .status-text {
  opacity: 1;
  transform: translateY(0);
}

.save-status-bar.is-saving .status-text {
  background: rgba(99, 102, 241, 0.10);
  color: var(--accent-text);
}

.save-status-bar.is-saved .status-text {
  background: rgba(34, 197, 94, 0.10);
  color: #16a34a;
}

.save-status-bar.is-error .status-text {
  background: rgba(239, 68, 68, 0.10);
  color: var(--color-danger, #ef4444);
}

.save-status-bar .is-loading {
  animation: save-status-spin 1s linear infinite;
}

@keyframes save-status-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 表单输入与深色 Aurora 基底对齐 */
.todo-item-detail-inner :deep(.el-form-item__label) {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #5c5b72);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  padding-bottom: 4px;
  line-height: 1.6;
}

.todo-item-detail-inner :deep(.el-input__wrapper),
.todo-item-detail-inner :deep(.el-textarea__inner),
.todo-item-detail-inner :deep(.el-select__wrapper) {
  background: rgba(99, 102, 241, 0.04);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.10) inset;
  border-radius: 8px;
  transition: box-shadow 0.2s ease, background 0.2s ease;
}

.todo-item-detail-inner :deep(.el-input__wrapper:hover),
.todo-item-detail-inner :deep(.el-textarea__inner:hover),
.todo-item-detail-inner :deep(.el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.22) inset;
}

.todo-item-detail-inner :deep(.el-input__wrapper.is-focus),
.todo-item-detail-inner :deep(.el-textarea__inner:focus),
.todo-item-detail-inner :deep(.el-select__wrapper.is-focused) {
  box-shadow:
    0 0 0 1px var(--accent, #6366f1) inset,
    0 0 0 4px rgba(99, 102, 241, 0.10);
}

.todo-item-detail-inner :deep(.el-input__inner),
.todo-item-detail-inner :deep(.el-textarea__inner) {
  color: var(--text-on-dark, #e4e4ed);
  font-size: 13px;
  letter-spacing: 0.01em;
}

.loading-hint,
.empty-hint {
  color: var(--text-on-dark-muted, #5c5b72);
  font-size: 13px;
  font-style: italic;
  text-align: center;
  padding: 32px 0;
  letter-spacing: 0.02em;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.progress-row .el-slider {
  flex: 1;
}

/* slider 颜色与新主色对齐 */
.progress-row :deep(.el-slider__runway) {
  background-color: rgba(99, 102, 241, 0.12);
}

.progress-row :deep(.el-slider__bar) {
  background: linear-gradient(90deg, #6366f1, #8b5cf6);
}

.progress-row :deep(.el-slider__button) {
  border-color: var(--accent, #6366f1);
}

.progress-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-on-dark-secondary, #8b8aa0);
  font-feature-settings: 'tnum';
  min-width: 36px;
  text-align: right;
  letter-spacing: 0.04em;
}

.manual-progress-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.manual-progress-toggle :deep(.el-switch.is-checked .el-switch__core) {
  background-color: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
}

.toggle-label {
  font-size: 12px;
  color: var(--text-on-dark-secondary, #8b8aa0);
  letter-spacing: 0.01em;
}

/*
 * 状态：分段按钮组（el-radio-button）。选中态对齐主题 indigo，
 * 避免回落到 Element Plus 默认蓝与整体 Aurora 基调冲突。
 */
.status-group :deep(.el-radio-button__inner) {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  background: rgba(99, 102, 241, 0.03);
  border-color: rgba(99, 102, 241, 0.16);
  color: var(--text-on-dark-secondary);
  transition: all 0.2s ease;
}

.status-group :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background-color: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
  box-shadow: -1px 0 0 0 var(--accent, #6366f1);
  color: #fff;
}

/*
 * 优先级 radio：每个选项的 label 字体颜色对应优先级，
 * 配色与 TodoItemRow.vue 的 priority-dot 完全一致（urgent/important/normal/hint）。
 * 选中态圆点同色，让"当前优先级"一眼可辨，呼应列表里的实色 priority-dot。
 */
.priority-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  width: 100%;
}

.priority-group :deep(.el-radio__label) {
  font-weight: 600;
  letter-spacing: 0.02em;
}

/* label 常驻显示该优先级颜色 */
.prio-urgent :deep(.el-radio__label) { color: var(--color-danger, #ef4444); }
.prio-important :deep(.el-radio__label) { color: var(--color-warning, #f59e0b); }
.prio-normal :deep(.el-radio__label) { color: var(--accent, #6366f1); }
.prio-hint :deep(.el-radio__label) { color: var(--text-on-dark-muted, #5c5b72); }

/* 选中态圆点同色（对应 priority-dot 实色点） */
.prio-urgent :deep(.el-radio__input.is-checked .el-radio__inner) {
  background-color: var(--color-danger, #ef4444);
  border-color: var(--color-danger, #ef4444);
}
.prio-important :deep(.el-radio__input.is-checked .el-radio__inner) {
  background-color: var(--color-warning, #f59e0b);
  border-color: var(--color-warning, #f59e0b);
}
.prio-normal :deep(.el-radio__input.is-checked .el-radio__inner) {
  background-color: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
}
.prio-hint :deep(.el-radio__input.is-checked .el-radio__inner) {
  background-color: var(--text-on-dark-muted, #5c5b72);
  border-color: var(--text-on-dark-muted, #5c5b72);
}

/* 章节分隔：渐隐细线代替生硬的实色 border */
.docs-section,
.task-config-section {
  margin-top: 22px;
  padding-top: 14px;
  position: relative;
}

.docs-section::before,
.task-config-section::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(99, 102, 241, 0.20),
    rgba(99, 102, 241, 0.02)
  );
}

.docs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.task-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

/* eyebrow 章节标题 */
.section-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #5c5b72);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

/* 文档卡片：浮起的档案条目 */
.doc-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.08);
  transition: all 0.18s ease;
  margin-bottom: 6px;
  color: var(--text-on-dark, #e4e4ed);
}

.doc-item:hover {
  background: rgba(99, 102, 241, 0.10);
  border-color: rgba(99, 102, 241, 0.22);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.10);
}

.doc-item :deep(.el-icon) {
  color: var(--accent);
}

.doc-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.01em;
}

/* tab toggle：复用 sidebar 的 .view-toggle 编辑级风格 */
.view-toggle {
  width: 100%;
  --el-radio-button-checked-bg-color: rgba(99, 102, 241, 0.14);
  --el-radio-button-checked-text-color: var(--accent-text);
  --el-radio-button-checked-border-color: rgba(99, 102, 241, 0.36);
  --el-radio-button-input-border-color: rgba(99, 102, 241, 0.16);
}

.view-toggle :deep(.el-radio-button) {
  width: 50%;
}

.view-toggle :deep(.el-radio-button__inner) {
  width: 100%;
  padding: 8px 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  background: rgba(99, 102, 241, 0.03);
  border-color: rgba(99, 102, 241, 0.16);
  color: var(--text-on-dark-secondary);
  transition: all 0.2s ease;
}

.view-toggle :deep(.el-radio-button__inner:hover) {
  color: var(--text-on-dark);
}
</style>
