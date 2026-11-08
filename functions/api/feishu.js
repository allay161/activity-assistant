// functions/api/feishu.js
// Cloudflare Pages 中环境变量通过 context.env 传入，不能用 process.env，
// 因此这里把 env 作为参数传入，由调用方（handler）把 context.env 传进来。
export async function getTenantToken(env) {
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET
    })
  });
  const data = await res.json();
  return data.tenant_access_token;
}
