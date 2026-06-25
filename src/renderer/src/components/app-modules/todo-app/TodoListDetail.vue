<template>
  <div class="todo-list-detail-inner">
    <!--
      内部滚动容器：与 .todo-sidebar / .todo-list-panel / .todo-item-detail 同款。
      根元素 .todo-list-detail-inner 因 Vue attribute inheritance 与父组件传入的
      .todo-item-detail 合并到同一 DOM 元素，无法既当外层 wrapper 又当滚动容器。
      分一层 .list-detail-scroll 专门承担滚动，文档多时不会被外层裁切。
    -->
    <div class="list-detail-scroll">
      <!-- 头部：项目名 + 新建文档 -->
      <div class="list-header">
        <span class="section-title" :title="listName">{{ listName || '待办项目' }}</span>
        <el-button size="small" type="primary" plain @click="handleCreateDoc">
          <el-icon><Plus /></el-icon>
          <span>新建文档</span>
        </el-button>
      </div>

      <div v-if="loading" class="loading-hint">加载中...</div>
      <template v-else>
        <div v-if="documents.length === 0" class="empty-hint">暂无文档，点击「新建文档」开始</div>
        <div
          v-for="doc in documents"
          :key="doc.id"
          class="doc-item"
          :title="doc.name"
          @click="handleOpenDoc(doc)"
        >
          <el-icon><Document /></el-icon>
          <span class="doc-name">{{ doc.name }}</span>
          <span class="doc-updated">{{ formatTime(doc.updated_at) }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script>
import { Plus, Document } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

/**
 * TodoListDetail — 待办项目级文档列表 UI（spec §3.5）。
 *
 * document 通过 todo_list_id 直接关联到待办项目，本组件用于 list 维度管理文档，
 * 不包含表单编辑。文档编辑器由父组件 TodoAppPage 通过路由切换内嵌。
 */
export default {
  name: 'TodoListDetail',
  components: { Plus, Document },
  props: {
    listId: { type: Number, required: true },
    /** 项目名称（由父组件从 allTodoLists 解析后传入），用于标题与 titlePath */
    listName: { type: String, default: '' },
  },
  emits: ['open-doc'],
  data() {
    return {
      loading: true,
      documents: [],
    };
  },
  watch: {
    listId() {
      this.loadDocuments();
    },
  },
  async mounted() {
    await this.loadDocuments();
  },
  methods: {
    async loadDocuments() {
      if (!this.listId) {
        this.documents = [];
        this.loading = false;
        return;
      }
      this.loading = true;
      try {
        this.documents = await window.todoApp.listDocsByList(this.listId);
      } catch (err) {
        ElMessage.error('加载文档失败');
        console.error(err);
      } finally {
        this.loading = false;
      }
    },
    async handleCreateDoc() {
      try {
        const { value } = await ElMessageBox.prompt('请输入文档名称', '新建项目文档', {
          confirmButtonText: '创建',
          cancelButtonText: '取消',
        });
        if (!value || !value.trim()) return;
        // 先创建占位文档，再通知父组件打开编辑器（拿到真实 docId）
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
          titlePath: `${this.listName || '项目'} / ${created.name}`,
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
        titlePath: `${this.listName || '项目'} / ${doc.name}`,
      });
    },
    /** 公开给父组件：保存后刷新列表 */
    refresh() {
      return this.loadDocuments();
    },
    formatTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

.list-detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 18px 28px;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
  gap: 10px;
}

.section-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-on-dark);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  letter-spacing: -0.01em;
  background: linear-gradient(135deg, #1f1e2e 0%, #4f46e5 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
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

/* 文档卡片：浮起的档案条目（含更新时间） */
.doc-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.08);
  transition: all 0.18s ease;
  margin-bottom: 8px;
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
  flex-shrink: 0;
}

.doc-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.01em;
}

.doc-updated {
  font-size: 10px;
  color: var(--text-on-dark-muted);
  font-feature-settings: 'tnum';
  flex-shrink: 0;
  letter-spacing: 0.08em;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.06);
}
</style>
