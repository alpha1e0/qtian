<template>
  <aside class="sidebar">
    <!-- 顶部：模式切换 + 快捷模式 -->
    <div class="sidebar-top">
      <button
        v-for="item in topItems"
        :key="item.key"
        class="sidebar-btn"
        :class="{ 'is-active': isActive(item) }"
        :aria-label="item.aria"
        :title="item.aria"
        @click="handleSelect(item.key)"
      >
        <el-icon :size="20"><component :is="item.icon" /></el-icon>
      </button>
    </div>

    <!-- 底部：设置 -->
    <div class="sidebar-bottom">
      <button
        v-for="item in bottomItems"
        :key="item.key"
        class="sidebar-btn"
        :class="{ 'is-active': isActive(item) }"
        :aria-label="item.aria"
        :title="item.aria"
        @click="handleSelect(item.key)"
      >
        <el-icon :size="20"><component :is="item.icon" /></el-icon>
      </button>
    </div>
  </aside>
</template>

<script>
import { markRaw } from 'vue';
import { ChatDotRound, ChatRound, Memo, Setting } from '@element-plus/icons-vue';

/**
 * 紧凑图标侧栏（Obsidian 风格）
 *
 * 职责：纯展示组件，仅 emit('select', key)，不直接调 IPC。
 * 激活态单一数据源：由父组件通过 activeMode prop 传入；
 * 'quick-mode' / 'settings' 为瞬时动作型，永不持续激活。
 *
 * 图标组件必须用 markRaw 包装，否则会被 data() 的响应式系统深度代理，
 * 触发 "Component that was made reactive" 警告并可能影响 <component :is> 渲染。
 *
 * 设计文档：docs/specs/003_main-window-shell-design.md §3.1
 */
export default {
  name: 'SideBar',
  props: {
    /**
     * 当前激活模式，决定哪个按钮高亮
     * @type {'ai-assistant' | 'todo-app'}
     */
    activeMode: {
      type: String,
      required: true,
      validator: (v) => ['ai-assistant', 'todo-app'].includes(v),
    },
  },
  emits: ['select'],
  data() {
    return {
      topItems: [
        { key: 'ai-assistant', icon: markRaw(ChatDotRound), label: 'AI 助手', aria: '切换到 AI 助手' },
        { key: 'quick-mode', icon: markRaw(ChatRound), label: '快捷模式', aria: '唤起快捷模式窗口' },
        { key: 'todo-app', icon: markRaw(Memo), label: '待办', aria: '切换到待办应用' },
      ],
      bottomItems: [
        { key: 'settings', icon: markRaw(Setting), label: '设置', aria: '打开设置' },
      ],
    };
  },
  methods: {
    /**
     * 判断按钮是否处于激活态
     * activeMode 仅可能为 'ai-assistant' / 'todo-app'，
     * 因此 quick-mode / settings 天然返回 false。
     * @param {{key: string}} item
     * @returns {boolean}
     */
    isActive(item) {
      return item.key === this.activeMode;
    },
    /**
     * 点击分发 —— Options API 模板上下文中没有 emit，必须经 methods 走 this.$emit
     * @param {string} key - 'ai-assistant' | 'quick-mode' | 'todo-app' | 'settings'
     */
    handleSelect(key) {
      this.$emit('select', key);
    },
  },
};
</script>

<style scoped>
.sidebar {
  width: 48px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  background: var(--surface-dark-secondary);
  border-right: 1px solid var(--border-light);
  /* 侧栏不参与拖窗 */
  -webkit-app-region: no-drag;
  user-select: none;
}

.sidebar-top,
.sidebar-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.sidebar-btn {
  position: relative;
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  color: var(--text-on-dark-muted);
  cursor: pointer;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}

.sidebar-btn:hover {
  background: var(--surface-dark-hover);
  color: var(--text-on-dark-secondary);
}

/* 激活态：左侧 3px 竖条 + 品牌色文字 + 软背景 */
.sidebar-btn.is-active {
  color: var(--accent);
  background: var(--accent-soft);
}

.sidebar-btn.is-active::before {
  content: '';
  position: absolute;
  left: -4px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  border-radius: 0 2px 2px 0;
  background: var(--accent);
}
</style>
