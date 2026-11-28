/* 学院文体活动助手前端逻辑：注释整理版。
 * 配合 index.html 的元素 ID、事件入口及 style.css 状态类使用。
 * 保留原有可执行代码、配置值、接口地址和执行顺序。
 */
// ================== 配置区（注意：不要在这里写真实Key） ==================
// 后端接口基础地址；空值表示请求当前站点的 /api/... 相对路径。
// 完整功能需配套后端服务，本地双击 HTML 不会提供这些接口。
const BASE_URL = '';

// 学生端对话走哪条链路（迁移只需改这一个开关，callAgent 内部已两条分支写好）：
//   false = 直连阿里云百炼（需填下面的 API_KEY / APP_ID，Key 会暴露在前端）
//   true  = 走后端代理 {BASE_URL}/api/chat（Key 只放在服务端环境变量里）
// 当前选择后端代理分支，接口可用性以实际部署为准。
const USE_PROXY_CHAT = true;

const API_KEY = 'xxx';
const APP_ID  = 'xxx';
// ========================================================

const API_URL = 'https://dashscope.aliyuncs.com/api/v1/apps/' + APP_ID + '/completion';

// 老师端固定口令（结项验收阶段使用；二期接入学校统一身份认证后废弃）
const TEACHER_PASSCODE = 'whu2026';

// 任务1 的写入责任方开关（联调实测：智能体回复"已记录"但没写飞书问题表，
// 所以写库必须由前端负责，此开关保持 true）
const ENABLE_FRONTEND_UNANSWERED_RECORD = true;

// ---------- 通用 ----------
/**
 * 显示 #toast 轻提示，2 秒后隐藏。
 */
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2000);
}

// ========== 导航：角色切换（学生端 / 老师端） ==========
// 学生端展示三 Tab 主导航；老师端展示后台页面。
/**
 * 切换角色和导航显示；老师端先检查会话验证标记，每次进入时加载问题与活动。
 */
async function switchRole(name) {
  const nav = document.getElementById('mainNav');
  const mainPages = document.querySelectorAll('.main-page');
  const teacherPage = document.getElementById('page-teacher');

  // 防误操作：从老师端离开且活动有未保存修改时，先确认是否丢弃
  if (name === 'student' && teacherPage.classList.contains('active') &&
      hasAnyUnsavedActivityChanges()) {
    const ok = await askConfirm('活动列表中有未保存的修改，离开老师端会丢弃这些修改。确定继续吗？', '未保存的修改');
    if (!ok) return;
    resetActivityEditState();
  }

  // 老师端口令验证（sessionStorage 会话级记忆，验证通过后本次会话不再重复询问）
  // 采用自定义弹窗，以减少部分内置浏览器对原生 prompt() 的兼容问题。
  // 使用 index.html 的自定义 DOM 弹窗，减少对原生弹窗行为的依赖。
  if (name === 'teacher' && !sessionStorage.getItem('teacherVerified')) {
    openPasscodeModal();
    return; // 验证成功后由 confirmPasscode() 重新调用 switchRole('teacher') 进入
  }

  document.getElementById('tab-student').classList.toggle('active', name === 'student');
  document.getElementById('tab-teacher').classList.toggle('active', name === 'teacher');

  if (name === 'teacher') {
    nav.style.display = 'none';
    mainPages.forEach(p => p.classList.remove('active'));
    teacherPage.classList.add('active');
    loadQuestions();          // 首次进入老师端，自动加载未解答问题
    loadTeacherActivities();  // 同时加载活动列表（供在飞书打开编辑）
  } else {
    nav.style.display = 'flex';
    teacherPage.classList.remove('active');
    // 回到学生端时恢复当前主 Tab（默认 chat）；聊天 DOM 一直都在，记录不会丢
    switchMainTab(currentMainTab, false);
  }
}

// ---------- 教师验证弹窗（自定义 Modal，替代 prompt） ----------
/**
 * 清空输入并显示验证弹窗，延迟聚焦输入框。
 */
function openPasscodeModal() {
  const mask = document.getElementById('passcode-mask');
  const inp = document.getElementById('passcode-input');
  inp.value = '';
  mask.style.display = 'flex';
  // 延迟聚焦，部分安卓 WebView 需要等弹层完成渲染后 focus 才生效
  setTimeout(() => inp.focus(), 100);
}
/**
 * 隐藏验证弹窗，不改变当前角色。
 */
function closePasscodeModal() {
  document.getElementById('passcode-mask').style.display = 'none';
}
/**
 * 校验口令，通过后记录会话标记并重新调用老师端入口。
 */
function confirmPasscode() {
  const pwd = document.getElementById('passcode-input').value;
  if (pwd === TEACHER_PASSCODE) {
    sessionStorage.setItem('teacherVerified', 'true');
    closePasscodeModal();
    switchRole('teacher'); // 复用正常入口，首次进入会自动加载问题列表和活动列表
  } else {
    toast('验证码错误！'); // 用页面内 toast 代替 alert，同样避免被拦截
  }
}

// 点遮罩空白处（弹窗卡片以外）视为取消
document.getElementById('passcode-mask').addEventListener('click', function (e) {
  if (e.target === this) closePasscodeModal();
});

// ========== 导航：主 Tab 切换（智能问答 / 活动时间表 / 往期回顾） ==========
let currentMainTab = 'chat';

/**
 * 切换 chat、timeline 或 review 页面；refetch=false 时只切换界面，不重新请求活动。
 */
function switchMainTab(name, refetch = true) {
  currentMainTab = name;
  document.querySelectorAll('.main-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.main-nav button').forEach(b => b.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  const navBtn = document.getElementById('nav-' + name);
  if (page) page.classList.add('active');
  if (navBtn) navBtn.classList.add('active');

  // 需求：切换 Tab 时自动重新拉取一次最新活动数据
  if (refetch) {
    loadActivities().then(() => {
      if (name === 'timeline') renderTimeline();
      if (name === 'review') renderReview();
    });
  }
}

// 兼容旧调用（若别处仍调用 switchTab）
/**
 * 兼容旧入口：将 student 映射到 chat，teacher 转交角色切换函数。
 */
function switchTab(name) {
  if (name === 'teacher') switchRole('teacher');
  else switchMainTab(name === 'student' ? 'chat' : name);
}

// ========== 老师端子板块切换（录入活动 / 活动管理 / 问题回复） ==========
/**
 * 切换老师端子面板；进入活动管理或问题回复时刷新相应数据。
 */
async function switchTeacherTab(name) {
  // 防误操作：从活动管理切到其他板块时，若存在未保存的行内修改则先确认
  const currentPane = document.querySelector('.teacher-pane.active');
  if (currentPane && currentPane.id === 'tpane-manage' && name !== 'manage' &&
      hasAnyUnsavedActivityChanges()) {
    const ok = await askConfirm('活动列表中有未保存的修改，切换板块会丢弃这些修改。确定继续吗？', '未保存的修改');
    if (!ok) return; // 用户取消时保持当前板块不变
    resetActivityEditState();
  }

  document.querySelectorAll('.teacher-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.teacher-nav button').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('tpane-' + name);
  const btn = document.getElementById('tnav-' + name);
  if (pane) pane.classList.add('active');
  if (btn) btn.classList.add('active');
  // 进入板块时刷新对应数据
  if (name === 'manage') loadTeacherActivities();
  if (name === 'question') loadQuestions();
}

/**
 * 切换标签的 selected 类，与 CSS 配合呈现选中状态。
 */
function toggleChip(el) { el.classList.toggle('selected'); }
/**
 * 返回指定标签组中所有已选标签的文本数组。
 */
function getSelected(containerId) {
  return Array.from(document.querySelectorAll('#' + containerId + ' .chip.selected')).map(c => c.textContent);
}

// ---------- 学生端 ----------
const chat = document.getElementById('chat');
const input = document.getElementById('input');

/**
 * 追加消息并滚动到底部；正文通过 textContent 写入，避免将消息解析为 HTML。
 */
function addMsg(text, role) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = '<div class="bubble"></div>';
  div.querySelector('.bubble').textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// "思考中"气泡：三个跳动的圆点（动效由 CSS 完成），返回气泡元素供回复时替换文本
/**
 * 创建等待回复的气泡并返回其正文元素，供异步请求完成后替换内容。
 */
function addThinkingMsg() {
  const div = document.createElement('div');
  div.className = 'msg ai';
  div.innerHTML = '<div class="bubble thinking"><span class="think-dots"><i></i><i></i><i></i></span></div>';
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div.querySelector('.bubble');
}

// 老师端写接口统一带上当前会话口令，供后端做最基本的校验。
// 注意：这只是提高门槛，不是安全机制——真正的权限边界在后端。
/**
 * 构建老师端写接口请求头；前端口令可被查看，实际权限控制必须由后端承担。
 */
function teacherHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Teacher-Token': sessionStorage.getItem('teacherVerified') ? TEACHER_PASSCODE : ''
  };
}

/**
 * 按配置选择后端代理或百炼直连并返回回复文本；错误交给调用方处理。
 */
async function callAgent(prompt) {
  // 分支一：走后端代理（USE_PROXY_CHAT = true），Key 只存在服务端
  if (USE_PROXY_CHAT) {
    const res = await fetch(BASE_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt })
    });
    const data = await res.json();
    // 真实后端返回 {success, text}；同时兼容约定过的 {reply}
    if (data && data.success === false) throw new Error(data.error || '后端返回失败');
    const reply = data && (data.reply || data.text);
    if (!reply) throw new Error((data && data.error) || '后端未返回 reply/text');
    return reply;
  }

  // 分支二：直连百炼。Key 还是占位值时给出可读提示
  if (API_KEY === 'xxx' || APP_ID === 'xxx') {
    throw new Error('学生端对话未接通：API_KEY/APP_ID 仍是占位值；或把 USE_PROXY_CHAT 改为 true 走后端 /api/chat');
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY
    },
    body: JSON.stringify({
      input: { prompt: prompt },
      parameters: {}
    })
  });
  const data = await res.json();
  return data?.output?.text
      || data?.output?.choices?.[0]?.message?.content
      || JSON.stringify(data);
}

// AI 回复含"已记录/稍后回复"时，把学生原话写入飞书未解答问题表。
// 后端会做语义去重：若判定为重复，给出友好提示而不是重复提交。
// 注：改造后 AI 识别到重复时会用"已有同学提问"话术，不含这两个词，通常不会走到这里；
//    这里的 duplicate 提示是兜底（AI 漏判时由后端语义去重拦截）。
/**
 * 满足开关和回复关键词条件时请求后端记录问题。
 * 会话中保留最近三个问题以减少重复请求；存储和跨用户去重依赖后端。
 */
async function maybeRecordUnanswered(question, reply) {
  if (!ENABLE_FRONTEND_UNANSWERED_RECORD) return;
  if (!reply || (!reply.includes('已记录') && !reply.includes('稍后回复'))) return;

  // 会话内精确去重：只减少无谓请求，真正的跨用户去重在后端
  const RECENT_KEY = 'recentUnanswered';
  let recent = [];
  try { recent = JSON.parse(sessionStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { recent = []; }
  if (!Array.isArray(recent)) recent = [];
  if (recent.indexOf(question) !== -1) return;
  recent.push(question);
  sessionStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(-3)));

  try {
    const res = await fetch(BASE_URL + '/api/add-unanswered', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question })
    });
    const data = await res.json();
    if (data && data.duplicate) {
      toast('该问题已有同学提交，老师会统一回复');
    }
  } catch (e) { /* 落库失败不打断对话，静默处理 */ }
}

// 真正的发送逻辑。传入 text 则直接发送（快捷胶囊用）；不传则从输入框取。
/**
 * 统一处理输入框和快捷问题：显示用户消息、请求回复、更新等待气泡和触发问题记录。
 */
async function sendMessage(text) {
  if (typeof text !== 'string') text = input.value.trim();
  text = String(text).trim();
  if (!text) return;
  addMsg(text, 'user');
  input.value = '';
  const last = addThinkingMsg();
  try {
    const reply = await callAgent(text);
    last.textContent = reply;
    maybeRecordUnanswered(text, reply);
  } catch (e) {
    last.textContent = '请求失败：' + e.message;
  }
  chat.scrollTop = chat.scrollHeight;
}

// 输入框发送按钮 / 回车
/**
 * 输入框按钮及回车使用的发送入口。
 */
function send() { return sendMessage(); }

// 快捷问题胶囊：点击后作为一条消息直接发出
/**
 * 将预设问题交给统一消息发送函数。
 */
function quickAsk(text) { return sendMessage(text); }

/**
 * 读取时间与兴趣生成推荐请求；两组均为空时停止，只有一组为空时使用“不限”。
 */
async function submitPreference() {
  const times = getSelected('timeChips');
  const interests = getSelected('interestChips');
  if (!times.length && !interests.length) { toast('请至少选择一项时间和兴趣'); return; }
  const prompt = `我有空的时间是：${times.join('、') || '不限'}；我的兴趣是：${interests.join('、') || '不限'}。请帮我推荐合适的活动。`;
  addMsg(prompt, 'user');
  const last = addThinkingMsg();
  try {
    const reply = await callAgent(prompt);
    last.textContent = reply;
    maybeRecordUnanswered(prompt, reply);
  } catch (e) {
    last.textContent = '请求失败：' + e.message;
  }
  chat.scrollTop = chat.scrollHeight;
}

// ---------- 老师端 ----------
/**
 * 读取表单并提交活动；校验名称和时间，提交时禁用按钮，成功后清空表单及缓存。
 */
async function submitActivity() {
  const timeRaw = document.getElementById('act-time').value; // YYYY-MM-DDTHH:mm，不含时区
  const payload = {
    name: document.getElementById('act-name').value,
    time: timeRaw,
    // 毫秒时间戳：请后端优先使用 time_ts
    time_ts: timeRaw ? new Date(timeRaw).getTime() : '',
    place: document.getElementById('act-place').value,
    signup: document.getElementById('act-signup').value,
    notice: document.getElementById('act-notice').value,
    link: document.getElementById('act-link').value
  };
  if (!payload.name || !payload.time) { toast('请填写活动名称和时间'); return; }

  const btn = Array.from(document.querySelectorAll('#page-teacher button'))
    .find(b => b.textContent.includes('提交活动'));
  if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
  try {
    const res = await fetch(BASE_URL + '/api/add-activity', {
      method: 'POST',
      headers: teacherHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      toast('活动提交成功！');
      ['act-name','act-time','act-place','act-signup','act-notice','act-link'].forEach(id => document.getElementById(id).value = '');
      activitiesCache = null; // 活动数据变了，清缓存
    } else {
      const detail = (data.data && data.data.msg) || data.error || '请检查网络';
      toast('提交失败：' + detail);
    }
  } catch (e) {
    toast('提交失败：' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '提交活动'; }
  }
}

// 老师端活动管理状态：默认只读；开启后行内编辑；同时保留独立编辑弹窗入口
const activityEditState = {
  enabled: false,
  list: [],                 // 当前展示的活动（已按开始时间倒序）
  originals: {},            // record_id -> 原始字段快照，用于取消与脏检查
  modalRecordId: '',        // 编辑弹窗当前记录
  modalOriginal: null       // 编辑弹窗原始快照
};

const ACTIVITY_FIELDS = ['name', 'start_ts', 'place', 'signup', 'notice', 'link', 'status'];

/**
 * 把飞书毫秒时间戳转换成 datetime-local 需要的本地时间字符串（按北京时间显示）。
 */
function toDatetimeLocalValue(ts) {
  const n = Number(ts);
  if (!n) return '';
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(n));
    const get = type => (parts.find(p => p.type === type) || {}).value || '';
    let hour = get('hour');
    if (hour === '24') hour = '00';
    return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
  } catch (e) {
    return '';
  }
}

/**
 * datetime-local 字符串转毫秒时间戳；按北京时间 +08:00 解析，避免服务器时区影响。
 */
function datetimeLocalToTs(value) {
  if (!value) return NaN;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`).getTime();
}

/** HTML 属性转义，避免活动内容里的引号破坏结构。 */
function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 取活动字段快照；所有字段统一为标准字符串 / 时间戳。 */
function activitySnapshot(a) {
  return {
    name: a.name || '',
    start_ts: Number(a.start_ts) || 0,
    place: a.place || '',
    signup: a.signup || '',
    notice: a.notice || '',
    link: a.link || '',
    status: a.status || '已发布'
  };
}

/** 比较两个活动字段对象是否不同。 */
function activityFieldsDiffer(a, b) {
  return ACTIVITY_FIELDS.some(k => String(a[k] || '') !== String(b[k] || ''));
}

/** 读取某一行的行内表单值。 */
function collectInlineFields(recordId) {
  const get = field => document.getElementById(`inline-${field}-${recordId}`);
  return {
    name: (get('name')?.value || '').trim(),
    start_ts: datetimeLocalToTs(get('time')?.value || ''),
    place: (get('place')?.value || '').trim(),
    signup: (get('signup')?.value || '').trim(),
    notice: (get('notice')?.value || '').trim(),
    link: (get('link')?.value || '').trim(),
    status: get('status')?.value || '已发布'
  };
}

/** 读取编辑弹窗中的表单值。 */
function collectModalFields() {
  const get = id => document.getElementById(id);
  return {
    name: (get('modal-act-name')?.value || '').trim(),
    start_ts: datetimeLocalToTs(get('modal-act-time')?.value || ''),
    place: (get('modal-act-place')?.value || '').trim(),
    signup: (get('modal-act-signup')?.value || '').trim(),
    notice: (get('modal-act-notice')?.value || '').trim(),
    link: (get('modal-act-link')?.value || '').trim(),
    status: get('modal-act-status')?.value || '已发布'
  };
}

/** 校验活动时间与名称。 */
function validateActivityPayload(payload) {
  if (!payload.name) { toast('请填写活动名称'); return false; }
  if (!Number.isFinite(payload.start_ts) || payload.start_ts <= 0) {
    toast('请填写有效的开始时间');
    return false;
  }
  if (!['已发布', '已结束'].includes(payload.status)) {
    toast('状态只能选择“已发布”或“已结束”');
    return false;
  }
  return true;
}

/** 某行是否与原始快照不同。 */
function isActivityRowDirty(recordId) {
  const original = activityEditState.originals[recordId];
  if (!original) return false;
  const exists = document.getElementById(`inline-name-${recordId}`);
  if (!exists) return false;
  return activityFieldsDiffer(original, collectInlineFields(recordId));
}

/** 是否存在未保存的行内修改。 */
function hasUnsavedActivityChanges() {
  if (!activityEditState.enabled) return false;
  return activityEditState.list.some(a => isActivityRowDirty(a.record_id));
}

/** 编辑弹窗是否有未保存修改。 */
function isActivityModalDirty() {
  if (!activityEditState.modalRecordId || !activityEditState.modalOriginal) return false;
  const mask = document.getElementById('activityEditMask');
  if (!mask || mask.style.display === 'none') return false;
  return activityFieldsDiffer(activityEditState.modalOriginal, collectModalFields());
}

/** 是否存在任何未保存的活动修改（行内编辑 + 编辑弹窗）。 */
function hasAnyUnsavedActivityChanges() {
  return hasUnsavedActivityChanges() || isActivityModalDirty();
}

/** 更新页面顶部的编辑状态提示。 */
function updateActivityDirtyStatus() {
  const el = document.getElementById('activityEditStatus');
  if (!el) return;
  if (!activityEditState.enabled) {
    el.className = 'edit-status';
    el.textContent = '';
    return;
  }
  const dirtyCount = activityEditState.list.filter(a => isActivityRowDirty(a.record_id)).length;
  if (dirtyCount) {
    el.className = 'edit-status show dirty';
    el.textContent = `有 ${dirtyCount} 项活动存在未保存修改，切换页面或关闭编辑模式前请先保存。`;
  } else {
    el.className = 'edit-status show';
    el.textContent = '编辑模式已开启';
  }
}

/** 表单变动时刷新未保存提示。 */
function markActivityDirty() { updateActivityDirtyStatus(); }

/** 通用确认弹窗，返回 Promise<boolean>；避免部分内置浏览器拦截原生 confirm。 */
function askConfirm(message, title = '提示') {
  const mask = document.getElementById('confirmMask');
  if (confirmResolver) confirmResolver(false);
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  mask.style.display = 'flex';
  return new Promise(resolve => { confirmResolver = resolve; });
}

let confirmResolver = null;
function resolveConfirm(result) {
  const mask = document.getElementById('confirmMask');
  if (!mask) return;
  mask.style.display = 'none';
  const resolve = confirmResolver;
  confirmResolver = null;
  if (resolve) resolve(result);
}

/** 打开活动表里的单条记录；未配置 FEISHU_SHEET_URL 时给出明确提示。 */
function openFeishuRecord(recordId) {
  const a = activityEditState.list.find(x => x.record_id === recordId);
  if (a && a.feishu_url) {
    window.open(a.feishu_url, '_blank', 'noopener');
  } else {
    toast('未配置飞书表格链接，请在后端配置 FEISHU_SHEET_URL');
  }
}

/** 生成只读活动行。 */
function buildReadOnlyActivityRow(a) {
  const row = document.createElement('div');
  row.className = 'act-item';

  const info = document.createElement('div');
  info.className = 'act-info';
  const title = document.createElement('div');
  title.className = 'act-name';
  const cat = guessCategory(a.name);
  title.textContent = cat.icon + ' ' + (a.name || '（未命名活动）');
  const meta = document.createElement('div');
  meta.className = 'act-meta';
  const when = [a.date_display, a.time_display].filter(Boolean).join(' ');
  meta.textContent = [a.status || '未设置', when, a.place].filter(Boolean).join(' · ');
  info.appendChild(title);
  info.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'act-actions';
  const editBtn = document.createElement('button');
  editBtn.className = 'act-edit-btn';
  editBtn.textContent = '编辑弹窗';
  editBtn.addEventListener('click', () => openActivityEditModal(a.record_id));
  const openBtn = document.createElement('button');
  openBtn.className = 'act-open-btn';
  openBtn.textContent = '在飞书打开';
  openBtn.addEventListener('click', () => openFeishuRecord(a.record_id));
  actions.appendChild(editBtn);
  actions.appendChild(openBtn);

  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

/** 生成行内编辑活动行（不弹窗）。 */
function buildInlineActivityRow(a) {
  const row = document.createElement('div');
  row.className = 'act-item editing';
  row.setAttribute('data-record-id', a.record_id);
  const s = activitySnapshot(a);
  const id = a.record_id;
  const statusOptions = ['已发布', '已结束']
    .map(v => `<option value="${v}"${s.status === v ? ' selected' : ''}>${v}</option>`).join('');
  const input = (field, label, value, span = false, type = 'text') => `
    <div class="act-edit-field${span ? ' span-2' : ''}">
      <label>${label}</label>
      <input type="${type}" id="inline-${field}-${id}" value="${escapeAttr(value)}"
             oninput="markActivityDirty()" onchange="markActivityDirty()">
    </div>`;

  row.innerHTML = `
    <div class="act-edit-grid">
      ${input('name', '活动名称', s.name, true)}
      ${input('time', '开始时间', toDatetimeLocalValue(s.start_ts), false, 'datetime-local')}
      <div class="act-edit-field">
        <label>状态</label>
        <select id="inline-status-${id}" onchange="markActivityDirty()">${statusOptions}</select>
      </div>
      ${input('place', '地点', s.place, true)}
      ${input('signup', '报名方式', s.signup, true)}
      <div class="act-edit-field span-2">
        <label>参与须知</label>
        <textarea id="inline-notice-${id}" rows="2" oninput="markActivityDirty()">${escapeAttr(s.notice)}</textarea>
      </div>
      ${input('link', '链接', s.link, true)}
    </div>
    <div class="act-edit-actions">
      <button type="button" class="act-save-btn" data-save-id="${id}" onclick="saveInlineActivity('${id}')">保存</button>
      <button type="button" class="act-cancel-btn" onclick="cancelInlineActivity('${id}')">取消</button>
      <button type="button" class="act-edit-btn" onclick="openActivityEditModal('${id}')">编辑弹窗</button>
      <button type="button" class="act-open-btn" onclick="openFeishuRecord('${id}')">在飞书打开</button>
    </div>`;
  return row;
}

/** 根据当前模式渲染活动管理列表。 */
function renderTeacherActivityList() {
  const list = document.getElementById('teacherActivityList');
  if (!list) return;
  const all = activityEditState.list;
  if (!all.length) {
    list.innerHTML = '<div style="color:#999;font-size:13px;">暂无活动</div>';
    updateActivityDirtyStatus();
    return;
  }
  list.innerHTML = '';
  all.forEach(a => list.appendChild(
    activityEditState.enabled ? buildInlineActivityRow(a) : buildReadOnlyActivityRow(a)
  ));
  updateActivityDirtyStatus();
}

/**
 * 拉取活动列表并渲染老师端管理页。
 * force=true（刷新按钮、进入板块）时如有未保存修改会先确认；保存后内部刷新用 false。
 */
async function loadTeacherActivities(force = true) {
  const list = document.getElementById('teacherActivityList');
  if (!list) return;
  if (force && hasAnyUnsavedActivityChanges()) {
    const ok = await askConfirm('活动列表中有未保存的修改，刷新会丢弃这些修改。确定继续吗？', '未保存的修改');
    if (!ok) return;
  }
  list.innerHTML = '<div style="color:#999;font-size:13px;">加载中…</div>';
  const all = await loadActivities(true); // 强制重新拉取，保证状态是最新的
  // 按开始时间倒序，开始时间较晚的活动排在前面。
  const sorted = all.slice().sort((a, b) => (b.start_ts || 0) - (a.start_ts || 0));
  activityEditState.list = sorted;
  activityEditState.originals = {};
  sorted.forEach(a => { activityEditState.originals[a.record_id] = activitySnapshot(a); });
  activityEditState.modalRecordId = '';
  activityEditState.modalOriginal = null;
  renderTeacherActivityList();
}

/** 开启 / 关闭编辑模式；关闭时若有未保存修改则先确认。 */
async function toggleActivityEditMode(enabled) {
  const toggle = document.getElementById('activityEditToggle');
  if (enabled) {
    activityEditState.enabled = true;
    renderTeacherActivityList();
    return;
  }
  if (hasAnyUnsavedActivityChanges()) {
    const ok = await askConfirm('有未保存的修改，关闭编辑模式会丢弃这些修改。确定关闭吗？', '未保存的修改');
    if (!ok) {
      if (toggle) toggle.checked = true;
      return;
    }
  }
  activityEditState.enabled = false;
  renderTeacherActivityList();
}

/** 放弃某行的修改，恢复为原始快照。 */
function cancelInlineActivity(recordId) {
  const a = activityEditState.list.find(x => x.record_id === recordId);
  const original = activityEditState.originals[recordId];
  if (a && original) Object.assign(a, original);
  renderTeacherActivityList();
  toast('已取消修改');
}

/** 调用 update-activity 接口写回飞书。 */
async function updateActivityRecord(recordId, payload) {
  const res = await fetch(BASE_URL + '/api/update-activity', {
    method: 'POST',
    headers: teacherHeaders(),
    body: JSON.stringify({ record_id: recordId, ...payload })
  });
  const data = await res.json().catch(() => ({ success: false }));
  if (!res.ok || !data.success) {
    throw new Error(data.error || (data.data && data.data.msg) || '保存失败，请重试');
  }
  return data;
}

/** 保存某一行的行内修改。 */
async function saveInlineActivity(recordId) {
  const payload = collectInlineFields(recordId);
  if (!validateActivityPayload(payload)) return;
  const btn = document.querySelector(`[data-save-id="${recordId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    await updateActivityRecord(recordId, payload);
    const a = activityEditState.list.find(x => x.record_id === recordId);
    if (a) Object.assign(a, payload);
    activityEditState.originals[recordId] = activitySnapshot(a || payload);
    toast('活动已保存');
    await loadTeacherActivities(false); // 重新拉取，同步日期显示与飞书深链
  } catch (e) {
    toast('保存失败：' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}

/** 填充编辑弹窗表单。 */
function fillActivityEditModal(snapshot) {
  document.getElementById('modal-act-name').value = snapshot.name || '';
  document.getElementById('modal-act-time').value = toDatetimeLocalValue(snapshot.start_ts);
  document.getElementById('modal-act-place').value = snapshot.place || '';
  document.getElementById('modal-act-signup').value = snapshot.signup || '';
  document.getElementById('modal-act-notice').value = snapshot.notice || '';
  document.getElementById('modal-act-link').value = snapshot.link || '';
  document.getElementById('modal-act-status').value =
    ['已发布', '已结束'].includes(snapshot.status) ? snapshot.status : '已发布';
}

/** 打开独立编辑弹窗：用 get-one-activity 读取最新记录。 */
async function openActivityEditModal(recordId) {
  const mask = document.getElementById('activityEditMask');
  if (isActivityModalDirty()) {
    const ok = await askConfirm('当前编辑弹窗有未保存修改，确定放弃并打开其他活动吗？', '未保存的修改');
    if (!ok) return;
  }
  let data;
  try {
    const res = await fetch(BASE_URL + '/api/get-one-activity?record_id=' + encodeURIComponent(recordId));
    data = await res.json();
    if (!data.success) throw new Error(data.error || '读取活动失败');
  } catch (e) {
    toast('读取活动失败：' + e.message);
    return;
  }
  const snapshot = activitySnapshot(data.data || {});
  activityEditState.modalRecordId = recordId;
  activityEditState.modalOriginal = snapshot;
  fillActivityEditModal(snapshot);
  mask.style.display = 'flex';
}

/** 关闭编辑弹窗；有未保存修改时先确认。 */
async function closeActivityEditModal() {
  const mask = document.getElementById('activityEditMask');
  if (!mask || mask.style.display === 'none') return;
  if (isActivityModalDirty()) {
    const ok = await askConfirm('编辑弹窗中有未保存的修改，确定关闭吗？', '未保存的修改');
    if (!ok) return;
  }
  mask.style.display = 'none';
  activityEditState.modalRecordId = '';
  activityEditState.modalOriginal = null;
}

/** 保存编辑弹窗中的修改，复用 update-activity 接口。 */
async function saveActivityEditModal() {
  const recordId = activityEditState.modalRecordId;
  if (!recordId) return;
  const payload = collectModalFields();
  if (!validateActivityPayload(payload)) return;
  const btn = document.querySelector('#activityEditMask .modal-actions .primary');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    await updateActivityRecord(recordId, payload);
    const mask = document.getElementById('activityEditMask');
    mask.style.display = 'none';
    activityEditState.modalRecordId = '';
    activityEditState.modalOriginal = null;
    toast('活动已保存');
    await loadTeacherActivities(false);
  } catch (e) {
    toast('保存失败：' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}

/** 放弃所有未保存修改并回到只读状态；用于切换页面时。 */
function resetActivityEditState() {
  activityEditState.list.forEach(a => {
    const original = activityEditState.originals[a.record_id];
    if (original) Object.assign(a, original);
  });
  activityEditState.enabled = false;
  activityEditState.modalRecordId = '';
  activityEditState.modalOriginal = null;
  const toggle = document.getElementById('activityEditToggle');
  if (toggle) toggle.checked = false;
  const mask = document.getElementById('activityEditMask');
  if (mask) mask.style.display = 'none';
  renderTeacherActivityList();
}

// 渲染一组问题条目。resolved=true 表示是"近期已回复"，输入框预填原回复并可修改。
/**
 * 生成问题卡片；resolved=true 时预填原回复并提供修改入口，兼容多种数据字段。
 */
function renderQuestionList(container, items, { resolved = false } = {}) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = '<div style="color:#999;font-size:13px;">' + (resolved ? '暂无已回复问题' : '暂无待回复问题') + '</div>';
    return;
  }
  container.innerHTML = '';
  items.forEach(item => {
    const qId = item.record_id;
    const qText = (item.fields && item.fields['提问内容']) || item.question || '（无提问内容）';
    const qAsker = item.asker || (item.fields && item.fields['提问人']) || '';
    const qTime = item.created_at || (item.fields && item.fields['提问时间']) || '';
    const existingReply = resolved ? (item.reply || (item.fields && item.fields['老师回复']) || '') : '';
    const meta = [qAsker && qAsker !== '匿名学生' ? '提问人：' + qAsker : '', qTime].filter(Boolean).join(' · ');

    const box = document.createElement('div');
    box.className = 'q-item' + (resolved ? ' q-resolved' : '');
    const title = document.createElement('div');
    title.className = 'q-text'; title.textContent = qText;
    const row = document.createElement('div');
    row.className = 'q-reply';
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.id = 'reply-input-' + qId;
    inputEl.value = existingReply;
    inputEl.placeholder = resolved ? '修改回复…' : '输入回复...';
    const btn = document.createElement('button');
    btn.textContent = resolved ? '修改回复' : '提交回复';
    btn.addEventListener('click', () => submitReply(qId, btn));
    const openBtn = document.createElement('button');
    openBtn.className = 'q-open-btn';
    openBtn.textContent = '在飞书打开';
    openBtn.addEventListener('click', () => {
      const url = item.feishu_url;
      if (url) window.open(url, '_blank', 'noopener');
      else toast('未配置飞书表格链接，请在后端配置 FEISHU_SHEET_URL');
    });
    row.appendChild(inputEl); row.appendChild(btn); row.appendChild(openBtn);
    if (meta) {
      const metaEl = document.createElement('div');
      metaEl.className = 'q-meta'; metaEl.textContent = meta;
      box.appendChild(metaEl);
    }
    box.appendChild(title); box.appendChild(row);
    container.appendChild(box);
  });
}

/**
 * 请求问题列表，分别渲染待回复和近期已回复；失败时显示加载错误。
 */
async function loadQuestions() {
  const list = document.getElementById('questionList');
  if (!list) return;
  list.innerHTML = '<div style="color:#999;font-size:13px;">加载中...</div>';
  let data;
  try {
    const res = await fetch(BASE_URL + '/api/get-questions');
    data = await res.json();
  } catch (e) {
    list.innerHTML = '<div style="color:#999;font-size:13px;">加载失败，请检查网络</div>';
    return;
  }
  if (!data.success) {
    const detail = (data.data && data.data.msg) || data.error || '';
    list.innerHTML = '<div style="color:#c00;font-size:13px;">加载失败，请稍后再试' + (detail ? '：' + detail : '') + '</div>';
    return;
  }
  // 待回复：兼容旧字段 data/items；近期已回复：resolved
  const unanswered = data.unanswered || data.items || data.data || [];
  const resolved = data.resolved || [];
  renderQuestionList(list, Array.isArray(unanswered) ? unanswered : [], { resolved: false });
  renderQuestionList(document.getElementById('resolvedList'), resolved, { resolved: true });
}

// 提交与修改回复均使用 POST 请求调用 /api/reply-question。
// 保存成功后刷新问题列表；记录状态和 AI 使用回复的方式由后端决定。
/**
 * 提交非空回复；成功后刷新列表，失败时恢复按钮。
 */
async function submitReply(recordId, btn) {
  const inputEl = document.getElementById('reply-input-' + recordId);
  const replyText = inputEl ? inputEl.value.trim() : '';
  if (!replyText) { toast('请输入回复内容'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
  try {
    const res = await fetch(BASE_URL + '/api/reply-question', {
      method: 'POST',
      headers: teacherHeaders(),
      body: JSON.stringify({ record_id: recordId, reply: replyText })
    });
    const data = await res.json();
    if (data.success) { toast('已保存！'); loadQuestions(); return; }
    toast('保存失败，请重试');
  } catch (e) {
    toast('保存失败，请重试');
  }
  if (btn) { btn.disabled = false; btn.textContent = '提交回复'; }
}

// ============================================================
// ============ 活动数据：拉取 / 时间轴 / 往期回顾 ============
// ============================================================

let activitiesCache = null; // 简易缓存，避免同一会话内重复请求

// 拉取全部活动（GET /api/get-activities）
/**
 * 请求活动数组并更新页面内缓存；默认 force=true，总会请求。
 * force=false 且已有缓存时复用；请求异常时返回缓存或空数组。
 */
async function loadActivities(force = true) {
  if (!force && activitiesCache) return activitiesCache;
  try {
    const res = await fetch(BASE_URL + '/api/get-activities');
    const data = await res.json();
    const list = (data && data.success && Array.isArray(data.data)) ? data.data : [];
    activitiesCache = list;
    return list;
  } catch (e) {
    console.error('加载活动失败：', e);
    return activitiesCache || [];
  }
}

// 根据活动名称推断分类图标（讲座🎓、文体🏀、读书📖、志愿🤝）
/**
 * 依次匹配名称关键词，采用第一个命中的分类；否则返回通用活动图标。
 */
function guessCategory(name) {
  const n = name || '';
  if (/讲座|论坛|学术|报告|沙龙|研讨|课/.test(n)) return { icon: '🎓', label: '讲座' };
  if (/读书|阅读|书会|书评/.test(n)) return { icon: '📖', label: '读书' };
  if (/志愿|公益|服务|义工|献爱心|环保/.test(n)) return { icon: '🤝', label: '志愿' };
  if (/体育|运动|球|比赛|篮球|足球|跑步|文体|晚会|文艺|歌唱|舞蹈/.test(n)) return { icon: '🏀', label: '文体' };
  return { icon: '📌', label: '活动' };
}

// 生成活动卡片 DOM（时间轴页与往期页复用）
/**
 * 生成并返回卡片元素；past=true 用于往期回顾，其余卡片支持展开详情。
 */
function buildActivityCard(a, { past = false } = {}) {
  const cat = guessCategory(a.name);
  const card = document.createElement('div');
  card.className = past ? 'review-card' : 'activity-card';
  if (past) {
    const badge = document.createElement('span');
    badge.className = 'review-badge';
    badge.textContent = '已结束';
    card.appendChild(badge);
  } else {
    // 点击卡片展开/收起详情（报名方式、须知、链接）
    card.addEventListener('click', () => card.classList.toggle('open'));
  }

  const head = document.createElement('div');
  head.className = 'ac-head';
  const icon = document.createElement('div');
  icon.className = 'ac-icon'; icon.textContent = cat.icon;
  const title = document.createElement('div');
  title.className = 'ac-title';
  const name = document.createElement('div');
  name.className = 'ac-name'; name.textContent = a.name || '（未命名活动）';
  const catLabel = document.createElement('div');
  catLabel.className = 'ac-cat'; catLabel.textContent = cat.label;
  title.appendChild(name); title.appendChild(catLabel);
  head.appendChild(icon); head.appendChild(title);
  card.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'ac-meta';
  const timeStr = past
    ? `${a.date_display || ''} ${a.time_display || ''}`.trim()
    : (a.time_display || '时间待定');
  const parts = [];
  if (timeStr) parts.push('🕐 ' + timeStr);
  if (a.place) parts.push('📍 ' + a.place);
  parts.forEach(t => {
    const s = document.createElement('span'); s.textContent = t; meta.appendChild(s);
  });
  card.appendChild(meta);

  if (past) {
    // 往期卡片精简展示，仅补一行日期
    const line = document.createElement('div');
    line.className = 'ac-line';
    line.textContent = a.date_display ? '📅 ' + a.date_display : '';
    if (a.date_display) card.appendChild(line);
  } else {
    const detail = document.createElement('div');
    detail.className = 'ac-detail';
    if (a.signup) { const d = document.createElement('div'); d.textContent = '报名方式：' + a.signup; detail.appendChild(d); }
    if (a.notice) { const d = document.createElement('div'); d.textContent = '参与须知：' + a.notice; detail.appendChild(d); }
    if (a.link) {
      const link = document.createElement('a');
      link.href = a.link; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = '🔗 查看活动链接';
      detail.appendChild(link);
    }
    if (!detail.childNodes.length) detail.textContent = '暂无更多详情';
    card.appendChild(detail);
  }
  return card;
}

// 空状态图（统一美观占位）
/**
 * 创建图标、标题和说明组成的空状态元素，供活动页面复用。
 */
function buildEmptyState(emoji, title, desc) {
  const box = document.createElement('div');
  box.className = 'empty-state';
  const e = document.createElement('span'); e.className = 'empty-emoji'; e.textContent = emoji;
  const t = document.createElement('div'); t.className = 'empty-title'; t.textContent = title;
  const d = document.createElement('div'); d.className = 'empty-desc'; d.textContent = desc;
  box.appendChild(e); box.appendChild(t); box.appendChild(d);
  return box;
}

// ---------- 时间轴渲染（核心） ----------
// 步骤：仅保留“已发布” → 按开始时间升序 → 按日期分组 → 渲染节点和卡片。
/**
 * 从缓存筛选已发布活动，按开始时间升序及日期分组后渲染时间轴。
 */
function renderTimeline() {
  const box = document.getElementById('timelineList');
  if (!box) return;
  box.innerHTML = '<div class="loading-state">正在加载活动…</div>';

  const all = activitiesCache || [];
  // 1) 只保留"已发布"（过滤掉已结束及未知状态）
  const upcoming = all.filter(a => a.status === '已发布');
  if (!upcoming.length) {
    box.innerHTML = '';
    box.appendChild(buildEmptyState('📭', '暂无进行中的活动', '新的活动发布后会自动出现在这里'));
    return;
  }

  // 2) 按开始时间从小到大排序（无时间的排最后）
  upcoming.sort((x, y) => {
    const tx = x.start_ts || Number.MAX_SAFE_INTEGER;
    const ty = y.start_ts || Number.MAX_SAFE_INTEGER;
    return tx - ty;
  });

  // 3) 按日期分组（用后端返回 date_display；无则归为"待定"）
  const groups = [];
  const map = new Map();
  upcoming.forEach(a => {
    const key = a.date_display || '待定';
    if (!map.has(key)) {
      const g = { date: key, items: [] };
      map.set(key, g); groups.push(g);
    }
    map.get(key).items.push(a);
  });

  // 4) 渲染：每个日期一个节点，节点右侧渲染当天所有活动卡片
  box.innerHTML = '';
  groups.forEach(g => {
    const wrap = document.createElement('div');
    wrap.className = 'timeline-group';

    const dateEl = document.createElement('div');
    dateEl.className = 'timeline-date';
    dateEl.textContent = g.date === '待定' ? '时间待定' : formatDateLabel(g.date);
    wrap.appendChild(dateEl);

    const cards = document.createElement('div');
    cards.className = 'timeline-cards';
    g.items.forEach(a => cards.appendChild(buildActivityCard(a, { past: false })));
    wrap.appendChild(cards);

    box.appendChild(wrap);
  });
}

// 把 "12/03" 这类日期显示美化成 "12月03日"（若已是中文格式则原样返回）
/**
 * 将纯月日格式转换为中文日期；不匹配时返回原值，不进行日期有效性校验。
 */
function formatDateLabel(s) {
  const m = String(s).match(/^(\d{1,2})[.\/-](\d{1,2})$/);
  if (m) return `${m[1]}月${m[2]}日`;
  return s;
}

// ---------- 往期回顾渲染 ----------
/**
 * 从缓存筛选已结束活动，按开始时间倒序渲染往期卡片。
 */
function renderReview() {
  const box = document.getElementById('reviewGrid');
  if (!box) return;
  box.innerHTML = '<div class="loading-state" style="grid-column:1/-1;">正在加载往期活动…</div>';

  const all = activitiesCache || [];
  const past = all.filter(a => a.status === '已结束');
  if (!past.length) {
    box.innerHTML = '';
    box.appendChild(buildEmptyState('🕰️', '暂无往期活动', '活动结束后会自动归档到这里'));
    return;
  }
  // 按时间倒序（最近的排前面）
  past.sort((x, y) => (y.start_ts || 0) - (x.start_ts || 0));
  box.innerHTML = '';
  past.forEach(a => box.appendChild(buildActivityCard(a, { past: true })));
}

// ============ 初始化 ============
// 确认弹窗按钮与遮罩：统一由 askConfirm() 驱动
document.getElementById('confirmCancel')?.addEventListener('click', () => resolveConfirm(false));
document.getElementById('confirmOk')?.addEventListener('click', () => resolveConfirm(true));
document.getElementById('confirmMask')?.addEventListener('click', function (e) {
  if (e.target === this) resolveConfirm(false);
});

// 编辑弹窗点遮罩空白处关闭（内部有未保存修改时会先确认）
document.getElementById('activityEditMask')?.addEventListener('click', function (e) {
  if (e.target === this) closeActivityEditModal();
});

// 关闭 / 刷新页面时，若有未保存修改则请求浏览器再次确认
window.addEventListener('beforeunload', function (e) {
  if (hasUnsavedActivityChanges() || isActivityModalDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// 首屏预拉一次活动，保证数据就绪；切换 Tab 时再强制刷新
loadActivities().then(() => {
  renderTimeline();
  renderReview();
});


