// scf/routes/addActivity.js  ->  POST /api/add-activity
const express = require('express');
const router = express.Router();
const { getTenantToken } = require('../feishu');

router.post('/add-activity', async (req, res) => {
  try {
    const { name, time, place, signup, notice, link } = req.body;
    if (!name || !time) {
      return res.status(400).json({ success: false, error: '活动名称和时间必填' });
    }

    const token = await getTenantToken();

    const feishuRes = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_A}/records`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          "活动名称": name,
          "开始时间": time,
          "地点": place || "",
          "报名方式": signup || "",
          "参与须知": notice || "",
          "链接": link || "",
          "状态": "已发布"
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
