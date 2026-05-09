## About

快捷模式用于*一次性*、*临时性*的对话

快捷模式和普通模式，后端接口完全一致，仅交互不同

## UI交互

通过 `ctrl+q` 快捷键唤起：

- 当前应用在后台或任务栏，则唤起窗口
- 当前应用在前台，则切换为快捷模式窗口

快捷模式页面分为两种状态：

1. **初始状态**，仅包含输入框，布局如下:

```xml
<ChatInput>
	<FullScreenIconButton onhover="切换到完整对话模式" (top-right)>
	</FullScreenIconButton>
	<TextArea>
	<TextArea>
	<Row>
		<ItemLeft>
			<OperationList (flex-start)>
				<Select>
					场景选择下拉列表
				</Select>
				<Select>
					模型选择下拉列表
				</Select>
			</OperationList>
		</ItemLeft>
		<ItemRight>
			<IconButton>
				提交
			</IconButton>
		</ItemRight>
	</Row>
</ChatInput>
```

2. **回答后状态**，布局如下：

```xml
<FullScreenIconButton onhover="切换到完整对话模式" (top-right)>
</FullScreenIconButton>
<LineSpliter/>
<Card>
	[用户输入的问题]
</Card>
<BubbldBody (block)>
    markdown展示（使用markdown-it库）
</BubbldBody>
<IconButtonRow (bottom-right)>
	<RefreshIconButton (bottom-right) onhover="重新生成" onclick="重新生成">
	</RefreshIconButton>
	<PlusIconButton (bottom-right) onhover="创建新对话" onclick="创建新对话">
	</PlusIconButton>
</IconButtonRow>
```
