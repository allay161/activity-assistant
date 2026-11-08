// functions/api/get-questions.js  (路由: GET /api/get-questions)
// 从飞书多维表格「问题表」查询状态为「未解决」的问题列表，供老师端后台展示。
import { getTenantToken } from './feishu.js';

export const onRequestGet = async (context) => {
  const { env } = context;
  try {
    const token = await getTenantToken(env);

    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_Q}/records?page_size=100`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();

    const items = (data.data && data.data.items) || [];
    const questions = items
      .filter(it => (it.fields && it.fields["状态"]) === "未解决")
      .map(it => ({
        record_id: it.record_id,
        question: it.fields["提问内容"] || "",
        asker: it.fields["提问人"] || "匿名学生"
      }));

    return new Response(JSON.stringify({ success: true, data: questions }), {
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
