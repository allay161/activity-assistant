// scf/crawlConfig.js
// 活动自动采集的信息源配置。
// 每个源：listUrl = 列表页地址（武大院系站通用"博达"系统，<li><span>日期</span><a title> 结构）；
//         label  = 写入活动表「来源」字段的来源名称。
// 新增信息源：往 SOURCES 里加一条即可，页面结构一致时无需改抓取代码。
// 也可通过环境变量 CRAWL_SOURCES 覆盖（JSON 数组字符串，格式同下）。

const DEFAULT_SOURCES = [
  {
    label: '学院官网-学术信息',
    listUrl: 'https://philosophy.whu.edu.cn/xsyj/xsxx.htm'
  },
  {
    label: '学院官网-通知公告',
    listUrl: 'https://philosophy.whu.edu.cn/xwzx/tzgg.htm'
  },
  {
    label: '学院官网-通知公告公示',
    listUrl: 'https://philosophy.whu.edu.cn/xxgk/tzgggs.htm'
  }
];

function getSources() {
  if (process.env.CRAWL_SOURCES) {
    try {
      const arr = JSON.parse(process.env.CRAWL_SOURCES);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {
      console.error('CRAWL_SOURCES 环境变量不是合法 JSON，回退默认配置：', e.message);
    }
  }
  return DEFAULT_SOURCES;
}

module.exports = { getSources, DEFAULT_SOURCES };
