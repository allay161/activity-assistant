// scf/index.js
// 适配腾讯云 CloudBase Run（云托管）的 Express 入口文件。
// 同时处理 /api/* 接口请求，并托管根目录的前端静态文件。

const express = require('express');
const path = require('path');
const cors = require('cors');

// 引入路由
const addActivity = require('./routes/addActivity');
const addUnanswered = require('./routes/addUnanswered');
const getQuestions = require('./routes/getQuestions');
const replyQuestion = require('./routes/replyQuestion');
const chat = require('./routes/chat');

const app = express();

// 1. 基础中间件
app.use(cors()); // 允许跨域请求（防止你前端在本地跑时被拦截）
app.use(express.json()); // 解析 JSON 格式的请求体
app.use(express.urlencoded({ extended: true })); // 解析表单数据

// 2. API 路由挂载
app.use('/api', addActivity);
app.use('/api', addUnanswered);
app.use('/api', getQuestions);
app.use('/api', replyQuestion);
app.use('/api', chat);

// 3. 静态文件托管（前端页面）
// __dirname 是 scf 目录，'..' 代表上一级目录（即项目的根目录，你的 index.html 所在位置）
const publicDir = path.join(__dirname, '..');
app.use(express.static(publicDir, { index: 'index.html' }));

// 4. 健康检查接口
app.get('/healthz', (req, res) => res.json({ ok: true, service: 'activity-assistant' }));

// 5. 启动服务（关键修改！）
// CloudBase Run 需要程序持续监听端口。去掉了原先的 require.main 判断，强制监听。
const port = process.env.PORT || 9000; // 如果环境变量没给端口，默认用 9000（和你的截图一致）

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;