## 1 AI Assistant 对话页面UI设计


### 1.1 消息气泡设计

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


### 1.2 交互输入布局

交互输入是用户表达自己意图的地方，包含文本、图像、语音输入，以及一些常用功能，例如模型选择、场景选择、复制、翻译等

布局如下：

```xml
<ChatInput>
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


### 1.3 对话区域设计

对话区域UI布局：

```xml
<SideBar>
	<List 对话历史>
	</List>
</SideBar>
<MainContainer 对话区域>
	<FlexColumn>
		<BuddleContainer/>
		<BuddleContainer/>
		...
	</FlexColumn>
	<ChatInput>
	</ChatInput>
</MainContainer>
```