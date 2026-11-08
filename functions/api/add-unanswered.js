// functions/api/add-unanswered.js  (路由: POST /api/add-unanswered)
// 已迁移到 Cloudflare Pages Functions 格式：
//   - 导出 onRequestPost 处理函数，只接收 POST
//   - 从 context.request 读取请求体，从 context.env 读取环境变量
//   - 返回 new Response(...)
import { getTenantToken } from './feishu.js';

export const onRequestPost = async (context) => {
  const { request, env } = context;
  try {
    const { question, asker } = await request.json();

    const token = await getTenantToken(env);

    const feishuRes = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_Q}/records`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          "提问内容": question,
          "提问人": asker || "匿名学生",
          "状态": "未解决"
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
