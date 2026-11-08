# 学院文体活动智能助手 (Campus Activity Assistant)

这是一个专为学院打造的“活动推荐+智能问答”双入口响应式网页系统。旨在解决学院文体活动信息分散、学生难以匹配兴趣与时间、干事重复答疑压力大等痛点。

## 📌 核心功能

*   **学生端**：输入空闲时间与兴趣偏好获取个性化活动推荐；内置 AI 助手，支持基于大模型和飞书实时数据的智能问答。
*   **老师端**：安全隔离的教师后台，支持一键录入新活动、查看 AI 无法回答的“未解答问题”并进行人工回复。
*   **飞书数据中台**：利用飞书多维表格作为轻量级数据库，实现活动数据的动态更新与未解答问题的流转。
*   **完整闭环**：学生提问 -> AI兜底转交 -> 老师后台回复 -> 飞书状态更新 -> 学生端自动提示。

## 🚀 部署到 Cloudflare Pages

后端已迁移为 Cloudflare Pages Functions，文件放在根目录 `functions/` 下，**文件路径即路由**：

| 文件 | 路由 | 说明 |
| --- | --- | --- |
| `functions/api/add-activity.js` | `POST /api/add-activity` | 老师端录入活动，写入飞书多维表格「活动表」 |
| `functions/api/add-unanswered.js` | `POST /api/add-unanswered` | 学生提问兜底，写入飞书多维表格「问题表」 |
| `functions/api/get-questions.js` | `GET /api/get-questions` | 老师端拉取「未解决」的问题列表 |
| `functions/api/reply-question.js` | `POST /api/reply-question` | 老师端回复问题，飞书记录状态改为「已解决」 |
| `functions/api/chat.js` | `POST /api/chat` | 安全代理百炼 / DashScope，前端不再暴露密钥 |
| `functions/api/feishu.js` | （无路由，被上面函数 import） | 获取飞书 `tenant_access_token` |

> 注意：Cloudflare Pages **不会**自动注入 `process.env`，所有密钥都通过 `context.env.变量名` 读取，并在 Cloudflare 控制台配置。

### 需要在 Cloudflare 控制台配置的环境变量
位置：项目 **Settings → Environment variables**（建议同时配置 Production 和 Preview）。

| 变量名 | 作用 | 备注 |
| --- | --- | --- |
| `FEISHU_APP_ID` | 飞书应用 App ID | 用于换取 tenant_access_token |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret | 同上 |
| `FEISHU_APP_TOKEN` | 飞书多维表格（Bitable）的 app_token | 活动表与问题表共用同一个多维表格应用 |
| `FEISHU_TABLE_Q` | 「问题表」的 table_id | `add-unanswered` 使用 |
| `FEISHU_TABLE_A` | 「活动表」的 table_id | `add-activity` 使用（新增） |
| `BAILIAN_API_KEY` | 百炼 / 通义 DashScope API Key | 由 `chat.js` 安全读取并转发到 DashScope（前端已不再直连） |
| `BAILIAN_APP_ID` | 百炼 / DashScope 应用 ID | DashScope 补全接口 URL 中的 `{app_id}`（`chat.js` 使用，新增） |

### 本地调试
在仓库根目录新建 `.dev.vars`（不提交到 git）写入上述变量，`wrangler dev` 即可本地读取：
```
FEISHU_APP_ID=xxx
FEISHU_APP_SECRET=xxx
FEISHU_APP_TOKEN=xxx
FEISHU_TABLE_Q=xxx
FEISHU_TABLE_A=xxx
BAILIAN_API_KEY=xxx
```