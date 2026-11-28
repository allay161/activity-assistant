// scf/routes/crawl.js  ->  POST /api/crawl/run
// 活动自动采集主流程（老师端手动触发 / 云函数定时触发器定时触发）：
//   1. 抓取配置好的信息源列表页（scf/crawlConfig.js）
//   2. 解析列表项（标题 / 发布日期 / 链接），按"来源链接+标题"去重
//   3. 抓详情页正文：有文字则正则抽取 开始时间/地点/报名方式，是海报图则留空待审核补齐
//   4. 按标题关键词预打「分类」，标注来源与抓取时间
//   5. 以 状态=待审核 写入飞书活动表 —— 学生端只显示"已发布"，天然隔离未审核数据
// 人工审核在老师端「采集审核」板块完成（通过→已发布 / 忽略→已忽略）。

const express = require('express');
const router = express.Router();
const { getTenantToken } = require('../feishu');
const { getSources } = require('../crawlConfig');

const SITE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// ---------- 小工具 ----------
function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function beijingNow() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date()).replace(/\//g, '-');
}

/** 分类关键词打标（与前端 app.js 的 CATEGORIES 保持一致）。返回命中的分类 key，未命中返回空串。 */
function guessCategoryKey(text) {
  const t = text || '';
  if (/讲座|论坛|学术沙龙|学术报告|学术信息|研讨|公开课/.test(t)) return '讲座';
  if (/读书|阅读|书会|书评|荐书/.test(t)) return '读书';
  if (/志愿|公益|义工|献爱心|志愿服务|社会实践/.test(t)) return '志愿服务';
  if (/竞赛|大赛|挑战杯|创新创业|征文比赛|招募比赛/.test(t)) return '竞赛活动';
  if (/运动会|球赛|篮球|足球|羽毛球|跑步|体育|文艺|晚会|歌唱|舞蹈|比赛/.test(t)) return '文体';
  return '';
}

/**
 * 从正文文本行中解析活动开始时间。
 * 策略：找同时含"完整日期(2026年/2026-11-29)"和"时刻(14:30 / 下午2点)"的行 → 生成毫秒时间戳；
 *       只有日期没有明确时刻则返回 null（宁缺勿错，时间留给老师审核时补齐）。
 */
function extractStartTs(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const tz = '+08:00';
  for (const line of lines) {
    const dm = line.match(/(\d{4})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})/);
    if (!dm) continue;
    const tm = line.match(/(\d{1,2})[:：](\d{2})/) ||
               line.match(/(?:上午|下午|晚上)?\s*(\d{1,2})\s*[点时]\s*(\d{1,2})?分?/);
    if (!tm) continue;
    let hour = Number(tm[1]);
    const minute = Number(tm[2] || 0);
    if (/下午|晚上/.test(line) && hour < 12) hour += 12;
    if (hour > 23 || minute > 59) continue;
    const ts = new Date(`${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${tz}`).getTime();
    if (Number.isFinite(ts) && ts > 0) return ts;
  }
  return null;
}

/** 从正文抽取地点：匹配 "地点：xxx" / "地点在xxx"。 */
function extractPlace(text) {
  const m = String(text || '').match(/地点(?:在)?[:：]\s*([^\s，。；,;、]{2,40})/);
  return m ? m[1] : '';
}

/** 从正文抽取报名方式。 */
function extractSignup(text) {
  const m = String(text || '').match(/报名(?:方式)?[:：]\s*([^\s，。；,;、]{2,40})/);
  return m ? m[1] : '';
}

/** 解析博达系统列表页：返回 [{ publishDate, url, title }]。 */
function parseListPage(html, pageUrl) {
  const items = [];
  const re = /<li>\s*<span[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/span>\s*<a\s+([^>]*)>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[2];
    const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const titleAttr = attrs.match(/title\s*=\s*["']([^"']*)["']/i);
    const title = (titleAttr && titleAttr[1]) || stripTags(m[3]).trim();
    if (!title) continue;
    let url;
    try { url = new URL(hrefMatch[1], pageUrl).toString(); } catch (e) { continue; }
    items.push({ publishDate: m[1], url, title });
  }
  return items;
}

/** 抓详情页正文文本（博达系统正文容器 v_news_content / vsb_content）。 */
async function fetchDetailText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': SITE_UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return '';
  const html = await res.text();
  const start = html.indexOf('v_news_content');
  if (start === -1) return '';
  const attachIdx = html.indexOf('<div class="attach"', start);
  const seg = html.slice(start, attachIdx === -1 ? start + 20000 : attachIdx);
  const text = stripTags(seg)
    .split('\n').map(l => l.trim()).filter(l => l && l !== '&nbsp;')
    .join('\n');
  // 正文主体是一张海报图（无有效文字）时返回空串
  return text.length > 30 ? text : '';
}

/** 拉取活动表现有记录，构建去重集合（来源链接 + 活动名称）。 */
async function fetchExistingKeys(token) {
  const keys = new Set();
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_A}/records?page_size=100${pageToken ? '&page_token=' + pageToken : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    const items = (data.data && data.data.items) || [];
    items.forEach(it => {
      const f = it.fields || {};
      const src = typeof f['来源链接'] === 'string' ? f['来源链接']
        : Array.isArray(f['来源链接']) ? f['来源链接'].map(s => (s && s.text) || '').join('') : '';
      const name = typeof f['活动名称'] === 'string' ? f['活动名称']
        : Array.isArray(f['活动名称']) ? f['活动名称'].map(s => (s && s.text) || '').join('') : '';
      if (src) keys.add('u:' + src);
      if (name) keys.add('n:' + name.trim());
    });
    if (!(data.data && data.data.has_more && data.data.page_token)) break;
    pageToken = data.data.page_token;
  }
  return keys;
}

/** 向活动表写入一条"待审核"候选记录。 */
async function insertCandidate(token, fields) {
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_A}/records`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('写入候选失败：' + (data.msg || JSON.stringify(data)));
  return data;
}

// ---------- 主流程 ----------
async function runCrawl() {
  const sources = getSources();
  const added = [];
  const skipped = [];
  const errors = [];

  const token = await getTenantToken();
  const existing = await fetchExistingKeys(token);
  const crawlTime = beijingNow();

  for (const source of sources) {
    try {
      const res = await fetch(source.listUrl, { headers: { 'User-Agent': SITE_UA }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) { errors.push(`${source.label}：列表页 HTTP ${res.status}`); continue; }
      const html = await res.text();
      const items = parseListPage(html, source.listUrl);

      for (const item of items) {
        const dedupeUrl = 'u:' + item.url;
        const dedupeName = 'n:' + item.title.trim();
        if (existing.has(dedupeUrl) || existing.has(dedupeName)) {
          skipped.push(item.title);
          continue;
        }

        // 抓详情页，抽取字段（失败不阻断，字段留空待审核）
        let bodyText = '';
        try { bodyText = await fetchDetailText(item.url); } catch (e) { /* 留空 */ }

        const startTs = extractStartTs(bodyText);
        const place = extractPlace(bodyText);
        const signup = extractSignup(bodyText);
        const category = guessCategoryKey(item.title + '\n' + bodyText.slice(0, 300));
        const notice = bodyText ? bodyText.replace(/\s+/g, ' ').slice(0, 200) : '';

        const fields = {
          '活动名称': item.title,
          '状态': '待审核',
          '链接': item.url,
          '来源': source.label,
          '来源链接': item.url,
          '抓取时间': crawlTime
        };
        if (startTs) fields['开始时间'] = startTs;
        if (place) fields['地点'] = place;
        if (signup) fields['报名方式'] = signup;
        if (category) fields['分类'] = category;
        if (notice) fields['参与须知'] = notice + (bodyText.length > 200 ? '…' : '');

        await insertCandidate(token, fields);
        existing.add(dedupeUrl);
        existing.add(dedupeName);
        added.push({ title: item.title, source: source.label, has_time: !!startTs });
      }
    } catch (e) {
      errors.push(`${source.label}：${e.message}`);
    }
  }

  return { addedCount: added.length, skippedCount: skipped.length, added, errors };
}

// ---------- 路由 ----------
router.post('/crawl/run', async (req, res) => {
  // 两种合法触发方式：
  // 1) 外部定时触发器：?token=<CRAWL_TOKEN> 或 X-Crawl-Token: <CRAWL_TOKEN>
  // 2) 老师端页面「立即抓取一次」：X-Teacher-Token（前端已校验口令，这里再核对一次）
  // CRAWL_TOKEN 是服务端密钥，不下发到浏览器；老师端按钮不需要知道它。
  const crawlExpect = String(process.env.CRAWL_TOKEN || '');
  const crawlGiven = String(req.query.token || req.headers['x-crawl-token'] || '');
  const teacherExpect = String(process.env.TEACHER_PASSCODE || 'whu2026');
  const teacherGiven = String(req.headers['x-teacher-token'] || '');
  const crawlOk = !!crawlExpect && crawlGiven === crawlExpect;
  const teacherOk = !!teacherGiven && teacherGiven === teacherExpect;
  if (!crawlOk && !teacherOk) {
    return res.status(403).json({ success: false, error: '抓取令牌或教师口令不匹配' });
  }
  try {
    const result = await runCrawl();
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
