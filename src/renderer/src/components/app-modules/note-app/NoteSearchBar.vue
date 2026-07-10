<template>
  <div class="note-search-bar">
    <el-popover
      :visible="popoverVisible"
      placement="bottom-start"
      :width="popoverWidth"
      trigger="manual"
      popper-class="note-search-popover"
      :show-arrow="false"
      :offset="4"
    >
      <template #reference>
        <el-input
          ref="inputRef"
          v-model="keyword"
          class="search-input"
          size="small"
          placeholder="搜索文档标题与正文"
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
        <div v-else class="result-list" ref="resultList">
          <div
            v-for="(r, idx) in results"
            :key="`r-${r.id}`"
            class="result-item"
            :class="{ active: idx === activeIndex }"
            @mouseenter="activeIndex = idx"
            @click="emitJump(r)"
          >
            <el-icon class="type-icon"><Document /></el-icon>
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
            <el-tag size="small" type="info" class="type-tag">文档</el-tag>
          </div>
        </div>
      </div>

      <!-- 历史模式 -->
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
import { Search, Clock, Close, Document } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { NOTE_SEARCH_DEBOUNCE_MS, NOTE_SEARCH_HISTORY_LIMIT } from './constants';

/**
 * Note 全文搜索栏。
 *
 * 行为：
 * - 聚焦时：输入为空 → 显示搜索历史；非空 → 显示防抖后的搜索结果
 * - 输入：防抖触发 window.noteApp.search
 * - 键盘：上下选择；Enter 跳转；Esc 关闭
 * - 历史：单条删除 + 一键清空
 */
export default {
  name: 'NoteSearchBar',
  components: { Search, Clock, Close, Document },
  emits: ['jump-to-result'],
  data() {
    return {
      keyword: '',
      results: [],
      history: [],
      activeIndex: -1,
      popoverVisible: false,
      debounceTimer: null,
      loading: false,
      popoverWidth: 420,
    };
  },
  watch: {
    keyword(val) {
      const trimmed = (val || '').trim();
      if (trimmed.length === 0) {
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
    scheduleSearch(query) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.runSearch(query);
      }, NOTE_SEARCH_DEBOUNCE_MS);
    },
    async runSearch(query) {
      this.loading = true;
      try {
        this.results = await window.noteApp.search(query);
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
        this.history = await window.noteApp.listSearchHistory(NOTE_SEARCH_HISTORY_LIMIT);
      } catch (err) {
        console.error('load history failed', err);
        this.history = [];
      }
    },
    handleFocus() {
      if ((this.keyword || '').trim().length === 0) {
        this.loadHistory();
      }
      this.popoverVisible = true;
    },
    handleBlur() {
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
    emitJump(result) {
      this.$emit('jump-to-result', result);
      this.popoverVisible = false;
    },
    handlePickHistory(query) {
      this.keyword = query;
      this.popoverVisible = true;
    },
    async handleDeleteHistory(id) {
      try {
        await window.noteApp.deleteSearchHistory(id);
        await this.loadHistory();
      } catch (err) {
        ElMessage.error('删除历史失败');
      }
    },
    async handleClearAll() {
      try {
        await window.noteApp.clearSearchHistory();
        this.history = [];
      } catch (err) {
        ElMessage.error('清空历史失败');
      }
    },
    currentList() {
      return this.isResultMode() ? this.results : this.history;
    },
    currentListLength() {
      return this.currentList().length;
    },
    isResultMode() {
      return (this.keyword || '').trim().length > 0;
    },
  },
};
</script>

<style scoped>
.note-search-bar {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-input {
  flex: 1 1 auto;
  min-width: 0;
}

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
  color: var(--text-on-dark, #1f1e2e);
  font-size: 13px;
  letter-spacing: 0.01em;
  height: 32px;
}

.search-input :deep(.el-input__inner::placeholder) {
  color: var(--text-on-dark-muted, #908e9f);
}

.search-icon {
  color: var(--text-on-dark-muted, #908e9f);
  transition: color 0.2s ease;
}

.search-input :deep(.el-input__wrapper.is-focus) .search-icon,
.search-input :deep(.el-input__wrapper:hover) .search-icon {
  color: var(--text-on-dark-secondary, #5f5e6e);
}

.search-input :deep(.el-input__clear:hover) {
  color: var(--text-on-dark-secondary, #5f5e6e);
}

.empty-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 22px 12px;
  color: var(--text-muted, #909399);
  font-size: 13px;
  font-style: italic;
  justify-content: center;
  letter-spacing: 0.02em;
}

.result-list,
.history-list {
  max-height: 400px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-behavior: smooth;
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
  color: var(--text-on-dark, #1f1e2e);
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
  color: var(--accent, #6366f1);
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
  color: var(--text-on-dark-secondary, #5f5e6e);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

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
  color: var(--text-on-dark-muted, #908e9f);
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
  color: var(--accent-text, #4f46e5);
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
  color: var(--text-on-dark-muted, #908e9f);
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
  color: var(--text-on-dark-muted, #908e9f);
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.06);
}

.history-delete {
  flex-shrink: 0;
  padding: 2px;
  color: var(--text-on-dark-muted, #908e9f);
}

.history-delete:hover {
  color: var(--color-danger, #ef4444);
}
</style>

<!--
  popover 全局样式（非 scoped）—— el-popper teleport 到 body，scoped 无法穿透。
-->
<style>
.note-search-popover.el-popper {
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

.note-search-popover.el-popper .el-popper__arrow::before {
  background: rgba(255, 255, 255, 0.96);
  border-color: rgba(99, 102, 241, 0.18);
}
</style>
