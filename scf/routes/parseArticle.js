// scf/routes/parseArticle.js  ->  POST /api/parse-article
// 微信公众号文章链接解析：老师端「录入活动」页粘贴推文链接，
// 自动解析出标题 / 账号 / 发布时间 / 正文文字摘要，预填录入表单。
// 说明：公众号没有公开的文章列表接口，无法自动枚举新推文，所以采用"贴链接半自动"方案；
//       正文若以海报图为主，解析出的文字有限，时间地点需老师补齐。

const express = require('express');
const router = express.Router();

const WX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function clean(s) {
  return stripTags(s).replace(/\s+/g, ' ').trim();
}

router.post('/parse-article', async (req, res) => {
  try {
    const url = String((req.body && req.body.url) || '').trim();
    if (!/^https?:\/\/mp\.weixin\.qq\.com\/s/i.test(url)) {
      return res.status(400).json({ success: false, error: '请粘贴微信文章链接（mp.weixin.qq.com/s/…）' });
    }

    const pageRes = await fetch(url, {
      headers: { 'User-Agent': WX_UA },
      signal: AbortSignal.timeout(15000)
    });
    if (!pageRes.ok) {
      return res.json({ success: false, error: `文章抓取失败（HTTP ${pageRes.status}），可手动填写` });
    }
    const html = await pageRes.text();

    // 标题：优先 h1 标签，其次 og:title
    let title = '';
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) title = clean(h1[1]);
    if (!title) {
      const og = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                 html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
      if (og) title = og[1].trim();
    }

    // 账号名：js_name 或 msg_link 附近的 nickname
    let account = '';
    const nick = html.match(/id=["']js_name["'][^>]*>([\s\S]*?)</i) ||
                 html.match(/var\s+nickname\s*=\s*["']([^"']+)["']/i);
    if (nick) account = clean(nick[1]);

    // 发布时间：优先页面脚本里的 create_time: '2026-11-27 22:48'（文本日期），
    // 其次时间戳形式 create_time: '1795790882' * 1，最后发布节点文本
    let publishTime = '';
    const ctText = html.match(/create_time:\s*'(\d{4}-\d{2}-\d{2}[^']*)'/) ||
                   html.match(/id=["']publish_time["'][^>]*>([\s\S]*?)</i) ||
                   html.match(/var\s+createTime\s*=\s*["']([^"']+)["']/i);
    const ctTs = html.match(/create_time:\s*'(\d{10})'\s*\*\s*1/);
    const tsMatch = html.match(/"send_time"\s*:\s*(\d{10})/);
    if (ctText) {
      publishTime = clean(ctText[1]);
    } else if (ctTs || tsMatch) {
      const sec = Number((ctTs || tsMatch)[1]) * 1000;
      publishTime = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).format(new Date(sec));
    }

    // 正文文字摘要：从 id="js_content" 的正文容器取纯文本（海报图为主的推文文字很少）
    let contentPreview = '';
    const cStart = html.indexOf('id="js_content"');
    if (cStart !== -1) {
      const tagEnd = html.indexOf('>', cStart);          // 跳过 <div id="js_content" ...> 标签本身
      const scriptIdx = html.indexOf('<script', tagEnd);
      const seg = html.slice(tagEnd + 1, scriptIdx === -1 ? tagEnd + 60000 : scriptIdx);
      contentPreview = clean(seg).slice(0, 300);
    }

    if (!title && !contentPreview) {
      return res.json({ success: false, error: '未能解析出内容（文章可能已删除或需要登录态）' });
    }

    return res.json({
      success: true,
      data: {
        title: title || '（未解析到标题）',
        account,
        publish_time: publishTime,
        content_preview: contentPreview,
        url
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
