// functions/api/reply-question.js  (路由: POST /api/reply-question)
// 老师端回复某个问题：把该记录的「状态」更新为「已解决」，并保存「老师回复」。
import { getTenantToken } from './feishu.js';

export const onRequestPost = async (context) => {
  const { request, env } = context;
  try {
    const { record_id, reply } = await request.json();
    if (!record_id || !reply) {
      return new Response(JSON.stringify({ success: false, error: 'record_id 和回复内容必填' }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const token = await getTenantToken(env);

    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_Q}/records/${record_id}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          "状态": "已解决",
          "老师回复": reply
        }
      })
    });

    const data = await res.json();
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
