<template>
  <div class="homepage-container">
    <!-- AI 搜索区域 -->
    <div class="search-section">
      <el-input
        v-model="searchQuery"
        placeholder="输入问题或命令..."
        class="search-input"
        @keyup.enter="handleSearch"
        clearable
        aria-label="搜索输入框"
      >
        <template #append>
          <el-button :icon="Search" @click="handleSearch" aria-label="搜索">搜索</el-button>
        </template>
      </el-input>
    </div>

    <!-- 常用 AI 命令区域 -->
    <div class="commands-section">
      <div class="section-title">常用命令</div>
      <div class="commands-grid">
        <el-tag
          v-for="(cmd, index) in aiCommands"
          :key="index"
          type="success"
          class="command-tag"
          @click="handleCommandClick(cmd)"
        >
          {{ cmd }}
        </el-tag>
      </div>
    </div>

    <!-- 常用工具区域 -->
    <div class="tools-section">
      <div class="section-title">常用工具</div>
      <div class="tools-grid">
        <div
          v-for="tool in tools"
          :key="tool.name"
          class="tool-card"
          @click="handleToolClick(tool)"
          :aria-label="`${tool.name}工具`"
        >
          <div class="tool-icon">
            <el-icon :size="32">
              <component :is="tool.icon" />
            </el-icon>
          </div>
          <div class="tool-name">{{ tool.name }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { markRaw } from 'vue';
import { Search, MagicStick } from '@element-plus/icons-vue';

export default {
  name: 'Homepage',

  emits: ['navigate'],

  components: { Search, MagicStick },

  data() {
    return {
      searchQuery: '',
      // 供模板 :icon prop 绑定
      Search: markRaw(Search),
      aiCommands: ['翻译这段文字', '总结文档', '搜索本地文档', '创建智能体'],
      tools: [
        {
          name: 'AI助手',
          icon: markRaw(MagicStick),
          route: 'ai-assistant',
        },
      ],
    };
  },

  methods: {
    /**
     * 处理搜索按钮点击
     */
    handleSearch() {
      if (this.searchQuery.trim()) {
        // TODO: 路由到 AI 助手功能并传递搜索查询
        console.log('搜索:', this.searchQuery);
        this.$emit('navigate', 'ai-assistant', { query: this.searchQuery });
      }
    },

    /**
     * 处理命令标签点击
     */
    handleCommandClick(command) {
      // TODO: 路由到 AI 助手功能并传递命令
      console.log('执行命令:', command);
      this.$emit('navigate', 'ai-assistant', { command });
    },

    /**
     * 处理工具卡片点击
     */
    handleToolClick(tool) {
      console.log('打开工具:', tool.name);
      this.$emit('navigate', tool.route);
    },
  },
};
</script>

<style scoped>
.homepage-container {
  width: 100%;
  height: 100vh;
  padding: 40px;
  overflow-y: auto;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 40px;
}

/* 搜索区域 */
.search-section {
  width: 100%;
  max-width: 600px;
}

.search-input {
  font-size: 16px;
}

.search-input :deep(.el-input__wrapper) {
  border-radius: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.search-input :deep(.el-input-group__append) {
  border-radius: 0 24px 24px 0;
  background: #409eff;
  border-color: #409eff;
  color: white;
}

.search-input :deep(.el-input-group__append:hover) {
  background: #66b1ff;
  border-color: #66b1ff;
}

/* 区域标题 */
.section-title {
  font-size: 20px;
  font-weight: 600;
  color: white;
  margin-bottom: 20px;
  text-align: center;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* 常用命令区域 */
.commands-section {
  width: 100%;
  max-width: 600px;
}

.commands-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.command-tag {
  font-size: 14px;
  padding: 12px 16px;
  cursor: pointer;
  justify-content: center;
  height: auto;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.95);
  border: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.3s;
}

.command-tag:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  background: #67c23a;
  color: white;
}

/* 常用工具区域 */
.tools-section {
  width: 100%;
  max-width: 800px;
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.tool-card {
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.tool-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  background: white;
}

.tool-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.tool-name {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .homepage-container {
    padding: 20px;
  }

  .commands-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .tools-grid {
    grid-template-columns: 1fr;
  }
}
</style>
