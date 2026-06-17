<template>
  <div class="todo-category-detail-inner">
    <!-- 头部：分类名 + 新建文档 -->
    <div class="category-header">
      <span class="section-title" :title="categoryName">{{ categoryName || '分类' }}</span>
      <el-button size="small" type="primary" plain @click="handleCreateDoc">
        <el-icon><Plus /></el-icon>
        <span>新建文档</span>
      </el-button>
    </div>

    <div v-if="loading" class="loading-hint">加载中...</div>
    <template v-else>
      <div v-if="documents.length === 0" class="empty-hint">暂无文档，点击"新建文档"开始</div>
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
</template>

<script>
import { Plus, Document } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

/**
 * TodoCategoryDetail — 分类级文档列表 UI（spec §3.5 / §9.1）。
 *
 * 与 TodoItemDetail 的"关联文档"不同：本组件用于 category 维度直接管理文档，
 * 不包含表单编辑。文档编辑器由父组件 TodoAppPage 通过路由切换内嵌。
 */
export default {
  name: 'TodoCategoryDetail',
  components: { Plus, Document },
  props: {
    categoryId: { type: Number, required: true },
    /** 分类名称（由父组件从 categoryTree 解析后传入），用于标题与 titlePath */
    categoryName: { type: String, default: '' },
  },
  emits: ['open-doc'],
  data() {
    return {
      loading: true,
      documents: [],
    };
  },
  watch: {
    categoryId() {
      this.loadDocuments();
    },
  },
  async mounted() {
    await this.loadDocuments();
  },
  methods: {
    async loadDocuments() {
      if (!this.categoryId) {
        this.documents = [];
        this.loading = false;
        return;
      }
      this.loading = true;
      try {
        this.documents = await window.todoApp.listDocsByCategory(this.categoryId);
      } catch (err) {
        ElMessage.error('加载文档失败');
        console.error(err);
      } finally {
        this.loading = false;
      }
    },
    async handleCreateDoc() {
      try {
        const { value } = await ElMessageBox.prompt('请输入文档名称', '新建分类文档', {
          confirmButtonText: '创建',
          cancelButtonText: '取消',
        });
        if (!value || !value.trim()) return;
        // 先创建占位文档，再通知父组件打开编辑器（拿到真实 docId）
        const created = await window.todoApp.saveDocument({
          name: value.trim(),
          content: '',
          todo_category_id: this.categoryId,
          todo_item_id: null,
        });
        await this.loadDocuments();
        this.$emit('open-doc', {
          id: created.id,
          categoryId: this.categoryId,
          titlePath: `${this.categoryName || '分类'} / ${created.name}`,
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
        categoryId: this.categoryId,
        titlePath: `${this.categoryName || '分类'} / ${doc.name}`,
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
.todo-category-detail-inner {
  padding: 12px;
  height: 100%;
  overflow-y: auto;
}

.category-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-on-dark, #e0e0e0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.loading-hint,
.empty-hint {
  color: var(--text-on-dark-muted, #666);
  font-size: 13px;
  text-align: center;
  padding: 24px 0;
}

.doc-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.1s;
}

.doc-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.doc-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-updated {
  font-size: 11px;
  color: var(--text-on-dark-muted, #666);
  flex-shrink: 0;
}
</style>
