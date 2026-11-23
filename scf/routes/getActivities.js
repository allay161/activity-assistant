// scf/routes/getActivities.js  ->  GET /api/get-activities
// 从飞书「活动表」拉取全部活动，清洗成前端易用的结构。
// 前端时间轴页/往期回顾页共用此接口：时间轴只看「已发布」，往期回顾只看「已结束」。
const express = require('express');
const router = express.Router();
const { getTenantToken } = require('../feishu');
const { buildRecordUrl } = require('../feishuUrl');

// 时间戳 -> 北京时间展示（服务器可能是 UTC，必须显式指定时区）
function fmtTs(ts) {
  const n = Number(ts);
  if (!n) return { date: '', time: '' };
  const d = new Date(n);
  return {
    date: d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }),
    time: d.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
  };
}

// 段落数组 / 字符串 双兼容（飞书文本字段可能是富文本数组）
function flat(v) {
  if (Array.isArray(v)) return v.map(s => (s && s.text) || '').join('');
  return v || '';
}

router.get('/get-activities', async (req, res) => {
  try {
    const token = await getTenantToken();

    // page_size=100，单页；活动量通常不大。需要更多可在此加分页。
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_A}/records?page_size=100`;
    const feishuRes = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await feishuRes.json();

    const items = (data.data && data.data.items) || [];
    const activities = items.map(it => {
      const f = it.fields || {};
      const startTs = Number(f["开始时间"]) || 0;
      const disp = fmtTs(startTs);
      return {
        record_id: it.record_id,
        feishu_url: buildRecordUrl(it.record_id, process.env.FEISHU_TABLE_A), // 【在飞书打开】→ 活动表对应记录
        name: flat(f["活动名称"]),
        start_ts: startTs,
        date_display: disp.date,   // 如 "12/03"
        time_display: disp.time,   // 如 "14:00"
        place: flat(f["地点"]),
        signup: flat(f["报名方式"]),
        notice: flat(f["参与须知"]),
        link: flat(f["链接"]),
        status: flat(f["状态"]),   // "已发布" / "已结束"
        category: flat(f["分类"])  // 可选列；为空时前端按名称关键词推断图标
      };
    });

    return res.json({ success: true, data: activities });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
