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
    resetActivityEditorState();
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
 * 切换 chat、timeline、schedule 或 review 页面；refetch=false 时只切换界面，不重新请求活动。
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
      if (name === 'schedule') renderSchedule();
      if (name === 'review') renderReview();
    });
  } else if (name === 'schedule') {
    renderSchedule(); // 数据已在缓存，直接渲染
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
    resetActivityEditorState();
  }

  document.querySelectorAll('.teacher-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.teacher-nav button').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('tpane-' + name);
  const btn = document.getElementById('tnav-' + name);
  if (pane) pane.classList.add('active');
  if (btn) btn.classList.add('active');
  // 进入板块时刷新对应数据
  if (name === 'manage') loadTeacherActivities();
  if (name === 'collect') loadCollectList();
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
  // 推荐卡片直接从同一份活动表数据匹配，学生自己决定是否加入日程
  await loadActivities(true);
  addRecommendationCards(recommendActivities(times, interests));
  chat.scrollTop = chat.scrollHeight;
}

/** 活动开始时间（北京时间）是否落在用户所选的空闲时段。 */
function activityInFreeSlot(a, slot) {
  if (!a || !a.start_ts || !slot || slot === '不限') return false;
  const bj = new Date(Number(a.start_ts) + 8 * 3600 * 1000); // 时间戳转北京时间后取 UTC 分量
  const day = bj.getUTCDay();  // 0=周日，6=周六
  const hour = bj.getUTCHours();
  const weekend = day === 0 || day === 6;
  if (slot === '工作日晚上') return !weekend && hour >= 18;
  if (slot === '周末上午') return weekend && hour < 12;
  if (slot === '周末下午') return weekend && hour >= 12 && hour < 18;
  if (slot === '周末晚上') return weekend && hour >= 18;
  return false;
}

/** 活动是否命中某个兴趣分类：优先用结构化分类，旧数据回退到名称关键词。 */
function activityMatchesInterest(a, interest) {
  if (!a || !interest || interest === '不限') return false;
  const cat = activityCategory(a).key;
  return cat === interest || String(a.category || '') === interest || String(a.name || '').includes(interest);
}

/** 按兴趣 + 空闲时间从已发布活动里打分推荐，最多返回 6 条。 */
function recommendActivities(times, interests) {
  const all = (activitiesCache || []).filter(a => a && a.status === '已发布' &&
    (!a.start_ts || a.start_ts >= Date.now()));
  if (!all.length) return [];
  const scored = all.map(a => {
    const catHit = interests.some(i => activityMatchesInterest(a, i));
    const timeHit = times.some(t => activityInFreeSlot(a, t));
    return { a, score: (catHit ? 2 : 0) + (timeHit ? 2 : 0) };
  }).filter(x => x.score > 0);
  scored.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    return (x.a.start_ts || Number.MAX_SAFE_INTEGER) - (y.a.start_ts || Number.MAX_SAFE_INTEGER);
  });
  return scored.slice(0, 6).map(x => x.a);
}

/** 在聊天区追加一组推荐活动卡片，每张卡片可单独加入/移出我的日程。 */
function addRecommendationCards(list) {
  const msg = document.createElement('div');
  msg.className = 'msg ai rec-msg';
  const bubble = document.createElement('div');
  bubble.className = 'bubble rec-bubble';

  const title = document.createElement('div');
  title.className = 'rec-title';
  title.textContent = list.length
    ? '为你匹配到以下活动，可按需加入日程：'
    : '暂时没有匹配到符合条件的活动，换个时间或兴趣试试～';
  bubble.appendChild(title);

  if (list.length) {
    const grid = document.createElement('div');
    grid.className = 'rec-grid';
    list.forEach(a => {
      const card = document.createElement('div');
      card.className = 'rec-card';

      const name = document.createElement('div');
      name.className = 'rec-name';
      name.textContent = activityCategory(a).icon + ' ' + (a.name || '（未命名活动）');

      const meta = document.createElement('div');
      meta.className = 'rec-meta';
      meta.textContent = [scheduleWhenDisplay(a), a.place].filter(Boolean).join(' · ') || '时间地点待定';

      const btn = document.createElement('button');
      btn.type = 'button';
      const inSchedule = isInSchedule(a.record_id);
      btn.className = 'rec-add-btn' + (inSchedule ? ' added' : '');
      btn.textContent = inSchedule ? '✓ 已加日程' : '＋ 加入日程';
      btn.addEventListener('click', () => {
        const added = toggleSchedule(a.record_id);
        btn.classList.toggle('added', added);
        btn.textContent = added ? '✓ 已加日程' : '＋ 加入日程';
        toast(added ? '已加入我的日程' : '已从我的日程移除');
        if (currentMainTab === 'schedule') renderSchedule();
      });

      card.appendChild(name);
      card.appendChild(meta);
      card.appendChild(btn);
      grid.appendChild(card);
    });
    bubble.appendChild(grid);
  }

  msg.appendChild(bubble);
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
}

// ---------- 老师端 ----------
/** 北京时间文本，用于「抓取时间」审计字段默认值。 */
function beijingNowText() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date()).replace(/\//g, '-');
}

/** 录入方式切换：direct 显示完整表单，wechat 显示解析入口。 */
function switchEntryMode(mode) {
  const isWechat = mode === 'wechat';
  const directBtn = document.getElementById('entryModeDirect');
  const wechatBtn = document.getElementById('entryModeWechat');
  const formBox = document.getElementById('activityFormBox');
  const wxBox = document.getElementById('wxParseBox');
  if (directBtn) directBtn.classList.toggle('active', !isWechat);
  if (wechatBtn) wechatBtn.classList.toggle('active', isWechat);
  if (formBox) formBox.style.display = isWechat ? 'none' : '';
  if (wxBox) wxBox.style.display = isWechat ? '' : 'none';
}

/** 清空录入表单，并恢复「来源 / 抓取时间」的默认值。 */
function resetActivityForm() {
  ['act-name','act-time','act-place','act-signup','act-notice','act-link','act-source-url'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const source = document.getElementById('act-source');
  if (source) source.value = '人工录入';
  const crawlTime = document.getElementById('act-crawl-time');
  if (crawlTime) crawlTime.value = beijingNowText();
  const status = document.getElementById('act-status');
  if (status) status.value = '已发布';
  const wxUrl = document.getElementById('wx-article-url');
  if (wxUrl) wxUrl.value = '';
}

/**
 * 读取表单并提交活动；校验名称、时间与溯源字段，提交成功后清空表单及缓存。
 */
async function submitActivity() {
  const timeRaw = document.getElementById('act-time').value; // YYYY-MM-DDTHH:mm，不含时区
  const get = id => (document.getElementById(id)?.value || '').trim();
  const payload = {
    name: get('act-name'),
    category: get('act-category'),
    status: get('act-status') || '已发布',
    time: timeRaw,
    // 毫秒时间戳：请后端优先使用 time_ts
    time_ts: timeRaw ? datetimeLocalToTs(timeRaw) : '',
    place: get('act-place'),
    signup: get('act-signup'),
    notice: get('act-notice'),
    link: get('act-link'),
    source: get('act-source'),
    source_url: get('act-source-url'),
    crawl_time: get('act-crawl-time')
  };
  if (!payload.name || !payload.time) { toast('请填写活动名称和时间'); return; }
  if (!payload.source) { toast('请填写来源（采集溯源）'); return; }
  // 来源链接必填（去重依据）：为空时退回到活动链接，仍为空则提示
  if (!payload.source_url && payload.link) payload.source_url = payload.link;
  if (!payload.source_url) { toast('请填写来源链接（去重依据）'); return; }
  if (!payload.crawl_time) { toast('请填写抓取时间（审计留档）'); return; }

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
      resetActivityForm();
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

// 老师端活动管理：默认只读列表，仅通过【点击编辑】弹窗修改；飞书入口全页仅一个
const activityState = {
  list: [],                 // 当前展示的活动（已按开始时间倒序）
  modalRecordId: '',        // 编辑弹窗当前记录
  modalOriginal: null       // 编辑弹窗打开时的字段快照，用于脏检查
};

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

/** 取活动字段快照，统一为标准字符串 / 时间戳。 */
function activitySnapshot(a) {
  return {
    name: a.name || '',
    category: a.category || '',
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
  return ['name', 'category', 'start_ts', 'place', 'signup', 'notice', 'link', 'status']
    .some(k => String(a[k] || '') !== String(b[k] || ''));
}

/** 读取编辑弹窗中的表单值。 */
function collectModalFields() {
  const get = id => document.getElementById(id);
  return {
    name: (get('modal-act-name')?.value || '').trim(),
    category: get('modal-act-category')?.value || '',
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
  if (!['已发布', '已结束', '待审核', '已忽略'].includes(payload.status)) {
    toast('状态只能选择“已发布”“已结束”“待审核”或“已忽略”');
    return false;
  }
  return true;
}

/** 编辑弹窗是否有未保存修改。 */
function isActivityModalDirty() {
  if (!activityState.modalRecordId || !activityState.modalOriginal) return false;
  const mask = document.getElementById('activityEditMask');
  if (!mask || mask.style.display === 'none') return false;
  return activityFieldsDiffer(activityState.modalOriginal, collectModalFields());
}

/** 是否存在任何未保存的活动修改（目前只有编辑弹窗一种入口）。 */
function hasAnyUnsavedActivityChanges() {
  return isActivityModalDirty();
}

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

/** 全页唯一的【在飞书打开】：用任意活动的深链去掉 record 参数，落到活动表本身。 */
function openFeishuTable() {
  const a = activityState.list.find(x => x.feishu_url);
  if (!a) {
    toast('未配置飞书表格链接，请在后端配置 FEISHU_SHEET_URL');
    return;
  }
  try {
    const u = new URL(a.feishu_url);
    u.searchParams.delete('record');
    window.open(u.toString(), '_blank', 'noopener');
  } catch (e) {
    window.open(a.feishu_url, '_blank', 'noopener');
  }
}

/** 生成只读活动行：每行只保留【点击编辑】入口，飞书入口全页仅一个。 */
function buildReadOnlyActivityRow(a) {
  const row = document.createElement('div');
  row.className = 'act-item';

  const info = document.createElement('div');
  info.className = 'act-info';
  const title = document.createElement('div');
  title.className = 'act-name';
  const cat = activityCategory(a);
  title.textContent = cat.icon + ' ' + (a.name || '（未命名活动）');
  const meta = document.createElement('div');
  meta.className = 'act-meta';
  const when = [a.date_display, a.time_display].filter(Boolean).join(' ');
  meta.textContent = [a.status || '未设置', when, a.place].filter(Boolean).join(' · ');
  info.appendChild(title);
  info.appendChild(meta);

  const btn = document.createElement('button');
  btn.className = 'act-edit-btn';
  btn.textContent = '点击编辑';
  btn.addEventListener('click', () => openActivityEditModal(a.record_id));

  row.appendChild(info);
  row.appendChild(btn);
  return row;
}

/** 渲染老师端活动列表（只读）。 */
function renderTeacherActivityList() {
  const list = document.getElementById('teacherActivityList');
  if (!list) return;
  const all = activityState.list;
  if (!all.length) {
    list.innerHTML = '<div style="color:#999;font-size:13px;">暂无活动</div>';
    return;
  }
  list.innerHTML = '';
  all.forEach(a => list.appendChild(buildReadOnlyActivityRow(a)));
}

/** 拉取活动列表并渲染老师端管理页；未保存的弹窗修改会先确认。 */
async function loadTeacherActivities() {
  const list = document.getElementById('teacherActivityList');
  if (!list) return;
  if (isActivityModalDirty()) {
    const ok = await askConfirm('编辑弹窗中有未保存的修改，刷新会丢弃这些修改。确定继续吗？', '未保存的修改');
    if (!ok) return;
  }
  list.innerHTML = '<div style="color:#999;font-size:13px;">加载中…</div>';
  const all = await loadActivities(true); // 强制重新拉取，保证状态是最新的
  // 按开始时间倒序，开始时间较晚的活动排在前面。
  const sorted = all.slice().sort((a, b) => (b.start_ts || 0) - (a.start_ts || 0));
  activityState.list = sorted;
  activityState.modalRecordId = '';
  activityState.modalOriginal = null;
  renderTeacherActivityList();
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

/** 填充编辑弹窗表单。 */
function fillActivityEditModal(snapshot) {
  document.getElementById('modal-act-name').value = snapshot.name || '';
  document.getElementById('modal-act-category').value =
    CATEGORIES.some(c => c.key === snapshot.category) ? snapshot.category : '其他';
  document.getElementById('modal-act-time').value = toDatetimeLocalValue(snapshot.start_ts);
  document.getElementById('modal-act-place').value = snapshot.place || '';
  document.getElementById('modal-act-signup').value = snapshot.signup || '';
  document.getElementById('modal-act-notice').value = snapshot.notice || '';
  document.getElementById('modal-act-link').value = snapshot.link || '';
  document.getElementById('modal-act-status').value =
    ['已发布', '已结束', '待审核', '已忽略'].includes(snapshot.status) ? snapshot.status : '已发布';
}

/**
 * 打开编辑弹窗：直接用当前表格中已展示的内容预填，打开后不再异步覆盖。
 * 需要飞书最新数据时，先点【刷新活动】再打开弹窗。
 */
async function openActivityEditModal(recordId) {
  const mask = document.getElementById('activityEditMask');
  if (isActivityModalDirty()) {
    const ok = await askConfirm('当前编辑弹窗有未保存修改，确定放弃并打开其他活动吗？', '未保存的修改');
    if (!ok) return;
  }
  const cached = activityState.list.find(x => x.record_id === recordId);
  if (!cached) { toast('未找到该活动'); return; }

  const snapshot = activitySnapshot(cached); // 保留当前表格里已编辑好的内容
  activityState.modalRecordId = recordId;
  activityState.modalOriginal = snapshot;
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
  activityState.modalRecordId = '';
  activityState.modalOriginal = null;
}

/** 保存编辑弹窗中的修改，复用 update-activity 接口。 */
async function saveActivityEditModal() {
  const recordId = activityState.modalRecordId;
  if (!recordId) return;
  const payload = collectModalFields();
  if (!validateActivityPayload(payload)) return;
  const btn = document.querySelector('#activityEditMask .modal-actions .primary');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    await updateActivityRecord(recordId, payload);
    const mask = document.getElementById('activityEditMask');
    mask.style.display = 'none';
    activityState.modalRecordId = '';
    activityState.modalOriginal = null;
    toast('活动已保存');
    await loadTeacherActivities();
  } catch (e) {
    toast('保存失败：' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}

/** 放弃未保存的弹窗修改；用于切换页面时。 */
function resetActivityEditorState() {
  activityState.modalRecordId = '';
  activityState.modalOriginal = null;
  const mask = document.getElementById('activityEditMask');
  if (mask) mask.style.display = 'none';
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
// ============ 老师端：采集审核 + 公众号文章解析 ============
// ============================================================
// 官网自动采集的活动以 状态=待审核 写入活动表，在这里核对/补齐后发布；
// 发布前学生端不可见（时间表/往期回顾只读"已发布/已结束"）。

/** 拉取并渲染"采集审核"候选列表（状态=待审核）。 */
async function loadCollectList() {
  const box = document.getElementById('collectList');
  if (!box) return;
  box.innerHTML = '<div style="color:#999;font-size:13px;">加载中…</div>';
  const all = await loadActivities(true);
  const candidates = all
    .filter(a => a.status === '待审核')
    .sort((a, b) => (b.start_ts || 0) - (a.start_ts || 0));
  if (!candidates.length) {
    box.innerHTML = '<div style="color:#999;font-size:13px;">暂无待审核的采集候选。点上方「立即抓取一次」试试，或等待定时任务运行。</div>';
    return;
  }
  box.innerHTML = '';
  candidates.forEach(a => box.appendChild(buildCollectCard(a)));
}

/** 生成一张候选审核卡片：可编辑字段 + 通过发布 / 忽略按钮。 */
function buildCollectCard(a) {
  const card = document.createElement('div');
  card.className = 'collect-card';
  card.dataset.recordId = a.record_id;

  const head = document.createElement('div');
  head.className = 'collect-head';
  const title = document.createElement('div');
  title.className = 'collect-title';
  const cat = activityCategory(a);
  title.textContent = cat.icon + ' ' + (a.name || '（未命名活动）');
  const badge = document.createElement('span');
  badge.className = 'collect-badge';
  badge.textContent = '待审核';
  head.appendChild(title); head.appendChild(badge);
  card.appendChild(head);

  // 来源行：来源名称 + 原文链接
  const srcLine = document.createElement('div');
  srcLine.className = 'collect-source';
  const srcParts = ['来源：' + (a.source || '网络采集')];
  if (a.crawl_time) srcParts.push('抓取于 ' + a.crawl_time);
  srcLine.textContent = srcParts.join(' · ');
  if (a.link) {
    const link = document.createElement('a');
    link.href = a.link; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = ' ｜ 查看原文 ↗';
    srcLine.appendChild(link);
  }
  card.appendChild(srcLine);

  // 可编辑字段网格：名称 / 分类 / 时间 / 地点 / 报名 / 须知
  const grid = document.createElement('div');
  grid.className = 'collect-grid';

  const field = (labelText, id, value, span2) => {
    const wrap = document.createElement('div');
    if (span2) wrap.className = 'span-2';
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.id = id;
    input.value = value || '';
    wrap.appendChild(label); wrap.appendChild(input);
    return wrap;
  };

  grid.appendChild(field('活动名称', 'collect-name-' + a.record_id, a.name, true));

  // 分类下拉
  const catWrap = document.createElement('div');
  const catLabel = document.createElement('label');
  catLabel.textContent = '分类';
  const catSel = document.createElement('select');
  catSel.id = 'collect-cat-' + a.record_id;
  CATEGORIES.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.key;
    opt.textContent = c.icon + ' ' + c.key;
    if (c.key === cat.key) opt.selected = true;
    catSel.appendChild(opt);
  });
  catWrap.appendChild(catLabel); catWrap.appendChild(catSel);
  grid.appendChild(catWrap);

  // 开始时间（datetime-local）
  const timeWrap = document.createElement('div');
  const timeLabel = document.createElement('label');
  timeLabel.textContent = '开始时间';
  const timeInput = document.createElement('input');
  timeInput.type = 'datetime-local';
  timeInput.id = 'collect-time-' + a.record_id;
  timeInput.value = toDatetimeLocalValue(a.start_ts);
  timeWrap.appendChild(timeLabel); timeWrap.appendChild(timeInput);
  grid.appendChild(timeWrap);

  grid.appendChild(field('地点', 'collect-place-' + a.record_id, a.place));
  grid.appendChild(field('报名方式', 'collect-signup-' + a.record_id, a.signup));
  grid.appendChild(field('参与须知', 'collect-notice-' + a.record_id, a.notice, true));

  card.appendChild(grid);

  const btns = document.createElement('div');
  btns.className = 'collect-btns';
  const approveBtn = document.createElement('button');
  approveBtn.type = 'button';
  approveBtn.className = 'approve';
  approveBtn.textContent = '✓ 通过发布';
  approveBtn.addEventListener('click', () => reviewCollected(a.record_id, 'publish', approveBtn));
  const ignoreBtn = document.createElement('button');
  ignoreBtn.type = 'button';
  ignoreBtn.className = 'ignore';
  ignoreBtn.textContent = '忽略';
  ignoreBtn.addEventListener('click', () => reviewCollected(a.record_id, 'ignore', ignoreBtn));
  btns.appendChild(approveBtn); btns.appendChild(ignoreBtn);
  card.appendChild(btns);

  return card;
}

/** 读取候选卡片上的表单值。 */
function collectCardFields(recordId) {
  const get = id => document.getElementById(id);
  const timeValue = get('collect-time-' + recordId)?.value || '';
  return {
    name: (get('collect-name-' + recordId)?.value || '').trim(),
    category: get('collect-cat-' + recordId)?.value || '',
    start_ts: datetimeLocalToTs(timeValue),
    place: (get('collect-place-' + recordId)?.value || '').trim(),
    signup: (get('collect-signup-' + recordId)?.value || '').trim(),
    notice: (get('collect-notice-' + recordId)?.value || '').trim()
  };
}

/**
 * 审核操作：action='publish' 时把卡片字段连同状态=已发布写回飞书；
 * action='ignore' 时仅把状态改为已忽略（学生端与时间表均不再显示）。
 */
async function reviewCollected(recordId, action, btn) {
  const payload = action === 'publish'
    ? { ...collectCardFields(recordId), status: '已发布' }
    : { status: '已忽略' };
  if (action === 'publish' && !payload.name) {
    toast('活动名称不能为空');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
  try {
    await updateActivityRecord(recordId, payload);
    toast(action === 'publish' ? '已发布，学生端即可看到' : '已忽略该候选');
    loadCollectList();
  } catch (e) {
    toast('操作失败：' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = action === 'publish' ? '✓ 通过发布' : '忽略'; }
  }
}

/** 手动触发一次采集（POST /api/crawl/run）。 */
async function runCrawlNow(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '抓取中…'; }
  try {
    const res = await fetch(BASE_URL + '/api/crawl/run', {
      method: 'POST',
      headers: teacherHeaders()
    });
    const data = await res.json();
    if (data.success) {
      const d = data.data || {};
      toast(`抓取完成：新增 ${d.addedCount} 条，跳过重复 ${d.skippedCount} 条`);
      loadCollectList();
    } else {
      toast('抓取失败：' + (data.error || '未知错误'));
    }
  } catch (e) {
    toast('抓取失败：' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ 立即抓取一次'; }
  }
}

/** 解析公众号文章链接，把标题/内容摘要及溯源字段填进录入表单。 */
async function parseWechatArticle() {
  const input = document.getElementById('wx-article-url');
  const url = (input?.value || '').trim();
  if (!url) { toast('请先粘贴公众号文章链接'); return; }
  const btn = document.querySelector('.wx-parse-row .act-open-btn');
  if (btn) { btn.disabled = true; btn.textContent = '解析中…'; }
  try {
    const res = await fetch(BASE_URL + '/api/parse-article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (data.success && data.data) {
      const d = data.data;
      const nameEl = document.getElementById('act-name');
      const noticeEl = document.getElementById('act-notice');
      const linkEl = document.getElementById('act-link');
      const sourceEl = document.getElementById('act-source');
      const sourceUrlEl = document.getElementById('act-source-url');
      const crawlTimeEl = document.getElementById('act-crawl-time');
      const statusEl = document.getElementById('act-status');

      if (nameEl && !nameEl.value.trim()) nameEl.value = d.title;
      if (noticeEl && !noticeEl.value.trim()) {
        noticeEl.value = [d.account ? '来源公众号：' + d.account : '',
                          d.publish_time ? '发布于：' + d.publish_time : '',
                          d.content_preview].filter(Boolean).join('\n');
      }
      if (linkEl) linkEl.value = d.url;
      if (sourceEl) sourceEl.value = d.account ? '公众号：' + d.account : '微信公众号';
      if (sourceUrlEl) sourceUrlEl.value = d.url;
      if (crawlTimeEl) crawlTimeEl.value = beijingNowText();
      if (statusEl) statusEl.value = '已发布';

      // 解析完成后切回可编辑表单，标题与溯源字段已带出
      switchEntryMode('direct');
      toast('已填入「' + String(d.title || '').slice(0, 15) + '…」，请补齐时间与地点后提交');
    } else {
      toast('解析失败：' + (data.error || '未知错误'));
    }
  } catch (e) {
    toast('解析失败：' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '解析填入'; }
  }
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

// ============ 分类体系（结构化分类：志愿服务 / 竞赛活动 / 讲座 / 文体 / 读书） ============
// 与飞书活动表「分类」单选字段保持一致；抓取打标和筛选 chips 都用这一套。
const CATEGORIES = [
  { key: '志愿服务', icon: '🤝' },
  { key: '竞赛活动', icon: '🏆' },
  { key: '讲座',     icon: '🎓' },
  { key: '文体',     icon: '🏀' },
  { key: '读书',     icon: '📖' },
  { key: '其他',     icon: '📌' }
];

/** 在 CATEGORIES 中查找分类对象；找不到时回退到"其他"。 */
function findCategory(key) {
  const k = String(key || '').trim();
  const hit = CATEGORIES.find(c => c.key === k);
  return hit || CATEGORIES[CATEGORIES.length - 1];
}

/** 渲染两个分类下拉（录入表单 / 编辑弹窗），保持单一数据来源。 */
function renderCategorySelects() {
  ['act-category', 'modal-act-category'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel || sel.options.length) return;
    CATEGORIES.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.key;
      opt.textContent = c.icon + ' ' + c.key;
      sel.appendChild(opt);
    });
  });
}

// 根据活动名称推断分类（分类字段为空的旧数据 / 抓取打标的兜底）
/**
 * 依次匹配名称关键词，采用第一个命中的分类；否则返回通用活动图标。
 */
function guessCategory(name) {
  const n = name || '';
  if (/讲座|论坛|学术|报告|沙龙|研讨|课/.test(n)) return { icon: '🎓', label: '讲座' };
  if (/读书|阅读|书会|书评/.test(n)) return { icon: '📖', label: '读书' };
  if (/志愿|公益|服务|义工|献爱心|环保/.test(n)) return { icon: '🤝', label: '志愿服务' };
  if (/竞赛|大赛|挑战杯|创新创业|比赛/.test(n)) return { icon: '🏆', label: '竞赛活动' };
  if (/体育|运动|球|篮球|足球|跑步|文体|晚会|文艺|歌唱|舞蹈/.test(n)) return { icon: '🏀', label: '文体' };
  return { icon: '📌', label: '其他' };
}

/**
 * 取活动的结构化分类：优先用飞书「分类」字段；为空时回退到名称关键词推断。
 * 返回 { key, icon }。
 */
function activityCategory(a) {
  const field = String((a && a.category) || '').trim();
  if (field) {
    const hit = CATEGORIES.find(c => c.key === field || field.includes(c.key));
    if (hit) return { key: hit.key, icon: hit.icon };
  }
  const guessed = guessCategory(a && a.name);
  return { key: guessed.label, icon: guessed.icon };
}

// 生成活动卡片 DOM（时间轴页与往期页复用）
/**
 * 生成并返回卡片元素；past=true 用于往期回顾，其余卡片支持展开详情。
 * 非往期卡片右上角带「＋日程 / 已加日程」收藏按钮（与展开点击互不干扰）。
 */
function buildActivityCard(a, { past = false } = {}) {
  const cat = activityCategory(a);
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
  catLabel.className = 'ac-cat'; catLabel.textContent = cat.key;
  title.appendChild(name); title.appendChild(catLabel);
  head.appendChild(icon); head.appendChild(title);
  if (!past) {
    // 收藏按钮：事件上 stopPropagation，避免触发卡片展开
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'sch-add-btn' + (isInSchedule(a.record_id) ? ' added' : '');
    addBtn.textContent = isInSchedule(a.record_id) ? '✓ 已加' : '＋日程';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const added = toggleSchedule(a.record_id);
      addBtn.classList.toggle('added', added);
      addBtn.textContent = added ? '✓ 已加' : '＋日程';
      toast(added ? '已加入我的日程' : '已从我的日程移除');
      if (currentMainTab === 'schedule') renderSchedule(); // 日程页开着时同步刷新
    });
    head.appendChild(addBtn);
  }
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

// ---------- 分类筛选（时间表页顶部 chips） ----------
let currentTimelineFilter = '全部';

/** 渲染时间表顶部的分类筛选 chips（全部 + 六个结构化分类）。 */
function renderCategoryFilter() {
  const box = document.getElementById('timelineFilter');
  if (!box || box.childElementCount) return; // 只渲染一次
  ['全部'].concat(CATEGORIES.map(c => c.key)).forEach(key => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fchip' + (key === currentTimelineFilter ? ' active' : '');
    btn.textContent = key;
    btn.addEventListener('click', () => {
      currentTimelineFilter = key;
      box.querySelectorAll('.fchip').forEach(b => b.classList.toggle('active', b.textContent === key));
      renderTimeline();
    });
    box.appendChild(btn);
  });
}

// ---------- 时间轴渲染（核心） ----------
// 步骤：仅保留“已发布” → 应用分类筛选 → 按开始时间升序 → 按日期分组 → 渲染节点和卡片。
/**
 * 从缓存筛选已发布活动，应用分类筛选后按开始时间升序及日期分组渲染时间轴。
 */
function renderTimeline() {
  const box = document.getElementById('timelineList');
  if (!box) return;
  box.innerHTML = '<div class="loading-state">正在加载活动…</div>';
  renderCategoryFilter();

  const all = activitiesCache || [];
  // 1) 只保留"已发布"（过滤掉已结束及未知状态）
  let upcoming = all.filter(a => a.status === '已发布');
  // 1.5) 分类筛选：选了具体分类时，按结构化分类匹配（含关键词推断兜底）
  if (currentTimelineFilter !== '全部') {
    upcoming = upcoming.filter(a => activityCategory(a).key === currentTimelineFilter);
  }
  if (!upcoming.length) {
    box.innerHTML = '';
    box.appendChild(buildEmptyState('📭',
      currentTimelineFilter === '全部' ? '暂无进行中的活动' : `暂无「${currentTimelineFilter}」类活动`,
      '新的活动发布后会自动出现在这里'));
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

// ============================================================
// ============ 我的日程：收藏 / 冲突检测 / ics 导出 ============
// ============================================================
// 收藏关系存在浏览器本地（localStorage），免登录、零后端；
// 重新进入页面时按 record_id 与最新活动表数据对齐，已下架的活动自动过滤。

const SCHEDULE_KEY = 'myScheduleIds';
// 无结束时间时的默认活动时长（分钟），用于冲突检测和 ics DTEND
const DEFAULT_DURATION_MIN = 120;

/** 读取本地收藏的活动 record_id 数组。 */
function getScheduleIds() {
  try {
    const arr = JSON.parse(localStorage.getItem(SCHEDULE_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

/** 写回本地收藏数组。 */
function setScheduleIds(ids) {
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(ids));
}

/** 当前活动是否已加入我的日程。 */
function isInSchedule(recordId) {
  return !!recordId && getScheduleIds().indexOf(recordId) !== -1;
}

/** 加入/移出我的日程，返回加入后的状态（true=已加入）。 */
function toggleSchedule(recordId) {
  if (!recordId) return false;
  const ids = getScheduleIds();
  const idx = ids.indexOf(recordId);
  if (idx === -1) { ids.push(recordId); setScheduleIds(ids); return true; }
  ids.splice(idx, 1); setScheduleIds(ids); return false;
}

/** 我的日程对应的活动列表（按 record_id 对齐活动表，已发布优先、隐藏已失效项）。 */
function getScheduleActivities() {
  const ids = getScheduleIds();
  const map = new Map((activitiesCache || []).map(a => [a.record_id, a]));
  return ids
    .map(id => map.get(id))
    .filter(Boolean)
    .sort((x, y) => (x.start_ts || Number.MAX_SAFE_INTEGER) - (y.start_ts || Number.MAX_SAFE_INTEGER));
}

/** 毫秒时间戳 -> 北京时间展示（同时间表页格式）。 */
function scheduleWhenDisplay(a) {
  const when = [a.date_display, a.time_display].filter(Boolean).join(' ');
  return when || '时间待定';
}

/** 渲染"我的日程"页：按日期分组的收藏活动 + 时间冲突提示。 */
function renderSchedule() {
  const box = document.getElementById('scheduleList');
  if (!box) return;
  const countEl = document.getElementById('scheduleCount');
  const items = getScheduleActivities();

  if (countEl) {
    countEl.textContent = items.length ? `已收藏 ${items.length} 个活动` : '';
  }

  if (!items.length) {
    box.innerHTML = '';
    box.appendChild(buildEmptyState('🗓️', '日程还是空的',
      '去「活动时间表」点卡片上的「＋日程」收藏感兴趣的活动吧'));
    return;
  }

  // 时间冲突检测：默认时长 120 分钟，两场活动区间重叠即提示
  const conflictIds = new Set();
  const withTime = items.filter(a => a.start_ts);
  for (let i = 1; i < withTime.length; i++) {
    const prevEnd = withTime[i - 1].start_ts + DEFAULT_DURATION_MIN * 60000;
    if (withTime[i].start_ts < prevEnd) {
      conflictIds.add(withTime[i - 1].record_id);
      conflictIds.add(withTime[i].record_id);
    }
  }

  box.innerHTML = '';
  items.forEach(a => {
    const cat = activityCategory(a);
    const card = document.createElement('div');
    card.className = 'sch-card' + (conflictIds.has(a.record_id) ? ' conflict' : '');

    const head = document.createElement('div');
    head.className = 'ac-head';
    const icon = document.createElement('div');
    icon.className = 'ac-icon'; icon.textContent = cat.icon;
    const title = document.createElement('div');
    title.className = 'ac-title';
    const nameEl = document.createElement('div');
    nameEl.className = 'ac-name'; nameEl.textContent = a.name || '（未命名活动）';
    const catLabel = document.createElement('div');
    catLabel.className = 'ac-cat'; catLabel.textContent = cat.key;
    title.appendChild(nameEl); title.appendChild(catLabel);
    head.appendChild(icon); head.appendChild(title);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'sch-add-btn added';
    removeBtn.textContent = '移除';
    removeBtn.addEventListener('click', () => {
      toggleSchedule(a.record_id);
      renderSchedule();
      toast('已从我的日程移除');
    });
    head.appendChild(removeBtn);
    card.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'ac-meta';
    const parts = ['🕐 ' + scheduleWhenDisplay(a)];
    if (a.place) parts.push('📍 ' + a.place);
    parts.forEach(t => {
      const s = document.createElement('span'); s.textContent = t; meta.appendChild(s);
    });
    card.appendChild(meta);

    if (conflictIds.has(a.record_id) && a.start_ts) {
      const warn = document.createElement('div');
      warn.className = 'conflict-warn';
      warn.textContent = '⚠️ 与其他已收藏活动时间冲突';
      card.appendChild(warn);
    }

    if (a.link) {
      const link = document.createElement('a');
      link.className = 'sch-link';
      link.href = a.link; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = '🔗 查看活动链接';
      card.appendChild(link);
    }

    box.appendChild(card);
  });
}

// ---------- 标准 ics 日历导出 ----------
/** 毫秒时间戳 -> ics UTC 格式（YYYYMMDDTHHMMSSZ，UTC 与北京时间相差 8 小时）。 */
function icsUtc(ts) {
  const d = new Date(Number(ts) - 8 * 3600 * 1000);
  return d.getUTCFullYear()
    + String(d.getUTCMonth() + 1).padStart(2, '0')
    + String(d.getUTCDate()).padStart(2, '0')
    + 'T' + String(d.getUTCHours()).padStart(2, '0')
    + String(d.getUTCMinutes()).padStart(2, '0')
    + '00Z';
}

/** ics TEXT 值转义：反斜杠、分号、逗号、换行。 */
function icsEscape(v) {
  return String(v || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 用收藏活动生成标准 VCALENDAR 并触发下载（Apple / Google / Outlook 日历均可导入）。 */
function exportMySchedule() {
  const items = getScheduleActivities().filter(a => a.start_ts);
  if (!items.length) {
    toast('日程里还没有带时间的活动，先去收藏几个吧');
    return;
  }
  const now = icsUtc(Date.now());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Campus Activity Assistant//CN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:学院活动日程'
  ];
  items.forEach(a => {
    const start = Number(a.start_ts);
    const end = start + DEFAULT_DURATION_MIN * 60000;
    const descParts = [];
    if (a.signup) descParts.push('报名方式：' + a.signup);
    if (a.notice) descParts.push('参与须知：' + a.notice);
    if (a.link) descParts.push('链接：' + a.link);
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + a.record_id + '@activity-assistant',
      'DTSTAMP:' + now,
      'DTSTART:' + icsUtc(start),
      'DTEND:' + icsUtc(end),
      'SUMMARY:' + icsEscape(a.name || '活动'),
      'LOCATION:' + icsEscape(a.place || ''),
      'DESCRIPTION:' + icsEscape(descParts.join('\n')),
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');

  // ics 规范要求 CRLF 换行
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = '我的日程.ics';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出 ' + items.length + ' 个活动，可在手机/电脑日历中导入');
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
  if (hasAnyUnsavedActivityChanges()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// 首屏预拉一次活动，保证数据就绪；切换 Tab 时再强制刷新
loadActivities().then(() => {
  renderCategorySelects(); // 录入表单与编辑弹窗的分类下拉
  switchEntryMode('direct'); // 录入方式默认「直接录入」
  resetActivityForm();       // 来源默认「人工录入」、抓取时间默认当前北京时间
  renderTimeline();
  renderSchedule();
  renderReview();
});


