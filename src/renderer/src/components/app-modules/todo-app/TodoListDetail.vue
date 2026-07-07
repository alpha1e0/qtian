<template>
  <div class="todo-list-detail-inner">
    <!--
      内部滚动容器：与 .todo-sidebar / .todo-list-panel / .todo-item-detail 同款。
      根元素 .todo-list-detail-inner 因 Vue attribute inheritance 与父组件传入的
      .todo-item-detail 合并到同一 DOM 元素，无法既当外层 wrapper 又当滚动容器。
      分一层 .list-detail-scroll 专门承担滚动。
    -->
    <div class="list-detail-scroll">
      <!-- 保存状态指示条（沿用 TodoItemDetail 的自动保存反馈模式） -->
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
      <div v-else-if="!formData" class="empty-hint">待办项目不存在</div>
      <div v-else class="detail-content">
        <!--
          总结信息（只读）：用带 border 的 el-descriptions 替代手工平铺的
          summary-row，与 TodoCategoryDetail 保持同一套展示语言。
        -->
        <el-descriptions
          :column="1"
          size="small"
          border
          class="summary-desc"
        >
          <el-descriptions-item label="创建时间">
            {{ formatTime(formData.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="最后修改">
            {{ formatTime(formData.updatedAt) }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 元素信息（可编辑：名称 / 描述，失焦自动保存） -->
        <div class="form-section">
          <el-form label-position="top" size="small">
            <el-form-item label="名称">
              <el-input v-model="formData.name" @blur="handleSave" />
            </el-form-item>
            <el-form-item>
              <template #label>
                <span class="desc-label-wrap">
                  描述
                  <el-button
                    text
                    size="small"
                    class="desc-maximize-btn"
                    aria-label="最大化编辑描述"
                    title="最大化编辑描述"
                    @click="descDialogVisible = true"
                  >
                    <el-icon><FullScreen /></el-icon>
                  </el-button>
                </span>
              </template>
              <el-input
                ref="descInput"
                v-model="formData.description"
                type="textarea"
                :rows="9"
                :maxlength="TODO_DESCRIPTION_MAX_LENGTH"
                show-word-limit
                word-limit-position="outside"
                @blur="handleSave"
              />
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
        </div>

        <!--
          文档区域（标签云展示，与 TodoItemDetail .doc-cloud 视觉一致）：
          docs 以 flex-wrap chip 形式呈现，点击单条拉起抽屉编辑。
          更新时间作为 chip 的次级徽标（hover tooltip 不显示，直接小字徽章贴右侧）。
        -->
        <div class="docs-section">
          <div class="docs-header">
            <span class="section-title">项目文档</span>
            <el-button size="small" text @click="handleCreateDoc">
              <el-icon><Plus /></el-icon> 新建
            </el-button>
          </div>
          <div v-if="documents.length === 0" class="empty-hint">暂无文档</div>
          <div v-else class="doc-cloud">
            <div
              v-for="doc in documents"
              :key="doc.id"
              class="doc-chip"
              role="button"
              tabindex="0"
              :title="`打开「${doc.name}」（更新于 ${formatTime(doc.updated_at)}）`"
              :aria-label="`打开文档 ${doc.name}`"
              @click="handleOpenDoc(doc)"
              @keyup.enter="handleOpenDoc(doc)"
            >
              <el-icon><Document /></el-icon>
              <span class="doc-chip-name">{{ doc.name }}</span>
              <span class="doc-chip-meta">{{ formatTime(doc.updated_at) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- 描述最大化编辑对话框（append-to-body teleport 到 body，不影响布局） -->
    <TodoDescriptionDialog
      v-if="formData"
      v-model:visible="descDialogVisible"
      v-model="formData.description"
      :parent-name="formData.name"
      :context="{ type: 'list', itemId: null, listId: listId }"
      @confirm="handleDescriptionConfirm"
      @created="handleDescriptionCreated"
    />

    <!--
      内联 textarea 右键菜单：选中描述文本后「转换为待办条目」→ 创建为该 list 根级条目。
      与 TodoItemDetail 内联菜单对称，区别仅在 parent_id=null（dialog context.type='list'）。
    -->
    <TodoContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenuItems"
      @command="onCtxCommand"
      @close="ctxMenu.visible = false"
    />
  </div>
</template>

<script>
import { Plus, Document, Loading, Check, Close, FullScreen } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { markRaw } from 'vue';
import { resolveLabelIds } from '@/utils/todo-labels';
import TodoDescriptionDialog from './TodoDescriptionDialog.vue';
import TodoContextMenu from './TodoContextMenu.vue';
import { getDescriptionSelection } from './description-selection';
import { TODO_DESCRIPTION_MAX_LENGTH } from './constants';

/**
 * TodoListDetail — 待办项目详情面板（spec §9.1）。
 *
 * 右侧详情区在选中 todo_list 时显示，结构参考 TodoItemDetail：
 *   - 总结信息（创建时间 / 最后修改，只读）
 *   - 元素信息（名称 / 描述，失焦自动保存）
 *   - 项目文档列表（点击 emit open-doc，父组件路由到 TodoDocumentEditor）
 *
 * 数据来源：getTodoList(listId) 拉取完整数据（含 description），
 * listDocsByList(listId) 拉取文档。组件内部自取 list 名，不再由父组件传 listName。
 */
export default {
  name: 'TodoListDetail',
  components: { Plus, Document, Loading, Check, Close, FullScreen, TodoDescriptionDialog, TodoContextMenu },
  emits: ['updated', 'open-doc'],
  props: {
    listId: { type: Number, required: true },
  },
  data() {
    return {
      // 暴露给模板的常量（spec 描述字段 1200 字上限，单一来源）
      TODO_DESCRIPTION_MAX_LENGTH,
      loading: true,
      // 表单数据：与 IPC 字段对齐（name/description/label_ids 可编辑，时间戳只读展示）
      formData: null,
      documents: [],
      // 全量标签列表（用于 el-select 选项）
      allLabels: [],
      // 顶部状态条：'idle' | 'saving' | 'saved' | 'error'
      saveStatus: 'idle',
      saveStatusTimer: null,
      // 描述最大化编辑对话框显隐
      descDialogVisible: false,
      // 内联 textarea 右键菜单状态（visible + 鼠标坐标 + 选中文本缓存）
      ctxMenu: {
        visible: false,
        x: 0,
        y: 0,
      },
      selectedText: '',
      // 菜单项图标（markRaw 避免组件进入响应式，与 TodoItemRow 同款）
      icons: {
        convert: markRaw(Plus),
      },
    };
  },
  computed: {
    /** 内联 textarea 右键菜单项：单项「转换为待办条目」 */
    ctxMenuItems() {
      return [{ command: 'convert', label: '转换为待办条目', icon: this.icons.convert }];
    },
  },
  watch: {
    listId() {
      this.loadAll();
    },
  },
  async mounted() {
    // 在根元素 capture 阶段委托 contextmenu，onDelegatedContextMenu 内部按 ref
    // 精确比对 event.target，只处理描述 textarea 的右键（与 TodoItemDetail 同方案）。
    this.$el.addEventListener('contextmenu', this.onDelegatedContextMenu, true);
    await this.loadAll();
    await this.loadLabels();
  },
  beforeUnmount() {
    // 清理状态条定时器，避免组件卸载后回调触发 setState on unmounted
    if (this.saveStatusTimer) clearTimeout(this.saveStatusTimer);
    // 移除根元素 capture 阶段的 contextmenu 委托监听
    this.$el.removeEventListener('contextmenu', this.onDelegatedContextMenu, true);
  },
  methods: {
    /**
     * 拉取 list 详情 + 文档列表，合并为一次 loading 周期。
     * 切换 listId 时整体重载，避免文档与表单数据来自不同 list 的 race condition。
     */
    async loadAll() {
      if (!this.listId) {
        this.formData = null;
        this.documents = [];
        this.loading = false;
        return;
      }
      this.loading = true;
      try {
        const list = await window.todoApp.getTodoList(this.listId);
        if (list) {
          this.formData = {
            name: list.name,
            description: list.description ?? '',
            labelIds: [...(list.label_ids || [])],
            createdAt: list.created_at,
            updatedAt: list.updated_at,
          };
          await this.loadDocuments();
        } else {
          this.formData = null;
          this.documents = [];
        }
      } catch (err) {
        ElMessage.error('加载项目详情失败');
        console.error(err);
      } finally {
        this.loading = false;
      }
    },
    /**
     * 根元素 capture 阶段 contextmenu 委托处理（与 TodoItemDetail.onDelegatedContextMenu 同方案）：
     * 只处理描述 textarea 的右键，通过 ref 比对 event.target 精确过滤。
     * 用 capture 在根监听，绕过 el-input inheritAttrs:false 的透传失败，
     * 也无需关心 ref 挂载时序（事件触发时 textarea 必已渲染、ref 必已就绪）。
     * 命中后 stopPropagation 阻止事件冒泡到 document，避免 TodoContextMenu 的
     * document 级 close 监听器在 attachListeners 后立刻触发关掉菜单（详见 TodoItemDetail）。
     */
    onDelegatedContextMenu(event) {
      const descTa = this.$refs.descInput?.textarea
        ?? this.$refs.descInput?.$el?.querySelector?.('textarea');
      if (!descTa || event.target !== descTa) return;
      const text = getDescriptionSelection(event);
      if (text === null) return;
      event.preventDefault();
      event.stopPropagation();
      this.selectedText = text;
      this.ctxMenu.x = event.clientX;
      this.ctxMenu.y = event.clientY;
      this.ctxMenu.visible = true;
    },
    async loadDocuments() {
      try {
        this.documents = await window.todoApp.listDocsByList(this.listId);
      } catch (err) {
        console.error(err);
      }
    },
    async loadLabels() {
      try {
        this.allLabels = await window.todoApp.listLabels();
      } catch (err) {
        console.error(err);
      }
    },
    /**
     * 标签变更：el-select allow-create 把新输入名以"字符串"塞入 v-model，
     * 后端 setListLabels 拿到非数字 id 会触发外键约束失败
     * （todo_list_label.label_id REFERENCES todo_label.id）。
     * 这里先把字符串解析为真实 label id（同名已存在复用 → 否则 createLabel 新建），
     * 再走 runSave 管线调 updateTodoList。
     * 保存成功后 emit 'updated'，让父组件刷新 labels / sidebar 标签云。
     *
     * 标签解析逻辑已抽到共享 utils `@/utils/todo-labels` 的 `resolveLabelIds`，
     * 与 TodoAppPage.handleCreateListUnderCategory 共用，避免重复。
     */
    async handleLabelChange(labelIds) {
      let resolvedIds;
      try {
        resolvedIds = await resolveLabelIds(
          this.allLabels,
          labelIds,
          window.todoApp.createLabel,
        );
      } catch (err) {
        this.setSaveStatus('error');
        ElMessage.error(err?.message || '创建标签失败');
        return;
      }
      const ok = await this.runSave(() =>
        window.todoApp.updateTodoList(this.listId, { label_ids: resolvedIds }),
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
     * 失焦保存：name 非空才发请求，description 一并提交。
     * 成功后 emit 'updated'，让父组件刷新 allTodoLists / sidebar 高亮。
     */
    async handleSave() {
      if (!this.formData) return;
      const name = (this.formData.name || '').trim();
      if (!name) {
        ElMessage.warning('项目名称不能为空');
        return;
      }
      const ok = await this.runSave(() =>
        window.todoApp.updateTodoList(this.listId, {
          name,
          description: this.formData.description,
        }),
      );
      if (ok) this.$emit('updated');
    },
    /**
     * 描述最大化对话框「保存」回调：对话框已 emit 出新描述并 v-model 写回 formData.description，
     * 关闭对话框后复用既有 handleSave 流程（保留 save-status-bar 反馈、updated emit 等副作用），
     * 避免重复一条 IPC 路径。与 TodoItemDetail 同名方法保持一致，便于后续抽公共 mixin。
     * @param {string} newDesc - 用户在对话框中编辑后的描述内容
     */
    handleDescriptionConfirm(newDesc) {
      if (!this.formData) return;
      this.formData.description = newDesc;
      this.descDialogVisible = false;
      this.handleSave();
    },
    /**
     * TodoDescriptionDialog / 内联 textarea 「转换为待办条目」成功后回调：
     * emit updated 让 TodoAppPage 重载 item 树（新根级条目出现在中间面板）。
     * @param {Array} items - 主进程返回的 TodoItem[]
     */
    handleDescriptionCreated(items) {
      this.$emit('updated');
    },
    onCtxCommand({ command }) {
      this.ctxMenu.visible = false;
      if (command === 'convert') {
        this.handleConvert();
      }
    },
    /**
     * 调 IPC 批量创建为该 list 的根级条目（parent_id=null）。
     * 成功后 emit updated 刷新中间面板 item 树。
     */
    async handleConvert() {
      if (!this.listId) {
        ElMessage.warning('缺少创建上下文');
        return;
      }
      try {
        const items = await window.todoApp.createTodoItemsFromText(
          this.selectedText,
          this.listId,
          null,
        );
        ElMessage.success(`已创建 ${items.length} 个条目`);
        this.$emit('updated');
      } catch (err) {
        ElMessage.error(err?.message || '创建失败');
      }
    },
    /**
     * 包装异步保存操作，统一驱动顶部状态条：
     *   saving → (await fn) → saved/error → 2.5s 后回 idle
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
     * saved/error 2.5s 后回 idle；saving 不自动重置，由 runSave 在 IPC 返回后显式切换。
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
    /**
     * 新建文档：先弹框收集名称，落库后通知父组件切换到编辑器视图。
     * 采用"创建+打开"两步，保证父组件能拿到真实 docId。
     */
    async handleCreateDoc() {
      try {
        const { value } = await ElMessageBox.prompt('请输入文档名称', '新建项目文档', {
          confirmButtonText: '创建',
          cancelButtonText: '取消',
        });
        if (!value || !value.trim()) return;
        const created = await window.todoApp.saveDocument({
          name: value.trim(),
          content: '',
          todo_list_id: this.listId,
          todo_item_id: null,
        });
        await this.loadDocuments();
        this.$emit('open-doc', {
          id: created.id,
          listId: this.listId,
          titlePath: `${this.formData?.name || '项目'} / ${created.name}`,
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
        listId: this.listId,
        titlePath: `${this.formData?.name || '项目'} / ${doc.name}`,
      });
    },
    /** 公开给父组件：文档保存后刷新列表 */
    refresh() {
      return this.loadDocuments();
    },
    formatTime(ts) {
      if (!ts) return '—';
      const d = new Date(Number(ts));
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
  },
};
</script>

<style scoped>
/*
 * 三段式布局（与 .todo-sidebar / .todo-list-panel / .todo-item-detail 同款）：
 *   .todo-item-detail (来自父组件；flex:9, overflow-y:auto)
 *     └─ .todo-list-detail-inner (与 .todo-item-detail 合并：Vue attribute inheritance)
 *          └─ .list-detail-scroll (flex:1, min-height:0, overflow-y:auto) ← 真正的滚动容器
 */
.todo-list-detail-inner {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 真正的滚动容器 */
.list-detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 18px 28px;
}

/*
 * 保存状态指示条（与 TodoItemDetail 一致）：
 * sticky top 让滚动时也可见；idle 时不占视觉空间。
 */
.save-status-bar {
  position: sticky;
  top: -18px;
  z-index: 2;
  display: flex;
  justify-content: center;
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

/*
 * 总结信息区：el-descriptions（带 border）
 *
 * 覆盖 Element Plus 默认白底样式以贴合深色 Aurora 基底；
 * 样式语言与 TodoCategoryDetail 保持一致（同一套"信息卡片"观感）。
 */
.summary-desc {
  margin-bottom: 20px;
}

.summary-desc :deep(.el-descriptions__body) {
  background: rgba(99, 102, 241, 0.03);
  border: 1px solid rgba(99, 102, 241, 0.12);
  border-radius: 10px;
  overflow: hidden;
}

.summary-desc :deep(.el-descriptions__table) {
  table-layout: fixed;
}

.summary-desc :deep(.el-descriptions__label.is-bordered-label) {
  background: rgba(99, 102, 241, 0.06);
  color: var(--text-on-dark-muted, #5c5b72);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  width: 38%;
  white-space: nowrap;
}

.summary-desc :deep(.el-descriptions__content) {
  background: transparent;
  color: var(--text-on-dark, #e4e4ed);
  font-size: 13px;
  font-feature-settings: 'tnum';
  letter-spacing: 0.01em;
}

.summary-desc :deep(.el-descriptions__cell) {
  border-color: rgba(99, 102, 241, 0.12) !important;
}

/* 元素信息区（表单）— 沿用 TodoItemDetail 的深色 Aurora 样式 */
.todo-list-detail-inner :deep(.el-form-item__label) {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #5c5b72);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  padding-bottom: 4px;
  line-height: 1.6;
}

.todo-list-detail-inner :deep(.el-input__wrapper),
.todo-list-detail-inner :deep(.el-textarea__inner) {
  background: rgba(99, 102, 241, 0.04);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.10) inset;
  border-radius: 8px;
  transition: box-shadow 0.2s ease, background 0.2s ease;
}

.todo-list-detail-inner :deep(.el-input__wrapper:hover),
.todo-list-detail-inner :deep(.el-textarea__inner:hover) {
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.22) inset;
}

.todo-list-detail-inner :deep(.el-input__wrapper.is-focus),
.todo-list-detail-inner :deep(.el-textarea__inner:focus) {
  box-shadow:
    0 0 0 1px var(--accent, #6366f1) inset,
    0 0 0 4px rgba(99, 102, 241, 0.10);
}

.todo-list-detail-inner :deep(.el-input__inner),
.todo-list-detail-inner :deep(.el-textarea__inner) {
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

/* 章节分隔：渐隐细线（与 TodoItemDetail .docs-section 同款） */
.docs-section {
  margin-top: 22px;
  padding-top: 14px;
  position: relative;
}

.docs-section::before {
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

/* eyebrow 章节标题 */
.section-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #5c5b72);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

/*
 * 文档标签云：flex-wrap chip 布局（与 TodoItemDetail .doc-cloud 视觉一致）。
 * 更新时间作为 chip 内嵌的次级徽标，让用户在云视图中也能识别最近编辑的文档。
 */
.doc-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.doc-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  cursor: pointer;
  user-select: none;
  background: rgba(99, 102, 241, 0.06);
  color: var(--text-on-dark-secondary);
  border: 1px solid rgba(99, 102, 241, 0.20);
  transition: all 0.2s ease;
}

.doc-chip:hover,
.doc-chip:focus-visible {
  background: rgba(99, 102, 241, 0.12);
  color: var(--text-on-dark);
  border-color: rgba(99, 102, 241, 0.36);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.10);
  outline: none;
}

.doc-chip :deep(.el-icon) {
  color: var(--accent);
  flex-shrink: 0;
}

.doc-chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-chip-meta {
  font-size: 10px;
  color: var(--text-on-dark-muted);
  font-feature-settings: 'tnum';
  letter-spacing: 0.06em;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.08);
  flex-shrink: 0;
}

/*
 * 描述字段 label 区：让「描述」文字与 FullScreen 最大化按钮水平排列。
 * 最大化按钮沿用 doc-chip 的 indigo hover 反馈，与详情面板整体视觉语言一致；
 * 默认弱化（透明底 + muted 色），hover 时 indigo 强调，避免喧宾夺主。
 * 与 TodoItemDetail 同名 class 保持样式同源，便于后续抽公共 mixin。
 */
.desc-label-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.desc-maximize-btn {
  --el-button-text-color: var(--text-on-dark-muted, #5c5b72);
  padding: 0 4px;
  height: 18px;
  color: var(--text-on-dark-muted, #5c5b72);
  transition: color 0.18s ease, background 0.18s ease;
}

.desc-maximize-btn :deep(.el-icon) {
  font-size: 13px;
}

.desc-maximize-btn:hover {
  color: var(--accent, #6366f1);
  background: rgba(99, 102, 241, 0.10);
}
</style>
