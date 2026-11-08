// scf/routes/chat.js  ->  POST /api/chat
// 安全代理百炼 / 通义 DashScope：密钥只在服务端（process.env）读取，前端不持有任何 Key。
const express = require('express');
const router = express.Router();

router.post('/chat', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'prompt 必填' });
    }

    const appId = process.env.BAILIAN_APP_ID;
    const apiKey = process.env.BAILIAN_API_KEY;
    const url = `https://dashscope.aliyuncs.com/api/v1/apps/${appId}/completion`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({
        input: { prompt: prompt },
        parameters: {}
      })
    });

    const data = await upstream.json();
    const text = data?.output?.text
      || data?.output?.choices?.[0]?.message?.content
      || JSON.stringify(data);

    return res.json({ success: true, text });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
