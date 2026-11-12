// ================== 配置区（注意：不要在这里写真实Key） ==================
// 后端接口基础地址：吕晨萱的后端已部署（腾讯云 CloudBase Run），
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

// 任务1 的写入责任方开关（2026-11-09 联调已实测：智能体回复里说"已记录"但并【没有】写飞书问题表，
// 老师端列表看不到，所以写库必须由前端负责，此开关保持 true）
//   true  = 前端负责写入（当前实现，AI 回复含"已记录"时前端 POST）
//   false = 若日后改由智能体工作流自己写库时置 false，否则同一个问题会被写两条，老师端列表重复
const ENABLE_FRONTEND_UNANSWERED_RECORD = true;

// ---------- 通用 ----------
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2000);
}
function switchTab(name) {
  // 任务5：老师端固定口令验证
  // sessionStorage 会话级记忆：验证通过后本次会话（标签页不关）不再重复询问
  if (name === 'teacher' && !sessionStorage.getItem('teacherVerified')) {
    const pwd = prompt('请输入教师验证码：');
    if (pwd === null) return; // 用户点了取消，静默返回，不弹"验证码错误"
    if (pwd !== TEACHER_PASSCODE) { alert('验证码错误！'); return; }
    sessionStorage.setItem('teacherVerified', 'true');
    // 首次进入老师端，自动加载未解答问题列表
    loadQuestions();
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('header .tabs button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
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

// 老师端写接口统一带上当前会话口令，供后端做最基本的校验。
// 注意：这只是提高门槛，不是安全机制——口令本身在前端源码里可见，
// 真正的权限边界在后端（后端不校验也不影响功能，只是防不住乱写）。
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
    // 真实后端返回 {success, text}；同时兼容约定过的 {reply}，换后端也不怕
    if (data && data.success === false) throw new Error(data.error || '后端返回失败');
    const reply = data && (data.reply || data.text);
    if (!reply) throw new Error((data && data.error) || '后端未返回 reply/text');
    return reply;
  }

  // 分支二：直连百炼（现状）。Key 还是占位值时给出可读提示，
  // 避免队友打开页面看到一串 401 原始 JSON 就以为交付没做完。
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

// 任务1：判断 AI 回复是否属于"无法回答、已记录"类
// 命中则把学生原话静默写入飞书"未解答问题表"（不弹窗，AI 本身已经回复了"已记录"）
//
// 两个前置判断：
//   1) 开关关闭时直接返回（写库责任方若交给智能体工作流，避免重复写两条）
//   2) 同一会话内问过完全一样的问题，不重复写库（去重只保留最近 3 条，会话级）
function maybeRecordUnanswered(question, reply) {
  if (!ENABLE_FRONTEND_UNANSWERED_RECORD) return;
  if (!reply || (!reply.includes('已记录') && !reply.includes('稍后回复'))) return;

  const RECENT_KEY = 'recentUnanswered';
  let recent = [];
  try { recent = JSON.parse(sessionStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { recent = []; }
  if (!Array.isArray(recent)) recent = [];
  if (recent.indexOf(question) !== -1) return; // 本会话已写过，跳过
  recent.push(question);
  sessionStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(-3)));

  fetch(BASE_URL + '/api/add-unanswered', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: question })
  }).catch(() => { /* 落库失败不打断对话，静默处理 */ });
}

async function send() {
  const text = input.value.trim();
  if (!text) return;
  addMsg(text, 'user');
  input.value = '';
  addMsg('思考中…', 'ai');
  const last = chat.lastChild.querySelector('.bubble');
  try {
    const reply = await callAgent(text);
    last.textContent = reply;
    // 任务1：AI 回复含"已记录/稍后回复"时，把学生原话写入未解答问题表
    maybeRecordUnanswered(text, reply);
  } catch (e) {
    last.textContent = '请求失败：' + e.message;
  }
  chat.scrollTop = chat.scrollHeight;
}

async function submitPreference() {
  const times = getSelected('timeChips');
  const interests = getSelected('interestChips');
  if (!times.length && !interests.length) { toast('请至少选择一项时间和兴趣'); return; }
  const prompt = `我有空的时间是：${times.join('、') || '不限'}；我的兴趣是：${interests.join('、') || '不限'}。请帮我推荐合适的活动。`;
  addMsg(prompt, 'user');
  addMsg('思考中…', 'ai');
  const last = chat.lastChild.querySelector('.bubble');
  try {
    const reply = await callAgent(prompt);
    last.textContent = reply;
    // 任务1：推荐场景同样需要兜底拦截
    maybeRecordUnanswered(prompt, reply);
  } catch (e) {
    last.textContent = '请求失败：' + e.message;
  }
  chat.scrollTop = chat.scrollHeight;
}

// ---------- 老师端 ----------
// 任务2：老师录入活动，提交给后端写入飞书"活动信息表"
async function submitActivity() {
  const timeRaw = document.getElementById('act-time').value; // YYYY-MM-DDTHH:mm，不含时区
  const payload = {
    name: document.getElementById('act-name').value,
    time: timeRaw,
    // 毫秒时间戳：datetime-local 的值不带时区，后端若直接 new Date(time) 会按"服务器本地时区"
    // 解析，而 Vercel 的 Node 跑在 UTC → 飞书里的活动时间会整体差 8 小时。
    // 请后端优先使用 time_ts，time 只作原样展示的兜底。
    time_ts: timeRaw ? new Date(timeRaw).getTime() : '',
    place: document.getElementById('act-place').value,
    signup: document.getElementById('act-signup').value,
    notice: document.getElementById('act-notice').value,
    link: document.getElementById('act-link').value
  };
  if (!payload.name || !payload.time) { toast('请填写活动名称和时间'); return; }

  // 按文案定位提交按钮（不依赖卡片顺序，UI 同学调整布局也不会错抓成"刷新列表"）
  const btn = Array.from(document.querySelectorAll('#page-teacher button'))
    .find(b => b.textContent.includes('提交活动'));
  if (btn) { btn.disabled = true; btn.textContent = '提交中…'; } // 防重复提交
  try {
    const res = await fetch(BASE_URL + '/api/add-activity', {
      method: 'POST',
      headers: teacherHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      toast('活动提交成功！');
      document.getElementById('act-name').value = '';
      document.getElementById('act-time').value = '';
      document.getElementById('act-place').value = '';
      document.getElementById('act-signup').value = '';
      document.getElementById('act-notice').value = '';
      document.getElementById('act-link').value = '';
    } else {
      // 后端失败时把具体原因带出来（联调期飞书写入失败能看到 msg，上线后也不误导用户）
      const detail = (data.data && data.data.msg) || data.error || '请检查网络';
      toast('提交失败：' + detail);
    }
  } catch (e) {
    toast('提交失败：' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '提交活动'; }
  }
}

// 任务3：拉取飞书"未解答问题表"并渲染列表
// 注意：学生提问文本用 textContent 渲染（防 HTML 注入），不要用 innerHTML 拼接
async function loadQuestions() {
  const list = document.getElementById('questionList');
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
    // 真实后端飞书写入失败时会返回 success:false + data.error（飞书原始错误），一并展示方便定位
    const detail = (data.data && data.data.msg) || data.error || '';
    list.innerHTML = '<div style="color:#c00;font-size:13px;">加载失败，请稍后再试' + (detail ? '：' + detail : '') + '</div>';
    return;
  }
  // 兼容两种返回结构：真实后端 {data:[{record_id,question,asker}]}；原约定 {items:[{record_id,fields:{...}}]}
  const items = data.items || data.data || [];
  if (!items.length) {
    list.innerHTML = '<div style="color:#999;font-size:13px;">暂无未解答问题</div>';
    return;
  }
  list.innerHTML = '';
  items.forEach(item => {
    const qId = item.record_id;
    const qText = (item.fields && item.fields['提问内容']) || item.question || '（无提问内容）';
    const qAsker = item.asker || (item.fields && item.fields['提问人']) || '';
    // 提问时间/提问人：后端返回了就显示，没返回就整行不渲染（不影响功能）
    const qTime = item.created_at || (item.fields && item.fields['提问时间']) || '';
    const meta = [qAsker ? '提问人：' + qAsker : '', qTime].filter(Boolean).join(' · ');

    const box = document.createElement('div');
    box.style.cssText = 'margin-bottom:15px;border-bottom:1px solid #eee;padding-bottom:10px;';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:bold;margin-bottom:8px;';
    title.textContent = qText; // 安全渲染，防止注入

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;';

    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.id = 'reply-input-' + qId;
    inputEl.placeholder = '输入回复...';
    inputEl.style.flex = '1';
    inputEl.style.padding = '5px';

    const btn = document.createElement('button');
    btn.textContent = '提交回复';
    btn.style.padding = '5px 10px';
    btn.addEventListener('click', () => submitReply(qId, btn));

    row.appendChild(inputEl);
    row.appendChild(btn);
    box.appendChild(title);
    if (meta) {
      const metaEl = document.createElement('div');
      metaEl.style.cssText = 'color:#999;font-size:12px;margin-bottom:6px;';
      metaEl.textContent = meta; // 同样走 textContent，后端返回什么都当纯文本
      box.appendChild(metaEl);
    }
    box.appendChild(row);
    list.appendChild(box);
  });
}

// 任务4：老师提交回复，后端更新飞书状态为"已解决"，成功后刷新列表
// btn 由 loadQuestions 传入，用于提交期间置灰，避免连点重复 POST
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
    if (data.success) {
      toast('回复成功！');
      loadQuestions(); // 刷新列表，已回复的自动消失（列表重建后 btn 已脱离文档，无需恢复文案）
      return;
    }
    toast('回复失败，请重试');
  } catch (e) {
    toast('回复失败，请重试');
  }
  if (btn) { btn.disabled = false; btn.textContent = '提交回复'; }
}