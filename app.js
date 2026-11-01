// ================== 配置区（注意：不要在这里写真实Key） ==================
const API_KEY = 'xxx'; // 让孙赟替换为你写的 Vercel 后端接口地址，不再直接连百炼
const APP_ID  = 'xxx';
// ========================================================

const API_URL = 'https://dashscope.aliyuncs.com/api/v1/apps/' + APP_ID + '/completion';

// ---------- 通用 ----------
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2000);
}
function switchTab(name) {
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

async function callAgent(prompt) {
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
    // 孙赟注意：在这里判断 reply 中是否包含"已记录"，如果包含，则开启轮询机制
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
  } catch (e) {
    last.textContent = '请求失败：' + e.message;
  }
  chat.scrollTop = chat.scrollHeight;
}

// ---------- 老师端 ----------
async function submitActivity() {
  const payload = {
    name: document.getElementById('act-name').value,
    time: document.getElementById('act-time').value,
    place: document.getElementById('act-place').value,
    signup: document.getElementById('act-signup').value,
    notice: document.getElementById('act-notice').value,
    link: document.getElementById('act-link').value
  };
  if (!payload.name || !payload.time) { toast('请填写活动名称和时间'); return; }
  
  // 孙赟注意：此处需要改成 fetch 请求你写的 Vercel 后端接口，将 payload 发送过去
  console.log('准备提交活动给后端：', payload);
  toast('活动已提交（等待对接后端接口）');
}

async function loadQuestions() {
  const list = document.getElementById('questionList');
  list.innerHTML = '<div style="color:#999;font-size:13px;">演示阶段：此处应调用后端API读取未解答问题</div>';
  // 孙赟注意：此处需要发请求拉取未解答问题，并循环渲染出输入框
}