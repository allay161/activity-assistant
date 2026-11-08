// scf/feishu.js
// 获取飞书 tenant_access_token。腾讯云 SCF 通过 process.env 注入环境变量（与本地 Node 一致）。
async function getTenantToken() {
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET
    })
  });
  const data = await res.json();
  return data.tenant_access_token;
}

module.exports = { getTenantToken };
