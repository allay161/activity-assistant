// scf/routes/getQuestions.js  ->  GET /api/get-questions
const express = require('express');
const router = express.Router();
const { getTenantToken } = require('../feishu');

router.get('/get-questions', async (req, res) => {
  try {
    const token = await getTenantToken();

    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_Q}/records?page_size=100`;
    const feishuRes = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await feishuRes.json();

    const items = (data.data && data.data.items) || [];
    const questions = items
      .filter(it => (it.fields && it.fields["状态"]) === "未解决")
      .map(it => ({
        record_id: it.record_id,
        question: it.fields["提问内容"] || "",
        asker: it.fields["提问人"] || "匿名学生"
      }));

    return res.json({ success: true, data: questions });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
