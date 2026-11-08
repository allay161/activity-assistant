// scf/routes/replyQuestion.js  ->  POST /api/reply-question
const express = require('express');
const router = express.Router();
const { getTenantToken } = require('../feishu');

router.post('/reply-question', async (req, res) => {
  try {
    const { record_id, reply } = req.body;
    if (!record_id || !reply) {
      return res.status(400).json({ success: false, error: 'record_id 和回复内容必填' });
    }

    const token = await getTenantToken();

    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_Q}/records/${record_id}`;
    const feishuRes = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          "状态": "已解决",
          "老师回复": reply
        }
      })
    });

    const data = await feishuRes.json();
    return res.json({ success: data.code === 0, data });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
