## AI Assistant 对话页面UI设计


### 消息气泡设计

也称为bubble组件，用于展示AI对话中的富文本信息

消息气泡UI布局

```xml
<BubbleContainer>
	<BubbleHeader (block)>
		<FlexRow>
			<UserIcon/> <Span>角色名称<Span> | <Span>模型名称</Span> | <Small>时间</Small>
		</FlexRow>
	</BubbleHeader>
	<If 消息展示状态>
		<BubbldBody (block)>
			markdown展示（使用markdown-it库）
		</BubbldBody>
		<BubbleOperation (block)>
			<RetryIcon onclick="重新生成"/><EditIcon onclick="编辑消息"/><DeleteIcon onclick="删除消息"/><CopyIcon onclick="复制消息"/>
		</BubbleOperation>
	</IfEnd 消息展示状态>
	<If 消息编辑状态>
		<BubbldBody (block)>
			<TextArea>消息编辑</TextArea>
		</BubbldBody>
		<BubbleOperation (block)>
			<CancleIcon onclick="取消编辑并退回到消息展示状态"/><SaveIcon onclick="保存并退回到消息展示状态"/>
		</BubbleOperation>
	</IfEnd 消息编辑状态>
</BubbleContainer>
```

注意：

- 消息气泡可以展示、也可以编辑
- User message 靠右展示，Assistant message靠左展示

### 对话区域设计

对话区域UI布局：

```xml
<FlexColumn>
    <BuddleContainer/>
    <BuddleContainer/>
    ...
</FlexColumn>
```