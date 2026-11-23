const express = require('express');
const router = express.Router();
const { getTenantToken } = require('../feishu');

// 语义去重用的轻量模型：turbo 足够且便宜；如需更严格可用环境变量覆盖为 qwen-plus
const DEDUP_MODEL = process.env.BAILIAN_DEDUP_MODEL || 'qwen-turbo';
// 最多拿最近多少条未解决问题参与比对（控制 prompt 长度与成本）
const MAX_CANDIDATES = 50;

// 飞书字段可能是字符串，也可能是富文本段落数组，统一拉平为纯文本
function flat(v) {
  if (Array.isArray(v)) return v.map(s => (s && s.text) || '').join('');
  return typeof v === 'string' ? v : '';
}

/**
 * 语义去重：判断 question 是否与 candidates 中某条问题"意思相同"。
 * 复用百炼的 OpenAI 兼容端点，与 /api/chat 共用 BAILIAN_API_KEY，无需新增环境变量。
 * 返回 { duplicate:boolean, matched:string, index:number }
 */
async function semanticallyDuplicate(question, candidates) {
  if (!candidates.length || !process.env.BAILIAN_API_KEY) {
    return { duplicate: false, matched: '', index: 0 };
  }

  const list = candidates.map((c, i) => `${i + 1}. ${c.text}`).join('\n');
  const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.BAILIAN_API_KEY
    },
    body: JSON.stringify({
      model: DEDUP_MODEL,
      messages: [
        {
          role: 'system',
          content: '你是问题去重助手。判断"新问题"是否与候选列表中的某条问题语义等价（表达的意思相同；即使措辞、语气、标点不同也算，例如"强制参加吗"与"必须参加吗"算等价；仅主题相关但问的不是同一件事则不算）。只输出最匹配问题的序号数字；若没有语义等价的，只输出 0。不要输出任何解释、标点或其它文字。'
        },
        { role: 'user', content: `候选问题：\n${list}\n\n新问题：${question}` }
      ],
      result_format: 'message'
    })
  });

  const data = await resp.json();
  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  const m = content.match(/\d+/);
  const idx = m ? parseInt(m[0], 10) : 0;
  if (idx >= 1 && idx <= candidates.length) {
    return { duplicate: true, matched: candidates[idx - 1].text, index: idx };
  }
  return { duplicate: false, matched: '', index: 0 };
}

router.post('/add-unanswered', async (req, res) => {
  const { question } = req.body;
  if (!question || !String(question).trim()) {
    return res.status(400).json({ success: false, error: 'question 必填' });
  }
  const q = String(question).trim();

  let token;
  try {
    token = await getTenantToken();
  } catch (e) {
    return res.status(500).json({ success: false, error: '飞书鉴权失败: ' + e.message });
  }

  // ========== 语义去重（异常时 fail-open：照常写入，绝不因去重服务故障丢问题） ==========
  let dedup = { duplicate: false, matched: '', index: 0 };
  try {
    const listRes = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_Q}/records?page_size=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const listData = await listRes.json();
    const items = (listData.data && listData.data.items) || [];
    // 只跟"未解决"的问题比对：已解决的答案本应已被 AI 引用，一般不会再触发记录
    const candidates = items
      .filter(it => (it.fields && it.fields['状态']) === '未解决')
      .map(it => ({ record_id: it.record_id, text: flat(it.fields['提问内容']) }))
      .filter(c => c.text)
      .slice(-MAX_CANDIDATES);
    dedup = await semanticallyDuplicate(q, candidates);
  } catch (e) {
    console.warn('[add-unanswered] 语义去重失败，按新问题写入:', e.message);
  }

  if (dedup.duplicate) {
    // 语义重复：不新增记录，避免老师端堆积同一问题的不同说法
    return res.json({
      success: true,
      duplicate: true,
      matched: dedup.matched,
      message: '该问题与已有未解决问题语义相同，已跳过重复记录'
    });
  }

  // ========== 正常写入 ==========
  try {
    const feishuRes = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_Q}/records`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            '提问内容': q,
            // "提问人": 留空，老师端不展示"匿名学生"
            '状态': '未解决'
          }
        })
      }
    );
    const data = await feishuRes.json();
    return res.json({ success: data.code === 0, duplicate: false, data });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
