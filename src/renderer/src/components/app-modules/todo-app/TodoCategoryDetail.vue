<template>
  <div class="todo-category-detail-inner">
    <!--
      内部滚动容器：与 .todo-item-detail / .todo-list-panel 同款三段式。
      根元素 .todo-category-detail-inner 因 Vue attribute inheritance 与父组件传入的
      .todo-item-detail 合并到同一 DOM 元素，无法既当外层 wrapper 又当滚动容器。
      分一层 .category-detail-scroll 专门承担滚动。
    -->
    <div class="category-detail-scroll">
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
      <div v-else-if="!formData" class="empty-hint">分类不存在</div>
      <div v-else class="detail-content">
        <!--
          总结信息（只读）：用带 border 的 el-descriptions 替代手工平铺的
          summary-row，获得对齐良好的 label/value 表格结构与可见边框。
          column=1 → 每行一个字段；size=small → 紧凑 padding。
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
          <el-descriptions-item label="直接子项目数">
            {{ directChildListCount }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 元素信息（可编辑） -->
        <div class="form-section">
          <div v-if="isUncategorized" class="uncategorized-hint">
            系统分类，不可重命名/删除
          </div>
          <el-form label-position="top" size="small">
            <el-form-item label="名称">
              <el-input
                v-model="formData.name"
                :disabled="isUncategorized"
                @blur="handleSave"
              />
            </el-form-item>
          </el-form>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { Loading, Check, Close } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

/**
 * TodoCategoryDetail — 分类详情面板（spec §9.1）。
 *
 * 右侧详情区在选中 category 时显示，结构参考 TodoItemDetail：
 *   - 总结信息（创建时间 / 最后修改 / 直接子项目数，只读）
 *   - 元素信息（名称，失焦自动保存）
 *
 * 数据来源：无独立 getCategoryById IPC，沿用 sidebar 同源 getCategoryTree，
 * 本地 DFS 查找 id === categoryId 拿到 name/created_at/updated_at。
 * 直接子项目数 = listTodoLists(categoryId).length（不含子分类里的）。
 *
 * 特殊：categoryId=0 是前端虚拟"无分类"节点（后端无对应 category 行，
 * 承载 category_id=null 的待办项目），用静态数据填充不查 backend。
 */
export default {
  name: 'TodoCategoryDetail',
  components: { Loading, Check, Close },
  emits: ['updated'],
  props: {
    categoryId: { type: Number, required: true },
  },
  data() {
    return {
      loading: true,
      // 表单数据：与 IPC 字段对齐（name 为可编辑字段，时间戳只读展示）
      formData: null,
      // 直接子 todo_list 数量（不含子分类内嵌套的 list）
      directChildListCount: 0,
      // 顶部状态条：'idle' | 'saving' | 'saved' | 'error'
      saveStatus: 'idle',
      saveStatusTimer: null,
    };
  },
  computed: {
    /**
     * 当前是否为前端虚拟"无分类"节点（id=0）。
     * 该节点为前端构造，后端无对应 category 行（category_id=null 的 list 统一展示在此节点下），
     * 不可重命名/删除，详情面板以只读形式展示。
     */
    isUncategorized() {
      return this.categoryId === 0;
    },
  },
  watch: {
    categoryId() {
      this.loadDetail();
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
     * 加载分类详情：getCategoryTree 后本地 DFS 查找当前节点。
     * 同步拉取直接子 todo_list 数量（listTodoLists(categoryId) 只返回直接子）。
     *
     * 特殊处理：categoryId=0 是前端虚拟"无分类"节点（后端无对应 category 行），
     * 直接用静态数据填充，不查 backend；listTodoLists(null) 拉未分类列表。
     */
    async loadDetail() {
      this.loading = true;
      try {
        // 虚拟"无分类"节点（id=0）：后端无对应行，直接构造静态详情
        if (this.isUncategorized) {
          this.formData = { name: '无分类', createdAt: null, updatedAt: null };
          const lists = await window.todoApp.listTodoLists(null);
          this.directChildListCount = Array.isArray(lists) ? lists.length : 0;
          return;
        }
        const tree = await window.todoApp.getCategoryTree();
        const node = this.findCategoryNode(tree, this.categoryId);
        if (node) {
          this.formData = {
            name: node.name,
            createdAt: node.created_at,
            updatedAt: node.updated_at,
          };
          // listTodoLists(categoryId) 仅返回该 category 直属 todo_list
          const lists = await window.todoApp.listTodoLists(this.categoryId);
          this.directChildListCount = Array.isArray(lists) ? lists.length : 0;
        } else {
          this.formData = null;
          this.directChildListCount = 0;
        }
      } catch (err) {
        ElMessage.error('加载分类详情失败');
        console.error(err);
      } finally {
        this.loading = false;
      }
    },
    /**
     * 在 categoryTree 中 DFS 查找指定 id 的节点。
     * @param {Array} nodes - categoryTree 节点数组
     * @param {number} id - 目标 category id
     * @returns {object|null}
     */
    findCategoryNode(nodes, id) {
      if (!Array.isArray(nodes)) return null;
      for (const node of nodes) {
        if (node.id === id) return node;
        const found = this.findCategoryNode(node.children, id);
        if (found) return found;
      }
      return null;
    },
    /**
     * 失焦保存：仅当 name 非空时调 updateCategory。
     * 成功后 emit 'updated'，让父组件刷新 categoryTree / sidebar 高亮。
     */
    async handleSave() {
      if (!this.formData) return;
      // 虚拟节点不可改名（input disabled 已阻断，此处双保险）
      if (this.isUncategorized) return;
      const name = (this.formData.name || '').trim();
      if (!name) {
        ElMessage.warning('分类名称不能为空');
        return;
      }
      const ok = await this.runSave(() =>
        window.todoApp.updateCategory(this.categoryId, { name }),
      );
      if (ok) this.$emit('updated');
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
    /** 公开给父组件：分类被改名后刷新时间戳与子项目数 */
    refresh() {
      return this.loadDetail();
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
 *   .todo-item-detail (来自父组件 TodoAppPage；flex:9, overflow-y:auto)
 *     └─ .todo-category-detail-inner (与 .todo-item-detail 合并：Vue attribute inheritance)
 *          └─ .category-detail-scroll (flex:1, min-height:0, overflow-y:auto) ← 真正的滚动容器
 */
.todo-category-detail-inner {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 真正的滚动容器 */
.category-detail-scroll {
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
  top: -18px; /* 抵消 .category-detail-scroll 的 padding-top，让条贴住滚动区顶部 */
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
 * 覆盖 Element Plus 默认白底样式以贴合深色 Aurora 基底：
 *   - label 单元格：复用下方表单 label 的 eyebrow 风格（小号大写、letter-spacing）
 *   - content 单元格：透明背景、tnum 数字字体、主文字色
 *   - 单元格边框：低饱和靛蓝细线，避免视觉割裂
 *   - 整体圆角 + 微底色形成一张"信息卡片"
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

/* 带 border 的 label 单元格：eyebrow 风格（与 .el-form-item__label 对齐） */
.summary-desc :deep(.el-descriptions__label.is-bordered-label) {
  background: rgba(99, 102, 241, 0.06);
  color: var(--text-on-dark-muted, #5c5b72);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  width: 38%; /* 给中文 label 留够宽度，避免换行 */
  white-space: nowrap;
}

.summary-desc :deep(.el-descriptions__content) {
  background: transparent;
  color: var(--text-on-dark, #e4e4ed);
  font-size: 13px;
  font-feature-settings: 'tnum';
  letter-spacing: 0.01em;
}

/* 单元格通用：边框颜色统一为低饱和靛蓝细线 */
.summary-desc :deep(.el-descriptions__cell) {
  border-color: rgba(99, 102, 241, 0.12) !important;
}

/* 元素信息区（表单）— 沿用 TodoItemDetail 的深色 Aurora 样式 */
.todo-category-detail-inner :deep(.el-form-item__label) {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #5c5b72);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  padding-bottom: 4px;
  line-height: 1.6;
}

.todo-category-detail-inner :deep(.el-input__wrapper),
.todo-category-detail-inner :deep(.el-textarea__inner) {
  background: rgba(99, 102, 241, 0.04);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.10) inset;
  border-radius: 8px;
  transition: box-shadow 0.2s ease, background 0.2s ease;
}

.todo-category-detail-inner :deep(.el-input__wrapper:hover),
.todo-category-detail-inner :deep(.el-textarea__inner:hover) {
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.22) inset;
}

.todo-category-detail-inner :deep(.el-input__wrapper.is-focus),
.todo-category-detail-inner :deep(.el-textarea__inner:focus) {
  box-shadow:
    0 0 0 1px var(--accent, #6366f1) inset,
    0 0 0 4px rgba(99, 102, 241, 0.10);
}

.todo-category-detail-inner :deep(.el-input__inner),
.todo-category-detail-inner :deep(.el-textarea__inner) {
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

/* 虚拟"无分类"系统提示：弱化样式，仅说明不可编辑 */
.uncategorized-hint {
  font-size: 12px;
  color: var(--text-on-dark-muted, #8b8aa0);
  margin-bottom: 10px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(99, 102, 241, 0.04);
  letter-spacing: 0.02em;
}
</style>
