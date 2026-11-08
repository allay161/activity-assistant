# 学院文体活动智能助手 (Campus Activity Assistant)

这是一个专为学院打造的“活动推荐+智能问答”双入口响应式网页系统。旨在解决学院文体活动信息分散、学生难以匹配兴趣与时间、干事重复答疑压力大等痛点。

## 📌 核心功能

*   **学生端**：输入空闲时间与兴趣偏好获取个性化活动推荐；内置 AI 助手，支持基于大模型和飞书实时数据的智能问答。
*   **老师端**：安全隔离的教师后台，支持一键录入新活动、查看 AI 无法回答的“未解答问题”并进行人工回复。
*   **飞书数据中台**：利用飞书多维表格作为轻量级数据库，实现活动数据的动态更新与未解答问题的流转。
*   **完整闭环**：学生提问 -> AI兜底转交 -> 老师后台回复 -> 飞书状态更新 -> 学生端自动提示。

## 🚀 部署到腾讯云云函数 (SCF · Web 函数 + Express)

后端已重构为腾讯云 **Web 函数**，使用 Express 在**单个函数**内集中处理所有 `/api/*` 路由，代码位于仓库根目录的 `scf/` 文件夹：

| 文件 | 路由 | 说明 |
| --- | --- | --- |
| `scf/index.js` | （入口） | Express 应用，挂载下面所有路由，监听 9000 端口 |
| `scf/feishu.js` | — | 获取飞书 `tenant_access_token` |
| `scf/routes/addActivity.js` | `POST /api/add-activity` | 老师端录入活动，写入飞书「活动表」（状态=已发布） |
| `scf/routes/addUnanswered.js` | `POST /api/add-unanswered` | 学生提问兜底，写入飞书「问题表」（状态=未解决） |
| `scf/routes/getQuestions.js` | `GET /api/get-questions` | 老师端拉取「未解决」问题列表 |
| `scf/routes/replyQuestion.js` | `POST /api/reply-question` | 老师端回复问题，飞书状态改为「已解决」并写入「老师回复」 |
| `scf/routes/chat.js` | `POST /api/chat` | 安全代理百炼 / DashScope，前端不再暴露密钥 |

> 注意：腾讯云 SCF 通过 **`process.env`** 注入环境变量（与本地 Node 一致），代码里用 `process.env.变量名` 读取；处理函数入口为 Express 的 `req/res`，不再是 Cloudflare 的 `context`。

### 部署步骤（腾讯云控制台）
1. 进入 **云函数 SCF → 新建 → Web 函数**，运行环境选 **Node.js 18 及以上**（自带 `fetch`）。
2. **上传整个项目根目录**（而不是只上传 `scf/`）。后端代码在 `scf/`，前端静态文件 `index.html` / `style.css` / `app.js` 在根目录——两者都要一起上传；函数入口（执行文件）填写 **`scf/index.js`**。该入口会用 `path.join(__dirname, '..')` 定位到项目根目录，从而用 `express.static` 直接托管这些前端文件，**访问函数根路径 `/` 即返回 `index.html`**。
3. 在函数 **函数管理 → 函数配置 → 环境变量** 中配置下方 7 个变量（注意勾选环境变量持久化）。
4. 保存并测试：访问函数生成的 URL，例如 `GET <你的域名>/api/get-questions` 应返回 JSON；直接访问 `<你的域名>/` 应返回前端页面。
5. 绑定自定义域名 / HTTPS 在 **API 网关** 处操作。后端已开启 `cors` 中间件（双重保险）：即使前端与后端不同源，`/api/*` 也能跨域调用；若前端与后端同域（都走这个函数），则静态页面与 API 天然同源，CORS 不会触发。

### 需要在函数配置里配置的环境变量

| 变量名 | 作用 | 备注 |
| --- | --- | --- |
| `FEISHU_APP_ID` | 飞书应用 App ID | 用于换取 tenant_access_token |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret | 同上 |
| `FEISHU_APP_TOKEN` | 飞书多维表格（Bitable）的 app_token | 活动表与问题表共用同一个多维表格应用 |
| `FEISHU_TABLE_Q` | 「问题表」的 table_id | `addUnanswered` / `getQuestions` / `replyQuestion` 使用 |
| `FEISHU_TABLE_A` | 「活动表」的 table_id | `addActivity` 使用 |
| `BAILIAN_API_KEY` | 百炼 / 通义 DashScope API Key | 由 `chat.js` 安全读取并转发到 DashScope（前端已不再直连） |
| `BAILIAN_APP_ID` | 百炼 / DashScope 应用 ID | DashScope 补全接口 URL 中的 `{app_id}`（`chat.js` 使用） |

### 本地调试
在 `scf/` 目录下 `npm install` 安装 express，再设置环境变量后 `npm start`（监听 9000）：
```bash
cd scf && npm install
FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx FEISHU_APP_TOKEN=xxx \
FEISHU_TABLE_Q=xxx FEISHU_TABLE_A=xxx BAILIAN_API_KEY=xxx BAILIAN_APP_ID=xxx \
npm start
# 另开终端测试：curl http://localhost:9000/api/get-questions
```