<template>
  <div class="todo-item-detail-inner">
    <!--
      内部滚动容器：根元素 .todo-item-detail-inner 因 Vue attribute inheritance
      会与父组件传入的 .todo-item-detail 合并到同一 DOM 元素，无法既当外层 wrapper
      （需要 flex:9 横向占位）又当滚动容器（需要 overflow-y:auto）。
      这里再分一层 .item-detail-scroll 专门承担滚动，与 .todo-sidebar / .todo-list-panel 同款。
      之前的 bug：表单 + 关联文档 + AI 任务按钮全部塞在根元素里，
      当表单字段较多时总高度超出，"运行任务"按钮被挤出可视区，滚到底也只看到 1/5。
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
      <div v-else class="detail-content">
        <el-form label-position="top" size="small">
          <el-form-item label="标题">
            <el-input v-model="formData.title" @blur="handleSave" />
          </el-form-item>

          <el-form-item label="状态">
            <el-select v-model="formData.status" @change="handleStatusChange">
              <el-option label="初始" value="init" />
              <el-option label="进行中" value="in_progress" />
              <el-option label="已完成" value="done" />
              <el-option label="已放弃" value="abandoned" />
            </el-select>
          </el-form-item>

          <el-form-item label="优先级">
            <el-select v-model="formData.priority" @change="handleSave">
              <el-option label="紧急" value="urgent" />
              <el-option label="重要" value="important" />
              <el-option label="普通" value="normal" />
              <el-option label="提示" value="hint" />
            </el-select>
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
              :rows="3"
              @blur="handleSave"
            />
          </el-form-item>

          <el-form-item label="任务提示词（task_prompt）">
            <el-input
              v-model="formData.task_prompt"
              type="textarea"
              :rows="3"
              placeholder="驱动 AI 任务时的上下文提示词"
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

          <el-form-item label="标签">
            <el-select
              v-model="formData.labelIds"
              multiple
              filterable
              allow-create
              default-first-option
              placeholder="选择或创建标签"
              @change="handleLabelChange"
            >
              <el-option
                v-for="label in allLabels"
                :key="label.id"
                :label="label.name"
                :value="label.id"
              />
            </el-select>
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

        <!-- AI 任务区段（Phase 5） -->
        <div class="task-section">
          <div class="docs-header">
            <span class="section-title">AI 任务</span>
          </div>
          <el-button
            v-if="!formData.agent_task_id"
            type="primary"
            size="small"
            @click="$emit('run-task')"
          >
            <el-icon><VideoPlay /></el-icon> 运行任务
          </el-button>
          <div v-else class="task-actions">
            <el-button size="small" @click="$emit('view-task')">
              <el-icon><View /></el-icon> 查看任务面板
            </el-button>
            <el-button size="small" @click="$emit('rerun-task')">
              <el-icon><Refresh /></el-icon> 重跑
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { Plus, Document, VideoPlay, View, Refresh, Loading, Check, Close } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

export default {
  name: 'TodoItemDetail',
  components: { Plus, Document, VideoPlay, View, Refresh, Loading, Check, Close },
  emits: ['updated', 'open-doc', 'run-task', 'view-task', 'rerun-task'],
  props: {
    itemId: { type: Number, required: true },
  },
  data() {
    return {
      loading: true,
      formData: null,
      allLabels: [],
      documents: [],
      hasChildren: false,
      saveTimer: null,
      // 顶部状态条：'idle' | 'saving' | 'saved' | 'error'
      // idle 时不渲染文字；saved/error 2.5s 后回 idle 避免长时间残留
      saveStatus: 'idle',
      saveStatusTimer: null,
    };
  },
  watch: {
    itemId() {
      this.loadDetail();
    },
  },
  async mounted() {
    await this.loadDetail();
    await this.loadLabels();
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
            labelIds: [...(item.label_ids || [])],
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
    async loadLabels() {
      try {
        this.allLabels = await window.todoApp.listLabels();
      } catch (err) {
        console.error(err);
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
    async handleLabelChange(labelIds) {
      // el-select 的 allow-create 把用户新输入的标签名作为"字符串"塞进 v-model，
      // 后端 setItemLabels 拿到非数字 label_id 会触发 FOREIGN KEY constraint failed
      // （todo_item_label.label_id REFERENCES todo_label.id）。
      // 这里先把字符串解析为真实 label id（匹配同名已存在 → 否则 createLabel 新建），
      // 再走统一 runSave 管线调 updateTodoItem。
      let resolvedIds;
      try {
        resolvedIds = await this.resolveLabelIds(labelIds);
      } catch (err) {
        this.setSaveStatus('error');
        ElMessage.error(err?.message || '创建标签失败');
        return;
      }
      const ok = await this.runSave(() =>
        window.todoApp.updateTodoItem(this.itemId, { label_ids: resolvedIds }),
      );
      if (ok) {
        // 同步 v-model 为真实 id，避免下次 change 还带字符串触发重复创建
        this.formData.labelIds = resolvedIds;
        // 有新 label 落库时刷新选项列表，让新标签出现在下拉里
        await this.loadLabels();
        this.$emit('updated');
      }
    },
    /**
     * 把 labelIds 数组中的字符串值（el-select allow-create 输入的新标签名）
     * 解析为真实的 label id：
     *   - number：原样返回
     *   - string：先在 allLabels 中按 name 精确匹配（避免重名触发 DB 唯一索引冲突），
     *             找不到则调 createLabel 新建并返回新 id
     * @param {Array<number|string>} labelIds
     * @returns {Promise<number[]>}
     */
    async resolveLabelIds(labelIds) {
      const resolved = [];
      for (const id of labelIds) {
        if (typeof id === 'number') {
          resolved.push(id);
          continue;
        }
        const name = String(id).trim();
        if (!name) continue;
        const existing = this.allLabels.find((l) => l.name === name);
        if (existing) {
          resolved.push(existing.id);
          continue;
        }
        const created = await window.todoApp.createLabel({ name });
        resolved.push(created.id);
      }
      return resolved;
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
 *          └─ .item-detail-scroll (flex:1, min-height:0, overflow-y:auto) ← 真正的滚动容器
 *
 * 之前的 bug：根元素既当外层 wrapper 又当滚动容器，导致 padding+height:100% 在 attribute
 * inheritance 下高度链不收敛，"运行任务"按钮被挤出可视区。
 */
.todo-item-detail-inner {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 真正的滚动容器：承担所有可滚动内容（表单 + 关联文档 + AI 任务） */
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

/* 章节分隔：渐隐细线代替生硬的实色 border */
.docs-section,
.task-section {
  margin-top: 22px;
  padding-top: 14px;
  position: relative;
}

.docs-section::before,
.task-section::before {
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
</style>
