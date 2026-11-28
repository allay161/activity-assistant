// scf/routes/activityRecord.js
// 老师端活动管理页使用的两条接口：
//   GET  /api/get-one-activity?record_id=rec...  读取单条活动（编辑弹窗用）
//   POST /api/update-activity                    更新单条活动（行内编辑 / 编辑弹窗共用）
// 复用现有 getTenantToken()、FEISHU_APP_TOKEN、FEISHU_TABLE_A 与 buildRecordUrl()。

const express = require('express');
const router = express.Router();
const { getTenantToken } = require('../feishu');
const { buildRecordUrl } = require('../feishuUrl');

// 时间戳 -> 北京时间展示，与 get-activities 保持一致
function fmtTs(ts) {
  const n = Number(ts);
  if (!n) return { date: '', time: '' };
  const d = new Date(n);
  return {
    date: d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }),
    time: d.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
  };
}

// 飞书文本字段可能是字符串或富文本段落数组
function flat(v) {
  if (Array.isArray(v)) return v.map(s => (s && s.text) || '').join('');
  return v || '';
}

// 把飞书 fields 清洗成前端统一结构
function normalizeRecord(recordId, fields) {
  const f = fields || {};
  const startTs = Number(f['开始时间']) || 0;
  const disp = fmtTs(startTs);
  const status = flat(f['状态']) || '已发布';
  return {
    record_id: recordId,
    feishu_url: buildRecordUrl(recordId, process.env.FEISHU_TABLE_A),
    name: flat(f['活动名称']),
    start_ts: startTs,
    date_display: disp.date,
    time_display: disp.time,
    place: flat(f['地点']),
    signup: flat(f['报名方式']),
    notice: flat(f['参与须知']),
    link: flat(f['链接']),
    status,
    category: flat(f['分类']),
    raw_fields: f
  };
}

// GET /api/get-one-activity
router.get('/get-one-activity', async (req, res) => {
  try {
    const recordId = String(req.query.record_id || '').trim();
    if (!recordId) {
      return res.status(400).json({ success: false, error: 'record_id 必填' });
    }

    const token = await getTenantToken();
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_A}/records/${recordId}`;
    const feishuRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await feishuRes.json();
    if (data.code !== 0) {
      return res.json({ success: false, error: (data.msg || '读取飞书记录失败') });
    }

    return res.json({
      success: true,
      data: normalizeRecord(data.data && data.data.record_id ? data.data.record_id : recordId,
                            data.data && data.data.fields)
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/update-activity
router.post('/update-activity', async (req, res) => {
  try {
    const { record_id } = req.body || {};
    const recordId = String(record_id || '').trim();
    if (!recordId) {
      return res.status(400).json({ success: false, error: 'record_id 必填' });
    }

    const fields = {};
    if (req.body.name !== undefined) fields['活动名称'] = String(req.body.name).trim();
    if (req.body.category !== undefined) {
      const category = String(req.body.category || '').trim();
      if (category) fields['分类'] = category;
    }
    if (req.body.place !== undefined) fields['地点'] = String(req.body.place || '').trim();
    if (req.body.signup !== undefined) fields['报名方式'] = String(req.body.signup || '').trim();
    if (req.body.notice !== undefined) fields['参与须知'] = String(req.body.notice || '').trim();
    if (req.body.link !== undefined) fields['链接'] = String(req.body.link || '').trim();

    // 开始时间：优先使用前端按北京时间换算好的毫秒时间戳
    let startTs = Number(req.body.start_ts);
    if (!startTs && req.body.time) {
      const raw = String(req.body.time);
      startTs = new Date(raw.length === 16 ? raw + ':00+08:00' : raw.replace('T', ' ') + ' GMT+0800').getTime();
    }
    if (startTs) {
      if (!Number.isFinite(startTs) || startTs <= 0) {
        return res.status(400).json({ success: false, error: '开始时间无效' });
      }
      fields['开始时间'] = startTs;
    }

    if (req.body.status !== undefined) {
      const status = String(req.body.status).trim();
      // 待审核 = 采集候选；已忽略 = 审核不通过（对学生端均不可见）
      if (!['已发布', '已结束', '待审核', '已忽略'].includes(status)) {
        return res.status(400).json({ success: false, error: '状态只能是“已发布 / 已结束 / 待审核 / 已忽略”' });
      }
      fields['状态'] = status;
    }

    if (!Object.keys(fields).length) {
      return res.status(400).json({ success: false, error: '没有需要更新的字段' });
    }

    const token = await getTenantToken();
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_A}/records/${recordId}`;
    const feishuRes = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });
    const data = await feishuRes.json();
    return res.json({ success: data.code === 0, data });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
