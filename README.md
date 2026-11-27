# 学院文体活动智能助手 (Campus Activity Assistant)

这是一个专为学院打造的“活动推荐+智能问答”双入口响应式网页系统。旨在解决学院文体活动信息分散、学生难以匹配兴趣与时间、干事重复答疑压力大等痛点。

## 📌 核心功能

前端为多标签单页应用，顶部三个 Tab 切换（不刷新、聊天记录保留）：

*   **智能问答**：基于大模型 + 飞书实时数据的 AI 对话，支持空闲时间/兴趣推荐与快捷提问；答不上来的问题自动转交老师。
*   **活动时间表**：按开始时间排序、按日期分组的时间轴，展示近期活动，并按名称标注分类图标（讲座🎓 / 文体🏀 / 读书📖 / 志愿🤝）。
*   **往期回顾**：已结束活动的网格卡片，自动置灰归档。

老师端独立入口，分三个板块：

*   **录入活动 / 活动管理 / 问题回复**；支持回复与修改已回复问题的回答，每条活动与问题均可【在飞书打开】直达该记录编辑。
*   **飞书数据中台**：飞书多维表格（同一 base 下的活动表 + 问题表）作为轻量级数据库，数据改动实时生效。
*   **完整闭环**：学生提问 → AI 兜底转交（后端语义去重，避免同义问题重复）→ 老师回复 → 飞书状态更新 → 学生端提示。

## 🚀 部署到腾讯云 CloudBase 云托管（Express 容器）

后端部署在腾讯云 **云开发 CloudBase → 云托管（容器）**，使用 Express 在**单个服务**内集中处理所有 `/api/*` 路由，同时托管前端静态页。代码位于仓库根目录：

| 文件 | 路由 | 说明 |
| --- | --- | --- |
| `scf/index.js` | （入口） | Express 应用，挂载下面所有路由，`listen(9000, '0.0.0.0')` 常驻；并用 `express.static` 托管根目录前端文件，访问 `/` 返回 `index.html` |
| `Dockerfile` | — | 基于 `node:22-alpine`，配置东八区时区 + 腾讯云 npm 源，安装生产依赖、暴露 9000 端口、`CMD node scf/index.js` |
| `.dockerignore` | — | 构建时排除 `.git/`、`.workbuddy/`、`node_modules/`、`output/` 等非运行文件 |
| `scf/feishu.js` | — | 获取飞书 `tenant_access_token` |
| `scf/routes/addActivity.js` | `POST /api/add-activity` | 老师端录入活动，写入飞书「活动表」（状态=已发布） |
| `scf/routes/getActivities.js` | `GET /api/get-activities` | 拉取全部活动，供学生端时间轴/往期回顾渲染 |
| `scf/routes/addUnanswered.js` | `POST /api/add-unanswered` | 学生提问兜底，写入飞书「问题表」（状态=未解决）；写入前做语义去重 |
| `scf/routes/getQuestions.js` | `GET /api/get-questions` | 老师端拉取「未解决」问题 + 近期「已解决」问题（带回复，可修改） |
| `scf/routes/replyQuestion.js` | `POST /api/reply-question` | 老师端回复/修改回复，飞书状态改为「已解决」并写入「老师回复」 |
| `scf/routes/chat.js` | `POST /api/chat` | 安全代理百炼 / DashScope，并注入飞书实时上下文；前端不暴露密钥 |
| `scf/feishuUrl.js` | — | 拼飞书单条记录深链（活动表用 `FEISHU_TABLE_A`，问题表用 `FEISHU_TABLE_Q`） |
| `GET /healthz` | — | 健康检查，返回 `{"ok":true,...}` |

> 注意：CloudBase 云托管通过 **`process.env`** 注入环境变量（与本地 Node 一致），代码里用 `process.env.变量名` 读取。服务需持续监听 `0.0.0.0:9000`（`index.js` 已去掉 `require.main` 判断，强制监听），由平台路由到容器端口。后端还开启了 `cors` 中间件（双重保险）。

### 部署步骤（腾讯云控制台）
1. 进入 **云开发 CloudBase → 你的环境 → 云托管 → 新建服务**。
2. 部署方式选 **上传代码包（ZIP）**，上传**整个项目根目录**的压缩包（包含 `index.html` / `style.css` / `app.js` / `Dockerfile` / `scf/`；**不要**包含 `node_modules/`、`.git/`、`.workbuddy/`）。平台会按根目录的 `Dockerfile` 构建镜像并启动 `node scf/index.js`。
3. 在 **云托管服务 → 服务配置 → 环境变量** 中配置下方 8 个变量（注意持久化 / 勾选后重新部署）。
4. 保存并等待部署完成，测试：访问 `<服务公网域名>/healthz` 应返回 JSON；`<域名>/` 返回前端页面；`GET <域名>/api/get-questions` 返回 JSON。
5. 绑定自定义域名 / HTTPS 在 **云托管 → 访问服务 / 域名管理** 处操作。前端 `app.js` 中 `BASE_URL` 目前为空字符串（前后端同域）；若前端另处部署需跨域，改为后端域名即可（CORS 已开启）。

### 需要在服务配置里配置的环境变量

| 变量名 | 作用 | 备注 |
| --- | --- | --- |
| `FEISHU_APP_ID` | 飞书应用 App ID | 用于换取 tenant_access_token |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret | 同上 |
| `FEISHU_APP_TOKEN` | 飞书多维表格（Bitable）的 app_token | 活动表与问题表共用同一个多维表格应用 |
| `FEISHU_TABLE_Q` | 「问题表」的 table_id | `addUnanswered` / `getQuestions` / `replyQuestion` 使用 |
| `FEISHU_TABLE_A` | 「活动表」的 table_id | `addActivity` / `getActivities` 使用 |
| `FEISHU_SHEET_URL` | 活动表与问题表所在的**同一个**多维表格的浏览器链接（含 app_token） | 老师端【在飞书打开】用；从浏览器地址栏复制整条 URL 即可。两张表在同一个多维表格里、只是 table_id 不同，后端会分别用 `FEISHU_TABLE_A` / `FEISHU_TABLE_Q` 覆盖 `table` 参数，并补上 `record` 定位到单条记录。不配置则按钮会提示未配置 |
| `BAILIAN_API_KEY` | 百炼 / 通义 DashScope API Key | 由 `chat.js` 安全读取并转发到 DashScope（前端已不再直连） |
| `BAILIAN_APP_ID` | 百炼 / DashScope 应用 ID | DashScope 补全接口 URL 中的 `{app_id}`（`chat.js` 使用） |

### 本地调试
在 `scf/` 目录下 `npm install` 安装依赖，再设置环境变量后 `npm start`（监听 9000）：
```bash
cd scf && npm install
FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx FEISHU_APP_TOKEN=xxx \
FEISHU_TABLE_Q=xxx FEISHU_TABLE_A=xxx FEISHU_SHEET_URL=https://xxx.feishu.cn/base/xxx \
BAILIAN_API_KEY=xxx BAILIAN_APP_ID=xxx \
npm start
# 另开终端测试：curl http://localhost:9000/api/get-questions
```

> 📘 完整交接资料见根目录《项目交付手册.md》（架构、环境变量、日常维护、故障排查 Q&A）。