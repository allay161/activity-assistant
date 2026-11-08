// scf/routes/addUnanswered.js  ->  POST /api/add-unanswered
const express = require('express');
const router = express.Router();
const { getTenantToken } = require('../feishu');

router.post('/add-unanswered', async (req, res) => {
  try {
    const { question, asker } = req.body;

    const token = await getTenantToken();

    const feishuRes = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_Q}/records`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          "提问内容": question,
          "提问人": asker || "匿名学生",
          "状态": "未解决"
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
