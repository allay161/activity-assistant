// ================== 配置区（注意：不要在这里写真实Key） ==================
// 后端接口基础地址：吕晨萱的后端已部署（腾讯云 CloudBase 云托管），
// 2026-11-09 孙赟联调实测通过（get-questions / reply-question / chat 正常）。
const BASE_URL = '';

// 学生端对话走哪条链路（迁移只需改这一个开关，callAgent 内部已两条分支写好）：
//   false = 直连阿里云百炼（需填下面的 API_KEY / APP_ID，Key 会暴露在前端）
//   true  = 走后端代理 {BASE_URL}/api/chat（Key 只放在服务端环境变量里）
// 2026-11-09 实测 /api/chat 已就绪，开关已置 true。
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
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2000);
}

// ========== 导航：角色切换（学生端 / 老师端） ==========
// 学生端展示三 Tab 主导航；老师端展示后台页面。
function switchRole(name) {
  const nav = document.getElementById('mainNav');
  const mainPages = document.querySelectorAll('.main-page');
  const teacherPage = document.getElementById('page-teacher');

  document.getElementById('tab-student').classList.toggle('active', name === 'student');
  document.getElementById('tab-teacher').classList.toggle('active', name === 'teacher');

  if (name === 'teacher') {
    // 老师端口令验证（sessionStorage 会话级记忆，验证通过后本次会话不再重复询问）
    if (!sessionStorage.getItem('teacherVerified')) {
      const pwd = prompt('请输入教师验证码：');
      if (pwd === null) return; // 点了取消，静默返回
      if (pwd !== TEACHER_PASSCODE) {
        alert('验证码错误！');
        document.getElementById('tab-student').classList.add('active');
        document.getElementById('tab-teacher').classList.remove('active');
        return;
      }
      sessionStorage.setItem('teacherVerified', 'true');
    }
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

// ========== 导航：主 Tab 切换（智能问答 / 活动时间表 / 往期回顾） ==========
let currentMainTab = 'chat';

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
function switchTab(name) {
  if (name === 'teacher') switchRole('teacher');
  else switchMainTab(name === 'student' ? 'chat' : name);
}

// ========== 老师端子板块切换（录入活动 / 活动管理 / 问题回复） ==========
function switchTeacherTab(name) {
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

function toggleChip(el) { el.classList.toggle('selected'); }
function getSelected(containerId) {
  return Array.from(document.querySelectorAll('#' + containerId + ' .chip.selected')).map(c => c.textContent);
}

// ---------- 学生端 ----------
const chat = document.getElementById('chat');
const input = document.getElementById('input');

function addMsg(text, role) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = '<div class="bubble"></div>';
  div.querySelector('.bubble').textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// "思考中"气泡：三个跳动的圆点（动效由 CSS 完成），返回气泡元素供回复时替换文本
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
function teacherHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Teacher-Token': sessionStorage.getItem('teacherVerified') ? TEACHER_PASSCODE : ''
  };
}

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
function send() { return sendMessage(); }

// 快捷问题胶囊：点击后作为一条消息直接发出
function quickAsk(text) { return sendMessage(text); }

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

// 老师端：拉取活动列表，每条提供【在飞书打开】按钮直达该记录的飞书深链进行编辑
async function loadTeacherActivities() {
  const list = document.getElementById('teacherActivityList');
  if (!list) return;
  list.innerHTML = '<div style="color:#999;font-size:13px;">加载中…</div>';
  const all = await loadActivities(true); // 强制重新拉取，保证状态是最新的
  if (!all.length) {
    list.innerHTML = '<div style="color:#999;font-size:13px;">暂无活动</div>';
    return;
  }
  // 按开始时间倒序，最近发布的排前面
  const sorted = all.slice().sort((a, b) => (b.start_ts || 0) - (a.start_ts || 0));
  list.innerHTML = '';
  sorted.forEach(a => {
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
    const status = a.status || '未设置';
    const when = [a.date_display, a.time_display].filter(Boolean).join(' ');
    meta.textContent = [status, when, a.place].filter(Boolean).join(' · ');
    info.appendChild(title);
    info.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'act-open-btn';
    btn.textContent = '在飞书打开';
    btn.addEventListener('click', () => {
      if (a.feishu_url) {
        window.open(a.feishu_url, '_blank', 'noopener');
      } else {
        toast('未配置飞书表格链接，请在后端配置 FEISHU_SHEET_URL');
      }
    });

    row.appendChild(info);
    row.appendChild(btn);
    list.appendChild(row);
  });
}

// 渲染一组问题条目。resolved=true 表示是"近期已回复"，输入框预填原回复并可修改。
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

// 提交/修改回复：走同一个 reply-question 接口（PUT 覆盖，状态置为已解决）。
// 已回复的问题修改后仍为"已解决"，AI 下次会用新的老师回复作答。
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
function guessCategory(name) {
  const n = name || '';
  if (/讲座|论坛|学术|报告|沙龙|研讨|课/.test(n)) return { icon: '🎓', label: '讲座' };
  if (/读书|阅读|书会|书评/.test(n)) return { icon: '📖', label: '读书' };
  if (/志愿|公益|服务|义工|献爱心|环保/.test(n)) return { icon: '🤝', label: '志愿' };
  if (/体育|运动|球|比赛|篮球|足球|跑步|文体|晚会|文艺|歌唱|舞蹈/.test(n)) return { icon: '🏀', label: '文体' };
  return { icon: '📌', label: '活动' };
}

// 生成活动卡片 DOM（时间轴页与往期页复用）
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
// 步骤：过滤掉"已结束" → 按开始时间升序 → 按日期分组 → 渲染节点+卡片
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
function formatDateLabel(s) {
  const m = String(s).match(/^(\d{1,2})[.\/-](\d{1,2})$/);
  if (m) return `${m[1]}月${m[2]}日`;
  return s;
}

// ---------- 往期回顾渲染 ----------
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
// 首屏预拉一次活动，保证数据就绪；切换 Tab 时再强制刷新
loadActivities().then(() => {
  renderTimeline();
  renderReview();
});
