// scf/index.js
// 腾讯云 Web 函数入口（Express）。所有 /api/* 路由集中在此，单函数部署；
// 同时用 express.static 托管根目录前端静态文件（index.html / style.css / app.js），
// 访问函数根路径 / 即返回 index.html。
const express = require('express');
const path = require('path');
const cors = require('cors');

const addActivity = require('./routes/addActivity');
const addUnanswered = require('./routes/addUnanswered');
const getQuestions = require('./routes/getQuestions');
const replyQuestion = require('./routes/replyQuestion');
const chat = require('./routes/chat');

const app = express();

// CORS 中间件（双重保险：即便前端与后端不同源，/api 调用也能正常跨域）
app.use(cors());

app.use(express.json()); // 解析 application/json 请求体

// 统一挂在 /api 下，与前端现有请求路径（/api/add-activity 等）保持一致
app.use('/api', addActivity);
app.use('/api', addUnanswered);
app.use('/api', getQuestions);
app.use('/api', replyQuestion);
app.use('/api', chat);

// 托管前端静态文件：__dirname 是 scf/，父目录即项目根目录（index.html / style.css / app.js 所在处）
// 访问 / 时会自动返回 index.html。放在 /api 路由之后，避免覆盖 API 路径。
const publicDir = path.join(__dirname, '..');
app.use(express.static(publicDir, { index: 'index.html' }));

// 健康检查（已挪到 /healthz，避免被根路径的 index.html 覆盖）
app.get('/healthz', (req, res) => res.json({ ok: true, service: 'activity-assistant-scf' }));

// Web 函数模式下，腾讯云会 require 本模块并使用导出的 app（无需自行监听）；
// 本地直接运行时（node index.js）则监听端口，便于本地调试。
const port = process.env.PORT || 9000;
if (require.main === module) {
  app.listen(port, () => {
    console.log(`activity-assistant SCF listening on port ${port}`);
  });
}

module.exports = app;
