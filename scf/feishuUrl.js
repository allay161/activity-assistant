// 拼飞书「单条记录」深链，供老师端【在飞书打开】直接跳转到该条记录编辑。
//
// 重要前提：活动表与未解答问题表是「同一个多维表格（同一个 base / app_token）」下的两个数据表，
// 只是 table_id 不同。因此共用一个 FEISHU_SHEET_URL（老师从浏览器地址栏复制的该 base 链接），
// 跳转时用各自的 table_id 覆盖 table 参数、用记录 ID 覆盖 record 参数即可精确落到那一条。
//
// @param {string} recordId 记录 ID（rec...）
// @param {string} tableId  数据表 ID（tbl...）：活动表传 FEISHU_TABLE_A，问题表传 FEISHU_TABLE_Q
// @returns {string} 深链；未配置或参数缺失时返回空串（前端会给出配置提示）
function buildRecordUrl(recordId, tableId) {
  const raw = process.env.FEISHU_SHEET_URL;
  if (!raw || !recordId || !tableId) return '';
  try {
    const u = new URL(raw);
    u.searchParams.set('table', tableId);
    u.searchParams.set('record', recordId);
    return u.toString();
  } catch (e) {
    return '';
  }
}

module.exports = { buildRecordUrl };
