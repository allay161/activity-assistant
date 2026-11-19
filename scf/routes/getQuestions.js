// scf/routes/getQuestions.js  ->  GET /api/get-questions
// 返回两部分：未解决的问题（待老师回复）+ 近期已解决的问题（带回复，方便老师修改回答）。
const express = require('express');
const router = express.Router();
const { getTenantToken } = require('../feishu');
const { buildRecordUrl } = require('../feishuUrl');

// 近期已回复问题保留条数
const RESOLVED_LIMIT = 8;

// 飞书文本字段可能是富文本数组，统一拉平为纯文本
function flat(v) {
  if (Array.isArray(v)) return v.map(s => (s && s.text) || '').join('');
  return v || '';
}

router.get('/get-questions', async (req, res) => {
  try {
    const token = await getTenantToken();

    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_Q}/records?page_size=100`;
    const feishuRes = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await feishuRes.json();

    const items = (data.data && data.data.items) || [];

    // 待回复：状态为「未解决」
    const unanswered = items
      .filter(it => (it.fields && it.fields["状态"]) === "未解决")
      .map(it => ({
        record_id: it.record_id,
        feishu_url: buildRecordUrl(it.record_id, process.env.FEISHU_TABLE_Q), // 【在飞书打开】→ 问题表对应记录
        question: flat(it.fields["提问内容"]),
        asker: flat(it.fields["提问人"]),
        status: "未解决"
      }));

    // 近期已回复：状态为「已解决」，取最近若干条并让最新在前，带上老师回复供修改
    const resolved = items
      .filter(it => (it.fields && it.fields["状态"]) === "已解决")
      .slice(-RESOLVED_LIMIT)
      .reverse()
      .map(it => ({
        record_id: it.record_id,
        feishu_url: buildRecordUrl(it.record_id, process.env.FEISHU_TABLE_Q), // 【在飞书打开】→ 问题表对应记录
        question: flat(it.fields["提问内容"]),
        asker: flat(it.fields["提问人"]),
        reply: flat(it.fields["老师回复"]),
        status: "已解决"
      }));

    // data 字段保持为未解决数组，兼容旧版前端；resolved 为新增
    return res.json({ success: true, data: unanswered, resolved, unanswered });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
