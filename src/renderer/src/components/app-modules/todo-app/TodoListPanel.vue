<template>
  <div class="todo-list-panel-inner">
    <!-- 顶部：列表选择 / 新建 -->
    <div class="panel-header">
      <el-select
        v-model="currentListId"
        placeholder="选择列表"
        size="small"
        class="list-select"
        @change="handleListChange"
      >
        <el-option
          v-for="l in todoLists"
          :key="l.id"
          :label="l.name"
          :value="l.id"
        />
      </el-select>
      <el-button size="small" type="primary" plain @click="handleCreateList">
        新建列表
      </el-button>
    </div>

    <!-- 标签视图模式：显示标签关联的 item 列表 -->
    <div v-if="labelId" class="label-items">
      <div class="section-title">标签关联条目</div>
      <div v-if="labelItems.length === 0" class="empty-hint">该标签暂无关联条目</div>
      <TodoItemRow
        v-for="item in labelItems"
        :key="item.id"
        :item="item"
        :depth="0"
        :selected-item-id="selectedItemId"
        @toggle-status="handleToggleStatus"
        @select="$emit('select-item', $event)"
      />
    </div>

    <!-- 正常模式：选中 list 后展示 items 树 -->
    <div v-else-if="currentListId" class="item-tree-container">
      <div class="tree-toolbar">
        <span class="section-title">{{ currentListName }}</span>
        <el-button size="small" text @click="handleCreateRootItem">
          <el-icon><Plus /></el-icon> 新建条目
        </el-button>
      </div>
      <div v-if="itemTree.length === 0" class="empty-hint">暂无条目，点击"新建条目"开始</div>
      <TodoItemRow
        v-for="node in itemTree"
        :key="node.id"
        :item="node"
        :depth="node.depth"
        :children="node.children"
        :selected-item-id="selectedItemId"
        @toggle-status="handleToggleStatus"
        @select="$emit('select-item', $event)"
        @create-child="handleCreateChildItem"
      />
    </div>

    <!-- 未选中列表 -->
    <div v-else class="empty-state">
      <el-empty description="请选择一个列表或分类" />
    </div>
  </div>
</template>

<script>
import { Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import TodoItemRow from './TodoItemRow.vue';

export default {
  name: 'TodoListPanel',
  components: { Plus, TodoItemRow },
  props: {
    categoryId: { type: Number, default: null },
    labelId: { type: Number, default: null },
    selectedItemId: { type: Number, default: null },
  },
  data() {
    return {
      todoLists: [],
      currentListId: null,
      itemTree: [],
      labelItems: [],
    };
  },
  computed: {
    currentListName() {
      const found = this.todoLists.find((l) => l.id === this.currentListId);
      return found ? found.name : '';
    },
  },
  watch: {
    categoryId() {
      this.currentListId = null;
      this.itemTree = [];
      this.loadLists();
    },
    labelId() {
      if (this.labelId) {
        this.loadLabelItems();
      }
    },
    currentListId() {
      if (this.currentListId) {
        this.loadItemTree();
      }
    },
  },
  async mounted() {
    await this.loadLists();
  },
  methods: {
    async loadLists() {
      try {
        const catId = this.categoryId ?? undefined;
        this.todoLists = await window.todoApp.listTodoLists(catId);
        if (this.todoLists.length > 0 && !this.currentListId) {
          this.currentListId = this.todoLists[0].id;
        }
      } catch (err) {
        ElMessage.error('加载列表失败');
        console.error(err);
      }
    },
    async loadItemTree() {
      if (!this.currentListId) {
        this.itemTree = [];
        return;
      }
      try {
        this.itemTree = await window.todoApp.getTodoItemTree(this.currentListId);
      } catch (err) {
        ElMessage.error('加载条目失败');
        console.error(err);
      }
    },
    async loadLabelItems() {
      try {
        this.labelItems = await window.todoApp.listTodoItemsByLabel(this.labelId);
      } catch (err) {
        ElMessage.error('加载标签条目失败');
        console.error(err);
      }
    },
    handleListChange(listId) {
      this.$emit('select-list', listId);
    },
    async handleCreateList() {
      try {
        const { value } = await ElMessageBox.prompt('请输入列表名称', '新建列表', {
          confirmButtonText: '创建',
          cancelButtonText: '取消',
        });
        if (value && value.trim()) {
          const created = await window.todoApp.createTodoList({
            name: value.trim(),
            category_id: this.categoryId ?? null,
          });
          await this.loadLists();
          this.currentListId = created.id;
          ElMessage.success('列表已创建');
        }
      } catch (err) {
        if (err !== 'cancel') {
          ElMessage.error(err.message || '创建失败');
        }
      }
    },
    async handleCreateRootItem() {
      await this.promptCreateItem(null);
    },
    async handleCreateChildItem(parentId) {
      await this.promptCreateItem(parentId);
    },
    async promptCreateItem(parentId) {
      try {
        const { value } = await ElMessageBox.prompt('请输入条目标题', '新建条目', {
          confirmButtonText: '创建',
          cancelButtonText: '取消',
        });
        if (value && value.trim()) {
          await window.todoApp.createTodoItem({
            title: value.trim(),
            todo_list_id: this.currentListId,
            parent_id: parentId,
          });
          await this.loadItemTree();
          ElMessage.success('条目已创建');
        }
      } catch (err) {
        if (err !== 'cancel') {
          ElMessage.error(err.message || '创建失败');
        }
      }
    },
    async handleToggleStatus(payload) {
      this.$emit('toggle-status', payload);
      await this.loadItemTree();
    },
  },
};
</script>

<style scoped>
.todo-list-panel-inner {
  height: 100%;
  overflow-y: auto;
  padding: 8px 12px;
}

.panel-header {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}

.list-select {
  flex: 1;
}

.section-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-on-dark, #e0e0e0);
}

.tree-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.empty-hint {
  color: var(--text-on-dark-muted, #666);
  font-size: 13px;
  padding: 12px 0;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
</style>
