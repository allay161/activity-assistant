const express = require('express');
const router = express.Router();
const { getTenantToken } = require('../feishu');

// 段落数组 / 字符串 双兼容，统一拉平为纯文本
function flat(v) {
  if (Array.isArray(v)) return v.map(s => (s && s.text) || '').join('');
  return v || '';
}

// 时间戳 → 北京时间显示（服务器可能是 UTC，必须显式指定时区）
function fmtTs(ts) {
  const n = Number(ts);
  if (!n) return '';
  return new Date(n).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

async function fetchAllRecords(tableId, token) {
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${tableId}/records?page_size=100`;
  const r = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  const d = await r.json();
  return (d.data && d.data.items) || [];
}

// 拼上下文：已解决问答（最近 20 条）+ 未解决问题池（最近 30 条）+ 已发布活动（全部）
async function buildContext() {
  try {
    const token = await getTenantToken();
    const qaRecords = await fetchAllRecords(process.env.FEISHU_TABLE_Q, token);
    const qa = qaRecords
      .filter(it => (it.fields && it.fields["状态"]) === "已解决")
      .slice(-20)
      .map(it => `问：${flat(it.fields["提问内容"])}\n老师回复：${flat(it.fields["老师回复"])}`)
      .filter(s => s.includes('老师回复：'));

    // 已有同学提交、老师尚未回复的问题：用于让 AI 从源头识别重复提问
    const pending = qaRecords
      .filter(it => (it.fields && it.fields["状态"]) === "未解决")
      .slice(-30)
      .map(it => flat(it.fields["提问内容"]))
      .filter(Boolean);

    let actLines = [];
    try {
      const actRecords = await fetchAllRecords(process.env.FEISHU_TABLE_A, token);
      // 只把已发布活动放进 AI 上下文：待审核/已忽略/已结束都不能推荐给学生
      actLines = actRecords
        .filter(it => flat(it.fields && it.fields['状态']) === '已发布')
        .map(it => {
          const f = it.fields || {};
          return `· ${flat(f["活动名称"])}｜时间：${fmtTs(f["开始时间"])}｜地点：${flat(f["地点"])}｜报名方式：${flat(f["报名方式"])}${flat(f["参与须知"]) ? '｜须知：' + flat(f["参与须知"]) : ''}`;
        }).filter(s => !s.startsWith('· ｜'));
    } catch (e) { /* 活动表拉不到不影响问答上下文 */ }

    const parts = [];
    if (actLines.length) parts.push('【当前已发布的活动列表】\n' + actLines.join('\n'));
    if (qa.length) parts.push('【老师已回复过的问题】\n' + qa.join('\n---\n'));
    if (pending.length) parts.push('【已有同学提交、老师尚未回复的问题】\n' + pending.map(q => '· ' + q).join('\n'));
    return parts.length ? parts.join('\n\n') : '';
  } catch (e) {
    return ''; // 任何异常都不阻塞对话
  }
}

router.post('/chat', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'prompt 必填' });
    }

    const context = await buildContext();
    const fullPrompt = context
      ? `你是学院文体活动助手。请依据以下来自后台数据库的最新信息回答学生问题，按以下优先级处理：
1. 如果学生的问题与【老师已回复过的问题】中某条相同或高度相关，直接用对应的"老师回复"作答。
2. 如果学生的问题与【已有同学提交、老师尚未回复的问题】中某条相同或语义相近（措辞不同也算，例如"强制参加"与"必须参加"），直接回复"这个问题已经有同学提问啦，老师会统一回复，请留意后续通知"。注意：这种情况务必用这句话术，不要使用"已记录"或"稍后回复"这两个词。
3. 只有上面两类都对不上、数据库里确实没有相关信息时，才回复"已记录你的需求，老师稍后回复"。

${context}

学生当前提问：${prompt}`
      : prompt;

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
        input: { prompt: fullPrompt },
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
