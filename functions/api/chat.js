// functions/api/chat.js  (路由: POST /api/chat)
// 安全代理百炼 / 通义 DashScope 的请求：前端不再持有任何密钥，
// 由本函数从 context.env 读取 BAILIAN_API_KEY 与 BAILIAN_APP_ID 再转发到 DashScope。
export const onRequestPost = async (context) => {
  const { request, env } = context;
  try {
    const { prompt } = await request.json();
    if (!prompt) {
      return new Response(JSON.stringify({ success: false, error: 'prompt 必填' }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const appId = env.BAILIAN_APP_ID;
    const apiKey = env.BAILIAN_API_KEY;
    const url = `https://dashscope.aliyuncs.com/api/v1/apps/${appId}/completion`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({
        input: { prompt: prompt },
        parameters: {}
      })
    });

    const data = await upstream.json();
    const text = data?.output?.text
      || data?.output?.choices?.[0]?.message?.content
      || JSON.stringify(data);

    return new Response(JSON.stringify({ success: true, text }), {
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
