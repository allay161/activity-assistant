// functions/api/add-activity.js  (路由: POST /api/add-activity)
// Cloudflare Pages Functions 格式：导出 onRequestPost，从 context.request / context.env 取数据，返回 new Response(...)。
//
// 说明：原 Vercel 版 api/add-activity.js 是空文件（无任何代码），
// 这里根据前端 submitActivity() 提交的数据结构（app.js:91）补充实现，
// 把活动写入飞书多维表格的「活动表」。
import { getTenantToken } from './feishu.js';

export const onRequestPost = async (context) => {
  const { request, env } = context;
  try {
    const payload = await request.json();
    const { name, time, place, signup, notice, link } = payload;

    if (!name || !time) {
      return new Response(JSON.stringify({ success: false, error: '活动名称和时间必填' }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const token = await getTenantToken(env);

    // FEISHU_APP_TOKEN 与 add-unanswered 共用同一个多维表格应用，
    // FEISHU_TABLE_A 是「活动表」的 table_id（在 Cloudflare 环境变量里配置）。
    const feishuRes = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_A}/records`, {
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
    return new Response(JSON.stringify({ success: data.code === 0, data }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
