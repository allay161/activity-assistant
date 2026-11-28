const express = require('express');
const router = express.Router();
const { getTenantToken } = require('../feishu');

router.post('/add-activity', async (req, res) => {
  try {
    const { name, time, time_ts, place, signup, notice, link, category } = req.body;
    if (!name || (!time && !time_ts)) {
      return res.status(400).json({ success: false, error: '活动名称和时间必填' });
    }

    // 飞书 Date 字段只收毫秒时间戳：优先 time_ts，缺失时才用 time 兜底（不推荐路径）
    let startTs = Number(time_ts);
    if (!startTs && time) {
      // 兜底：按北京时间 +08:00 显式解析，避免服务器时区影响
      startTs = new Date(time.length === 16 ? time + ':00+08:00' : time.replace('T', ' ') + ' GMT+0800').getTime();
    }
    if (!startTs) {
      return res.status(400).json({ success: false, error: '时间格式无法解析' });
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
          "开始时间": startTs,          // ← 原来是字符串 time，改为毫秒时间戳（唯一实质改动）
          "地点": place || "",
          "报名方式": signup || "",
          "参与须知": notice || "",
          "链接": link || "",
          "状态": "已发布",
          ...(String(category || '').trim() ? { "分类": String(category).trim() } : {})
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
