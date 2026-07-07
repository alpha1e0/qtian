<template>
  <div class="todo-search-bar">
    <!--
      使用单向 :visible 绑定（非 v-model:visible）：
      Element Plus 的 popover 内部 onClickOutside 仅在 `controlled = false` 时生效，
      而 controlled = isBoolean(visible) && !hasUpdateHandler。
      v-model 会注入 onUpdate:visible → hasUpdateHandler=true → controlled=false，
      导致 trigger="manual" 模式下，点击 reference(input) 仍被判定为 click outside，
      popover 显示后会被立即关闭（"闪一下"问题）。
      所有关闭路径（Esc / 选结果 / blur）已通过 popoverVisible 手动管理，无需双向同步。
    -->
    <el-popover
      :visible="popoverVisible"
      placement="bottom-start"
      :width="popoverWidth"
      trigger="manual"
      popper-class="todo-search-popover"
      :show-arrow="false"
      :offset="4"
    >
      <template #reference>
        <el-input
          ref="inputRef"
          v-model="keyword"
          class="search-input"
          size="small"
          placeholder="搜索分类 / 待办项目 / 待办条目 / 文档"
          clearable
          @focus="handleFocus"
          @blur="handleBlur"
          @keydown.down.prevent="handleArrowDown"
          @keydown.up.prevent="handleArrowUp"
          @keydown.enter.prevent="handleEnter"
          @keydown.esc.prevent="handleEsc"
        >
          <template #prefix>
            <el-icon class="search-icon"><Search /></el-icon>
          </template>
        </el-input>
      </template>

      <!-- 搜索结果模式 -->
      <div v-if="keyword.trim().length > 0" class="search-content">
        <div v-if="results.length === 0" class="empty-hint">
          <el-icon><Search /></el-icon>
          <span>未找到相关结果</span>
        </div>
        <!-- 结果列表限长 + 内部滚动，避免条目过多时 popover 撑高触发整页滚动 -->
        <div v-else class="result-list" ref="resultList">
          <div
            v-for="(r, idx) in results"
            :key="`${r.type}-${r.id}`"
            class="result-item"
            :class="{ active: idx === activeIndex }"
            @mouseenter="activeIndex = idx"
            @click="emitJump(r)"
          >
            <el-icon class="type-icon"><component :is="typeIcon(r.type)" /></el-icon>
            <div class="result-main">
              <div class="result-title">{{ r.title }}</div>
              <div
                v-if="r.snippet"
                class="result-snippet"
                v-html="r.snippet"
              ></div>
              <div v-if="r.category_path && r.category_path.length > 0" class="result-breadcrumb">
                {{ r.category_path.join(' / ') }}
              </div>
            </div>
            <el-tag size="small" type="info" class="type-tag">{{ typeLabel(r.type) }}</el-tag>
          </div>
        </div>
      </div>

      <!-- 历史模式：输入为空时显示 -->
      <div v-else class="history-content">
        <div v-if="history.length === 0" class="empty-hint">
          <span>暂无搜索历史</span>
        </div>
        <template v-else>
          <div class="history-toolbar">
            <span class="toolbar-title">最近搜索</span>
            <el-button size="small" text type="primary" @click="handleClearAll">
              清空
            </el-button>
          </div>
          <!-- 与 result-list 同步限长 + 内部滚动；toolbar 固定在顶部不随列表滚 -->
          <div class="history-list" ref="historyList">
            <div
              v-for="(h, idx) in history"
              :key="`h-${h.id}`"
              class="history-item"
              :class="{ active: idx === activeIndex }"
              @mouseenter="activeIndex = idx"
              @click="handlePickHistory(h.query)"
            >
              <el-icon class="history-icon"><Clock /></el-icon>
              <span class="history-query">{{ h.query }}</span>
              <span class="history-meta">命中 {{ h.hit_count }}</span>
              <el-button
                size="small"
                text
                class="history-delete"
                title="删除此搜索历史"
                aria-label="删除此搜索历史"
                @click.stop="handleDeleteHistory(h.id)"
              >
                <el-icon><Close /></el-icon>
              </el-button>
            </div>
          </div>
        </template>
      </div>
    </el-popover>
  </div>
</template>

<script>
import { Search, Clock, Close, Folder, Document, Files, Memo } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

/**
 * Todo 全文搜索栏（Phase 3）
 *
 * 行为：
 * - 聚焦时：输入为空 → 显示搜索历史；非空 → 显示防抖后的搜索结果
 * - 输入：300ms 防抖触发 `window.todoApp.search`
 * - 键盘：↑↓ 选择当前项；Enter 跳转；Esc 关闭
 * - 鼠标：点击结果或历史项触发跳转 / 复用历史 query
 * - 历史：单条删除 + 一键清空
 *
 * 设计文档：docs/specs/100_todo-app-design.md §7.4 / §9
 */
export default {
  name: 'TodoSearchBar',
  components: { Search, Clock, Close, Folder, Document, Files, Memo },
  emits: ['jump-to-result'],
  data() {
    return {
      keyword: '',
      // 搜索结果（输入非空时填充）
      results: [],
      // 搜索历史（聚焦时填充）
      history: [],
      // 当前键盘选中索引（-1 表示无选中）
      activeIndex: -1,
      // popover 显隐
      popoverVisible: false,
      // 防抖句柄
      debounceTimer: null,
      // 是否正在加载（避免快速抖动期间显示旧结果）
      loading: false,
      // popover 宽度（与 input 对齐；响应式调整）
      popoverWidth: 420,
    };
  },
  watch: {
    keyword(val) {
      const trimmed = (val || '').trim();
      if (trimmed.length === 0) {
        // 清空时切回历史视图
        this.results = [];
        this.activeIndex = -1;
        this.loadHistory();
        return;
      }
      this.scheduleSearch(trimmed);
    },
  },
  beforeUnmount() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  },
  methods: {
    /** 防抖 300ms 触发搜索 */
    scheduleSearch(query) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.runSearch(query);
      }, 300);
    },
    async runSearch(query) {
      this.loading = true;
      try {
        this.results = await window.todoApp.search(query);
        this.activeIndex = this.results.length > 0 ? 0 : -1;
        this.popoverVisible = true;
      } catch (err) {
        console.error('search failed', err);
        this.results = [];
      } finally {
        this.loading = false;
      }
    },
    async loadHistory() {
      try {
        this.history = await window.todoApp.listSearchHistory(10);
      } catch (err) {
        console.error('load history failed', err);
        this.history = [];
      }
    },
    handleFocus() {
      // 聚焦时：先加载历史，并展开 popover（无论输入是否为空）
      if ((this.keyword || '').trim().length === 0) {
        this.loadHistory();
      }
      this.popoverVisible = true;
    },
    handleBlur() {
      // 延迟关闭，避免点击 popover 内项时被先 blur 关掉
      setTimeout(() => {
        this.popoverVisible = false;
      }, 200);
    },
    handleArrowDown() {
      if (!this.popoverVisible) {
        this.popoverVisible = true;
        return;
      }
      const total = this.currentListLength();
      if (total === 0) return;
      this.activeIndex = (this.activeIndex + 1) % total;
      this.scrollActiveIntoView();
    },
    handleArrowUp() {
      if (!this.popoverVisible) {
        this.popoverVisible = true;
        return;
      }
      const total = this.currentListLength();
      if (total === 0) return;
      this.activeIndex = (this.activeIndex - 1 + total) % total;
      this.scrollActiveIntoView();
    },
    /**
     * 键盘导航时把 active 项滚入列表可视区，避免选中项被 max-height 截断后不可见。
     * 仅在键盘移动时调用——mouseenter 触发的 active 变化无需滚动（鼠标本就在项上）。
     * 手动用 getBoundingClientRect 计算偏移而非 scrollIntoView，避免触发父级滚动。
     */
    scrollActiveIntoView() {
      const container = this.isResultMode()
        ? this.$refs.resultList
        : this.$refs.historyList;
      if (!container) return;
      const active = container.querySelector('.active');
      if (!active) return;
      const cRect = container.getBoundingClientRect();
      const aRect = active.getBoundingClientRect();
      if (aRect.top < cRect.top) {
        container.scrollTop -= cRect.top - aRect.top;
      } else if (aRect.bottom > cRect.bottom) {
        container.scrollTop += aRect.bottom - cRect.bottom;
      }
    },
    handleEnter() {
      const list = this.currentList();
      if (this.activeIndex < 0 || this.activeIndex >= list.length) {
        return;
      }
      const picked = list[this.activeIndex];
      if (this.isResultMode()) {
        this.emitJump(picked);
      } else {
        this.handlePickHistory(picked.query);
      }
    },
    handleEsc() {
      this.popoverVisible = false;
    },
    /** 跳转到结果 */
    emitJump(result) {
      this.$emit('jump-to-result', result);
      this.popoverVisible = false;
    },
    /** 点击历史项：复用 query 触发搜索 */
    handlePickHistory(query) {
      this.keyword = query;
      // watch 会触发 scheduleSearch；这里直接同步刷新历史视图状态
      this.popoverVisible = true;
    },
    async handleDeleteHistory(id) {
      try {
        await window.todoApp.deleteSearchHistory(id);
        await this.loadHistory();
      } catch (err) {
        ElMessage.error('删除历史失败');
      }
    },
    async handleClearAll() {
      try {
        await window.todoApp.clearSearchHistory();
        this.history = [];
      } catch (err) {
        ElMessage.error('清空历史失败');
      }
    },
    /** 当前显示列表（结果或历史） */
    currentList() {
      return this.isResultMode() ? this.results : this.history;
    },
    currentListLength() {
      return this.currentList().length;
    },
    isResultMode() {
      return (this.keyword || '').trim().length > 0;
    },
    typeIcon(type) {
      switch (type) {
        case 'category':
          return 'Folder';
        case 'todo_list':
          return 'Files';
        case 'todo_item':
          return 'Document';
        case 'document':
          return 'Memo';
        default:
          return 'Document';
      }
    },
    typeLabel(type) {
      switch (type) {
        case 'category':
          return '分类';
        case 'todo_list':
          return '待办项目';
        case 'todo_item':
          return '待办条目';
        case 'document':
          return '文档';
        default:
          return type;
      }
    },
  },
};
</script>

<style scoped>
.todo-search-bar {
  width: 100%;
}

/*
 * 搜索输入：编辑级"档案室卡片"质感
 * 用毛玻璃 + 微微的靛底描边替代默认深灰填充
 */
.search-input :deep(.el-input__wrapper) {
  background: rgba(99, 102, 241, 0.04);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.10) inset;
  border-radius: 10px;
  padding: 4px 12px;
  transition: box-shadow 0.2s ease, background 0.2s ease;
}

.search-input :deep(.el-input__wrapper:hover) {
  background: rgba(99, 102, 241, 0.07);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.22) inset;
}

.search-input :deep(.el-input__wrapper.is-focus) {
  background: rgba(99, 102, 241, 0.06);
  box-shadow:
    0 0 0 1px var(--accent, #6366f1) inset,
    0 0 0 4px rgba(99, 102, 241, 0.12);
}

.search-input :deep(.el-input__inner) {
  color: var(--text-on-dark, #e4e4ed);
  font-size: 13px;
  letter-spacing: 0.01em;
  height: 32px;
}

.search-input :deep(.el-input__inner::placeholder) {
  color: var(--text-on-dark-muted, #5c5b72);
}

.search-icon {
  color: var(--text-on-dark-muted, #5c5b72);
  transition: color 0.2s ease;
}

.search-input :deep(.el-input__wrapper.is-focus) .search-icon,
.search-input :deep(.el-input__wrapper:hover) .search-icon {
  color: var(--text-on-dark-secondary, #8b8aa0);
}

/* 清空按钮配色微调 */
.search-input :deep(.el-input__clear:hover) {
  color: var(--text-on-dark-secondary, #8b8aa0);
}

.empty-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 22px 12px;
  color: var(--text-muted, #9ca3b0);
  font-size: 13px;
  font-style: italic;
  justify-content: center;
  letter-spacing: 0.02em;
}

/*
 * 列表限长 + 内部滚动：
 * - max-height 约 6 条平均结果的高度（result-item 含 snippet 约 74px、history-item 约 36px），
 *   超出在 popover 内部滚动，避免 popover 撑高触发整页滚动。
 * - overscroll-behavior: contain 阻止列表触底/触顶时滚动链传到 body。
 * - scroll-behavior: smooth 让键盘导航滚入更平滑（鼠标滚轮不受影响）。
 */
.result-list,
.history-list {
  /* 6 条典型结果（含 snippet）的高度上限 */
  max-height: 400px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-behavior: smooth;
  /* 2px 边距避免 active 项 inset box-shadow / hover 背景在边缘被裁切 */
  padding: 2px;
  margin: -2px;
}

.result-item,
.history-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-on-dark, #e4e4ed);
  transition: background 0.16s ease, transform 0.16s ease;
}

.result-item.active,
.history-item.active {
  background: rgba(99, 102, 241, 0.12);
  box-shadow: inset 2px 0 0 var(--accent);
}

.result-item:hover,
.history-item:hover {
  background: rgba(99, 102, 241, 0.06);
}

.type-icon,
.history-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--accent);
}

.result-main {
  flex: 1;
  min-width: 0;
}

.result-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.01em;
}

.result-snippet {
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-on-dark-secondary, #8b8aa0);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* snippet 内高亮 mark（来自 FTS5 snippet 函数） */
.result-snippet :deep(mark) {
  background: rgba(245, 158, 11, 0.22);
  color: #b45309;
  padding: 0 3px;
  border-radius: 3px;
  font-weight: 600;
}

.result-breadcrumb {
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-on-dark-muted, #5c5b72);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.type-tag {
  flex-shrink: 0;
  margin-top: 1px;
  font-size: 10px;
  letter-spacing: 0.08em;
  border-radius: 999px;
  padding: 0 8px;
  height: 20px;
  line-height: 18px;
  background: rgba(99, 102, 241, 0.12);
  color: var(--accent-text);
  border: 1px solid rgba(99, 102, 241, 0.24);
}

.history-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 8px;
  border-bottom: 1px solid rgba(99, 102, 241, 0.10);
  margin-bottom: 4px;
}

.toolbar-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #5c5b72);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

.history-query {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.01em;
}

.history-meta {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-on-dark-muted);
  font-feature-settings: 'tnum';
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.06);
}

.history-delete {
  flex-shrink: 0;
  padding: 2px;
  color: var(--text-on-dark-muted, #5c5b72);
}

.history-delete:hover {
  color: var(--color-danger, #ef4444);
}
</style>

<!--
  popover 渲染在 body 末端，scoped 样式无法穿透：
  这里通过全局样式（非 scoped）覆盖 el-popper 内部背景，
  统一为浅色 Aurora Library 卡片质感。
-->
<style>
.todo-search-popover.el-popper {
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(99, 102, 241, 0.18);
  border-radius: 12px;
  box-shadow:
    0 12px 40px rgba(99, 102, 241, 0.16),
    0 0 0 1px rgba(99, 102, 241, 0.06);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  padding: 6px;
}

.todo-search-popover.el-popper .el-popper__arrow::before {
  background: rgba(255, 255, 255, 0.96);
  border-color: rgba(99, 102, 241, 0.18);
}
</style>
