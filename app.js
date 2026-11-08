// ================== 配置区 ==================
// 所有密钥（飞书、百炼）都保存在 Cloudflare 环境变量中，前端只请求同域的 /api/* 接口，不再暴露任何 Key。
// ========================================================

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
  if (name === 'teacher') loadQuestions(); // 进入老师端时自动拉取未解答问题
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
  // 通过后端 /api/chat 代理百炼 / DashScope 请求，前端不持有任何密钥
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || '请求失败');
  return data.text;
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
    // AI 标记该问题需转交老师：自动写入飞书「问题表」
    if (reply.includes('已记录')) {
      fetch('/api/add-unanswered', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text })
      }).catch(() => {});
    }
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
  
  try {
    const res = await fetch('/api/add-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      toast('活动已提交成功');
      ['act-name', 'act-time', 'act-place', 'act-signup', 'act-notice', 'act-link']
        .forEach(id => { document.getElementById(id).value = ''; });
    } else {
      toast('提交失败：' + (data.error || '未知错误'));
    }
  } catch (e) {
    toast('请求失败：' + e.message);
  }
}

async function loadQuestions() {
  const list = document.getElementById('questionList');
  list.innerHTML = '<div style="color:#999;font-size:13px;">加载中…</div>';
  try {
    const res = await fetch('/api/get-questions');
    const data = await res.json();
    if (!data.success) {
      list.innerHTML = '<div style="color:#c00;">加载失败：' + (data.error || '未知错误') + '</div>';
      return;
    }
    const questions = data.data || [];
    if (!questions.length) {
      list.innerHTML = '<div style="color:#999;font-size:13px;">暂无未解答问题 🎉</div>';
      return;
    }
    list.innerHTML = '';
    questions.forEach(q => {
      const item = document.createElement('div');
      item.style.border = '1px solid #eee';
      item.style.borderRadius = '8px';
      item.style.padding = '10px';
      item.style.marginBottom = '10px';

      const meta = document.createElement('div');
      meta.style.color = '#888';
      meta.style.fontSize = '12px';
      meta.textContent = '提问人：' + q.asker;

      const text = document.createElement('div');
      text.style.margin = '6px 0';
      text.textContent = q.question;

      const replyInput = document.createElement('input');
      replyInput.type = 'text';
      replyInput.placeholder = '输入回复…';
      replyInput.style.flex = '1';
      replyInput.style.marginRight = '6px';
      replyInput.style.padding = '6px';
      replyInput.style.border = '1px solid #ddd';
      replyInput.style.borderRadius = '6px';

      const btn = document.createElement('button');
      btn.textContent = '回复';
      btn.className = 'primary';
      btn.style.padding = '6px 12px';

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.appendChild(replyInput);
      row.appendChild(btn);

      btn.addEventListener('click', async () => {
        const reply = replyInput.value.trim();
        if (!reply) { toast('请输入回复内容'); return; }
        btn.disabled = true;
        try {
          const r = await fetch('/api/reply-question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ record_id: q.record_id, reply })
          });
          const rd = await r.json();
          if (rd.success) {
            toast('已回复，问题标记为已解决');
            item.remove();
            if (!list.children.length) {
              list.innerHTML = '<div style="color:#999;font-size:13px;">暂无未解答问题 🎉</div>';
            }
          } else {
            toast('回复失败：' + (rd.error || '未知错误'));
            btn.disabled = false;
          }
        } catch (e) {
          toast('请求失败：' + e.message);
          btn.disabled = false;
        }
      });

      item.appendChild(meta);
      item.appendChild(text);
      item.appendChild(row);
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = '<div style="color:#c00;">加载失败：' + e.message + '</div>';
  }
}