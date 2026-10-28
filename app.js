(() => {
  'use strict';

  const banks = Array.isArray(window.SLATE_BANKS) ? window.SLATE_BANKS : [];
  if (!banks.length) throw new Error('Question banks not loaded');

  const bankMap = new Map(banks.map(bank => [bank.id, bank]));
  const db = window.SLATE_AUTH.client;
  const userId = window.SLATE_AUTH.user.id;
  let cloudQueue = Promise.resolve();
  let cloudError = '';
  let finishingExam = false;
  const STORAGE_KEY = 'slate-v2-' + window.SLATE_AUTH.user.id;
  const $app = document.getElementById('app');
  const $dialog = document.getElementById('imageDialog');
  const $dialogImg = document.getElementById('imageDialogImg');
  document.getElementById('imageDialogClose').onclick = () => $dialog.close();
  $dialog.addEventListener('click', event => {
    if (event.target === $dialog) $dialog.close();
  });

  function defaultBankState(bank) {
    return {
      studyId: bank.questions[0]?.id || 1,
      studyAnswers: {},
      studyChecked: {},
      exam: null,
      statistics: { exams: [], attempts: {}, studyChecks: 0, studyCorrect: 0 },
      search: '',
      filter: 'all',
      examSize: Math.min(20, bank.questions.length),
    };
  }

  function defaultState() {
    return {
      view: 'home',
      activeBankId: banks[0].id,
      bankState: {},
    };
  }

  let state = loadState();

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      const next = { ...defaultState(), ...(saved || {}) };
      if (!bankMap.has(next.activeBankId)) next.activeBankId = banks[0].id;
      next.bankState = next.bankState && typeof next.bankState === 'object' ? next.bankState : {};
      return next;
    } catch {
      return defaultState();
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const current = state.bankState[state.activeBankId]?.exam;
    if (current && !current.finished) queueActive(current, state.activeBankId);
  }

  function attemptRow(ex, bankId) {
    return {id: ex.uuid, user_id: userId, bank_id: bankId, mode: ex.mode || 'exam',
      started_at: ex.startedAt, total_questions: ex.ids.length,
      shuffle_questions: Boolean(ex.shuffleQuestions), shuffle_answers: Boolean(ex.shuffleAnswers), snapshot: ex};
  }
  function queueActive(ex, bankId) {
    if (!ex.uuid) return;
    const row = structuredClone(attemptRow(ex, bankId));
    cloudQueue = cloudQueue.catch(() => {}).then(async () => {
      const {error} = await db.from('exam_attempts').upsert(row);
      cloudError = error ? error.message : '';
      const status = document.getElementById('cloudStatus');
      if (status) status.textContent = cloudError ? 'Not synced: ' + cloudError : 'Saved';
    });
  }
  async function persistFinished(ex) {
    queueActive(bs().exam, state.activeBankId);
    await cloudQueue;
    if (cloudError) throw new Error(cloudError);
    const duration = Math.max(0, Math.round((new Date(ex.result.finishedAt)-new Date(ex.startedAt))/1000));
    const records = ex.ids.map((id,index) => {
      const q = byId().get(id); return {question_id:id,question_order:index,
        selected_answers:ex.answers[id]||[],correct_answers:q.answer,is_correct:sameAnswer(q,ex.answers[id]||[]),
        option_order:ex.optionOrders[id]||Object.keys(q.options),question_snapshot:q};
    });
    const {error} = await db.rpc('finish_exam',{p_id:ex.uuid,p_snapshot:ex,p_answers:records,
      p_correct:ex.result.correct,p_score:ex.result.score,p_duration:duration});
    if (error) throw error;
    const saved = await db.from('exam_attempts').select('snapshot').eq('id',ex.uuid).single();
    if (saved.error) throw saved.error;
    Object.assign(bs().exam,saved.data.snapshot);
  }

  function bank() {
    return bankMap.get(state.activeBankId) || banks[0];
  }

  function bs() {
    const current = bank();
    const existing = state.bankState[current.id];
    if (!existing) state.bankState[current.id] = defaultBankState(current);
    else {
      const defaults = defaultBankState(current);
      for (const key of Object.keys(defaults)) {
        if (existing[key] === undefined) existing[key] = defaults[key];
      }
      if (!existing.statistics || typeof existing.statistics !== 'object') existing.statistics = defaults.statistics;
      for (const key of Object.keys(defaults.statistics)) {
        if (existing.statistics[key] === undefined) existing.statistics[key] = defaults.statistics[key];
      }
    }
    return state.bankState[current.id];
  }

  function questions() {
    return bank().questions;
  }

  function byId() {
    const source = ['exam','result'].includes(state.view) && bs().exam?.questionSnapshots ? bs().exam.questionSnapshots : questions();
    return new Map(source.map(question => [question.id, question]));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[char]);
  }

  function isOrdering(question) {
    return Object.keys(question.options).length === 0 && question.answer.length > 1;
  }

  function sameAnswer(question, selected) {
    return isOrdering(question)
      ? selected.length === question.answer.length && selected.every((value, index) => value === question.answer[index])
      : sameSet(selected, question.answer);
  }

  function orderingHtml(q, selected, checked) {
    const choices = [...q.answer].sort();
    return q.answer.map((_, index) => `<label class="option ${checked ? (selected[index] === q.answer[index] ? 'correct' : 'wrong') : ''}"><span class="letter">${index + 1}</span><select data-order="${index}" aria-label="Крок ${index + 1}" ${checked ? 'disabled' : ''}><option value="">Оберіть критерій…</option>${choices.map(value => `<option value="${escapeHtml(value)}" ${selected[index] === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>`).join('');
  }

  function sameSet(left, right) {
    return left.length === right.length && [...left].sort().join('|') === [...right].sort().join('|');
  }

  function pct(value, total) {
    return total ? Math.round((value / total) * 100) : 0;
  }

  function complete(question, selected) {
    if (!question) return false;
    if (isOrdering(question)) return selected?.length === question.answer.length && selected.every(Boolean) && new Set(selected).size === question.answer.length;
    return (selected?.length || 0) === (question.correctCount || question.answer.length);
  }

  function shell(inner) {
    const current = bank();
    return `<div class="shell">
      <header class="topbar">
        <button class="brand" data-home>
          <span class="brand-mark">S</span>
          <span><b>Slate Workspace</b><small>Fortinet Exam Platform</small></span>
        </button>
        <div class="top-actions"><button class="button" data-view="home">Home</button><button class="button" data-view="study">Study</button><button class="button" data-view="examSetup">Exam</button><span id="cloudStatus">${escapeHtml(cloudError ? "Not synced: " + cloudError : "Saved")}</span><button class="button" data-view="history">History</button><button class="button" data-view="stats">Statistics</button><button class="button" data-view="profile">Profile</button>${window.SLATE_AUTH.profile.role === "admin" ? '<button class="button" data-view="admin">Admin</button>' : ''}<span>${escapeHtml(window.SLATE_AUTH.profile.display_name || window.SLATE_AUTH.user.email)}</span><button class="button" id="logout">Logout</button>
          <span class="pill">${escapeHtml(current.product)}</span>
          <span class="muted">${current.questionCount} питань</span>
        </div>
      </header>
      ${inner}
      <footer class="footer">Slate Combined · FortiOS 7.6 Administrator + FortiSIEM Practice Exam · історія екзаменів зберігається у вашому обліковому записі.</footer>
    </div>`;
  }

  function render() {
    if (state.view === 'home') renderHome();
    else if (state.view === 'study') renderStudy();
    else if (state.view === 'examSetup') renderExamSetup();
    else if (state.view === 'exam') renderExam();
    else if (state.view === 'result') renderResult();
    else if (state.view === 'stats') renderCloudStats();
    else if (state.view === 'history') renderHistory();
    else if (state.view === 'profile') renderProfile();
    else if (state.view === 'admin') renderAdmin();
    bindGlobal();
  }

  function bindGlobal() {
    document.querySelectorAll('[data-view]').forEach(b => b.onclick=()=>{state.view=b.dataset.view;render();});
    document.getElementById('logout').onclick = async () => { const {error} = await window.SLATE_AUTH.client.auth.signOut(); if (error) alert(error.message); };
    document.querySelectorAll('[data-home]').forEach(button => {
      button.onclick = () => {
        state.view = 'home';
        save();
        render();
      };
    });
  }

  function renderHome() {
    const current = bank();
    const local = bs();
    const stats = summaryStats();
    const answered = Object.values(local.statistics.attempts || {}).filter(item => item.attempts > 0).length;
    const totalAcrossBanks = banks.reduce((sum, item) => sum + item.questionCount, 0);

    $app.innerHTML = shell(`<main class="page">
      <section class="hero">
        <div class="hero-card">
          <span class="eyebrow">${escapeHtml(current.vendor)} · ${escapeHtml(current.product)}</span>
          <h1>${escapeHtml(current.title)}</h1>
          <p>${escapeHtml(current.description)}</p>
          <div class="hero-stats">
            <div class="stat-chip"><strong>${current.questionCount}</strong><span>питань</span></div>
            <div class="stat-chip"><strong>${current.imageCount}</strong><span>схем / exhibit</span></div>
            <div class="stat-chip"><strong>${stats.best}%</strong><span>кращий результат</span></div>
            <div class="stat-chip"><strong>${answered}</strong><span>вже практикували</span></div>
          </div>
        </div>
        <div class="selector-card hero-card">
          <label>Вендор / продукт / екзамен</label>
          <select class="select" id="bankSelect">
            ${banks.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === current.id ? 'selected' : ''}>${escapeHtml(item.vendor)} → ${escapeHtml(item.product)} → ${escapeHtml(item.title)} (${item.questionCount})</option>`).join('')}
          </select>
          <div class="selector-meta"><b>${banks.length} банки · ${totalAcrossBanks} питань разом.</b><br>FortiOS: старий екзамен. FortiSIEM: новий екзамен. Обирай банк тут — Study, Exam і статистика працюють окремо для кожного.</div>
        </div>
      </section>

      <section class="modes">
        ${modeCard('📘', 'Вивчення', `Покроковий Study для ${current.title}: миттєва перевірка, exhibits і повторення помилок.`, 'Відкрити Study', 'study')}
        ${modeCard('🎯', 'Новий екзамен', `10 / 20 / 40 / усі ${current.questionCount} питань. Правильність прихована до Finish.`, 'Налаштувати Exam', 'examSetup')}
        ${modeCard('📊', 'Статистика', 'Історія екзаменів, точність Study та питання, де ти помиляєшся найчастіше.', 'Моя статистика', 'stats')}
      </section>

      <section class="home-section">
        <div class="section-head">
          <div><h2>Прогрес · ${escapeHtml(current.product)}</h2><p>Прогрес банків зберігається окремо.</p></div>
          <button class="button danger" id="resetBank">Скинути цей банк</button>
        </div>
        <div class="panel progress-card">
          <div class="progress-row"><div class="progress-track"><div class="progress-fill" style="width:${pct(answered, current.questionCount)}%"></div></div><b>${answered}/${current.questionCount}</b></div>
        </div>
      </section>
    </main>`);

    document.getElementById('bankSelect').onchange = event => {
      state.activeBankId = event.target.value;
      state.view = 'home';
      save();
      render();
    };
    document.querySelectorAll('[data-view]').forEach(button => {
      button.onclick = () => {
        state.view = button.dataset.view;
        save();
        render();
      };
    });
    document.getElementById('resetBank').onclick = () => {
      if (confirm(`Скинути Study, Exam і статистику тільки для ${current.title}?`)) {
        state.bankState[current.id] = defaultBankState(current);
        save();
        render();
      }
    };
  }

  function modeCard(icon, title, text, action, view) {
    return `<article class="mode-card"><div class="mode-icon">${icon}</div><h3>${title}</h3><p>${text}</p><button class="button primary" data-view="${view}">${action}</button></article>`;
  }

  function filteredStudy() {
    const local = bs();
    const query = (local.search || '').trim().toLowerCase();
    return questions().filter(item => {
      const attempt = local.statistics.attempts?.[item.id];
      if (local.filter === 'wrong' && !(attempt?.wrong > 0)) return false;
      if (local.filter === 'unanswered' && attempt?.attempts > 0) return false;
      if (!query) return true;
      return String(item.id).includes(query)
        || item.text.toLowerCase().includes(query)
        || Object.values(item.options).some(value => value.toLowerCase().includes(query));
    });
  }

  function renderStudy() {
    const local = bs();
    const map = byId();
    const q = map.get(local.studyId) || questions()[0];
    local.studyId = q.id;
    const selected = local.studyAnswers[q.id] || [];
    const checked = Boolean(local.studyChecked[q.id]);
    const correct = sameAnswer(q, selected);
    const filtered = filteredStudy();

    $app.innerHTML = shell(`<main class="page">
      <div class="toolbar">
        <button class="button" data-home>← Головна</button>
        <input id="studySearch" value="${escapeHtml(local.search)}" placeholder="Знайти питання або номер…">
        <select id="studyFilter"><option value="all" ${local.filter === 'all' ? 'selected' : ''}>Усі</option><option value="unanswered" ${local.filter === 'unanswered' ? 'selected' : ''}>Без відповіді</option><option value="wrong" ${local.filter === 'wrong' ? 'selected' : ''}>Помилки</option></select>
        <label><input type="checkbox" id="studyAnswerShuffle" ${local.shuffleStudy ? 'checked' : ''}> Shuffle answers</label><button class="button" id="studyShuffle">Випадкове</button>
      </div>
      <div class="workspace">
        <aside class="side-card"><h3>${escapeHtml(bank().product)} · ${filtered.length}</h3><div class="question-grid">${filtered.map(studyDot).join('')}</div><div class="side-stats">Study checks: ${local.statistics.studyChecks}<br>Правильно: ${local.statistics.studyCorrect}<br>Accuracy: ${pct(local.statistics.studyCorrect, local.statistics.studyChecks)}%</div></aside>
        <section>${questionCard(q, selected, checked, 'study')}${checked ? `<div class="feedback ${correct ? 'ok' : 'bad'}">${correct ? '✓ Правильно' : '✕ Неправильно'}${!correct ? `. Правильна відповідь: <b>${displayAnswers(q, q.answer, 'study')}</b>` : ''}</div>` : ''}<div class="actions">${!checked ? `<button class="button primary" id="checkStudy" ${!complete(q, selected) ? 'disabled' : ''}>Перевірити</button>` : '<button class="button primary" id="nextStudy">Наступне питання →</button>'}<span class="answer-requirement">Потрібно вибрати: <b>${q.correctCount}</b></span></div><div class="nav-row"><button class="button" id="prevStudy">← Попереднє</button><button class="button" id="nextStudyNav" ${!checked ? 'disabled' : ''}>Далі →</button></div></section>
      </div>
    </main>`);

    bindQuestionOptions(q, 'study', checked);
    document.getElementById('studyAnswerShuffle').onchange = event => {
      local.shuffleStudy = event.target.checked; local.optionOrders = {}; save(); render();
    };
    document.querySelectorAll('[data-qid]').forEach(button => {
      button.onclick = () => {
        local.studyId = Number(button.dataset.qid);
        save();
        render();
      };
    });
    document.getElementById('studySearch').oninput = event => {
      local.search = event.target.value;
      save();
      render();
    };
    document.getElementById('studyFilter').onchange = event => {
      local.filter = event.target.value;
      save();
      render();
    };
    document.getElementById('studyShuffle').onclick = () => {
      const pool = filteredStudy();
      if (pool.length) {
        local.studyId = pool[Math.floor(Math.random() * pool.length)].id;
        save();
        render();
      }
    };
    const check = document.getElementById('checkStudy');
    if (check) check.onclick = () => checkStudy(q);
    const next = () => navigateStudy(1, filtered);
    const prev = () => navigateStudy(-1, filtered);
    document.getElementById('prevStudy').onclick = prev;
    document.getElementById('nextStudyNav').onclick = next;
    const nextStudy = document.getElementById('nextStudy');
    if (nextStudy) nextStudy.onclick = next;
  }

  function studyDot(q) {
    const local = bs();
    const attempt = local.statistics.attempts?.[q.id];
    let className = '';
    if (attempt?.wrong > 0) className = 'wrong';
    else if (attempt?.correct > 0) className = 'correct';
    if (q.id === local.studyId) className += ' current';
    return `<button class="qdot ${className}" data-qid="${q.id}">${q.id}</button>`;
  }

  function navigateStudy(delta, pool) {
    const local = bs();
    const list = pool.length ? pool : questions();
    let index = list.findIndex(item => item.id === local.studyId);
    index = (index + delta + list.length) % list.length;
    local.studyId = list[index].id;
    save();
    render();
  }

  function checkStudy(q) {
    const local = bs();
    const selected = local.studyAnswers[q.id] || [];
    if (!complete(q, selected)) return;
    local.studyChecked[q.id] = true;
    const ok = sameAnswer(q, selected);
    local.statistics.studyChecks += 1;
    if (ok) local.statistics.studyCorrect += 1;
    recordAttempt(q.id, ok);
    save();
    render();
  }

  function optionOrder(q, mode) {
    if (isOrdering(q)) return [];
    const local = bs();
    const session = mode === 'study' ? local : local.exam;
    const enabled = mode === 'study' ? local.shuffleStudy : session?.shuffleAnswers;
    if (!enabled) return Object.keys(q.options);
    session.optionOrders ||= {};
    if (!session.optionOrders[q.id]) {
      session.optionOrders[q.id] = Object.keys(q.options);
      shuffleArray(session.optionOrders[q.id]); save();
    }
    return session.optionOrders[q.id];
  }

  function displayAnswers(q, answers, mode) {
    if (isOrdering(q)) return answers.map(escapeHtml).join(', ');
    const order = optionOrder(q, mode);
    return answers.map(id => String.fromCharCode(65 + order.indexOf(id))).join(', ');
  }

  function questionCard(q, selected, checked, mode) {
    return `<article class="question-card">
      <div class="question-top"><span>${escapeHtml(bank().product)} · Question ${q.id} of ${questions().length}</span><span>${isOrdering(q) ? 'Arrange in order' : q.correctCount === 1 ? 'Single answer' : `Choose ${q.correctCount}`}</span></div>
      <h2 class="question-text">${escapeHtml(q.text)}</h2>
      
      ${q.image ? `<div class="exhibit"><img src="${escapeHtml(q.image)}" data-zoom alt="Exhibit for question ${q.id}"></div>` : ''}
      <div class="instruction">${isOrdering(q) ? 'Розташуй критерії по порядку. Кожен використай один раз.' : `Вибери рівно ${q.correctCount} ${q.correctCount === 1 ? 'відповідь' : 'відповіді'}`}</div>
      <div class="options">${isOrdering(q) ? orderingHtml(q, selected, checked) : optionOrder(q, mode).map((key, index) => optionHtml(q, key, q.options[key], selected, checked, String.fromCharCode(65 + index))).join('')}</div>
    </article>`;
  }

  function optionHtml(q, key, value, selected, checked, label) {
    const isSelected = selected.includes(key);
    const isRight = q.answer.includes(key);
    let className = isSelected ? 'selected' : '';
    if (checked) {
      if (isRight) className += ' correct';
      else if (isSelected) className += ' wrong';
    }
    return `<label class="option ${className}"><input type="checkbox" value="${escapeHtml(key)}" ${isSelected ? 'checked' : ''} ${checked ? 'disabled' : ''}><span class="letter">${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></label>`;
  }

  function bindQuestionOptions(q, mode, locked) {
    const local = bs();
    document.querySelectorAll('.option input').forEach(input => {
      input.onchange = event => {
        if (locked) return;
        const store = mode === 'study' ? local.studyAnswers : local.exam.answers;
        let selected = [...(store[q.id] || [])];
        const key = event.target.value;
        if (event.target.checked) {
          if (q.correctCount === 1) selected = [key];
          else if (selected.length < q.correctCount) selected.push(key);
          else {
            event.target.checked = false;
            return;
          }
        } else selected = selected.filter(item => item !== key);
        store[q.id] = selected;
        if (mode === 'study') local.studyChecked[q.id] = false;
        save();
        render();
      };
    });
    document.querySelectorAll('[data-order]').forEach(select => {
      select.onchange = event => {
        if (locked) return;
        const store = mode === 'study' ? local.studyAnswers : local.exam.answers;
        const selected = Array.from({ length: q.answer.length }, (_, index) => store[q.id]?.[index] || '');
        selected[Number(event.target.dataset.order)] = event.target.value;
        store[q.id] = selected;
        if (mode === 'study') local.studyChecked[q.id] = false;
        save();
        render();
      };
    });
    document.querySelectorAll('[data-zoom]').forEach(image => {
      image.onclick = () => {
        $dialogImg.src = image.src;
        $dialog.showModal();
      };
    });
  }

  function renderExamSetup() {
    const local = bs();
    const total = questions().length;
    const choices = [...new Set([10, 20, 40, total].filter(value => value <= total))];
    if (!Number.isInteger(local.examSize) || local.examSize < 1 || local.examSize > total) local.examSize = Math.min(20, total);

    $app.innerHTML = shell(`<main class="page"><div class="exam-setup"><button class="button" data-home>← Головна</button><section class="panel" style="margin-top:14px"><span class="eyebrow">${escapeHtml(bank().title)}</span><h1 style="font-size:30px">Налаштування екзамену</h1><label>Question bank<select class="select" id="examBank">${banks.map(b=>`<option value="${b.id}" ${b.id===state.activeBankId?'selected':''}>${escapeHtml(b.product)} · ${b.questions.length} questions</option>`).join('')}</select></label><p class="muted">Оберіть кількість питань і налаштування. Відповіді приховані до завершення.</p><div class="choice-grid">${choices.map(count => `<button class="count-choice ${local.examSize === count ? 'active' : ''}" data-count="${count}">${count === total ? `Full ${total}` : count}</button>`).join('')}</div><label>Custom questions (1–${total}): <input id="customCount" type="number" min="1" max="${total}" step="1" value="${local.examSize}"></label><p id="setupError" role="alert"></p><label><input type="checkbox" id="shuffleExam" checked> Перемішати питання</label><label><input type="checkbox" id="shuffleAnswers"> Shuffle answers</label><button class="button primary wide" id="startExam" style="margin-top:20px">Почати екзамен</button></section></div></main>`);
    document.getElementById('examBank').onchange=e=>{state.activeBankId=e.target.value;save();render();};
    document.querySelectorAll('[data-count]').forEach(button => {
      button.onclick = () => {
        local.examSize = Number(button.dataset.count);
        save();
        render();
      };
    });
    document.getElementById('startExam').onclick = () => {
      const count = Number(document.getElementById('customCount').value);
      if (!validCount(count,total)) {
        document.getElementById('setupError').textContent = `Enter a whole number from 1 to ${total}.`; return;
      }
      local.examSize = count;
      startExam(document.getElementById('shuffleExam').checked);
    };
  }

  function newAttemptId() {
    const bytes=crypto.getRandomValues(new Uint8Array(16)); bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  function validCount(count,total) { return Number.isInteger(count) && count>=1 && count<=total; }
  function selectQuestions(source,count,shuffle) {
    if(!validCount(count,source.length)) throw new Error('Invalid question count');
    const ids=source.map(q=>q.id); if(shuffle)shuffleArray(ids); return ids.slice(0,count);
  }
  function startExam(shuffle) {
    const local = bs();
    const ids = selectQuestions(questions(),local.examSize,shuffle);
    local.exam = { uuid: newAttemptId(), questionSnapshots: structuredClone(questions().filter(q=>ids.includes(q.id))), ids, index: 0, answers: {}, shuffleQuestions: shuffle, shuffleAnswers: Boolean(document.getElementById("shuffleAnswers")?.checked), optionOrders: {}, startedAt: new Date().toISOString(), finished: false, result: null };
    state.view = 'exam';
    save();
    render();
  }

  function renderExam() {
    const local = bs();
    const ex = local.exam;
    if (!ex || ex.finished) {
      state.view = ex?.finished ? 'result' : 'examSetup';
      save();
      return render();
    }
    const map = byId();
    const id = ex.ids[ex.index];
    const q = map.get(id);
    const selected = ex.answers[id] || [];
    const canNext = complete(q, selected);

    $app.innerHTML = shell(`<main class="page"><p>Question ${ex.index+1} of ${ex.ids.length}</p><div class="workspace"><aside class="side-card"><h3>${escapeHtml(bank().product)} Exam</h3><div class="question-grid">${ex.ids.map((questionId, index) => `<button class="qdot ${index === ex.index ? 'current' : ''} ${complete(map.get(questionId), ex.answers[questionId] || []) ? 'answered' : ''}" data-eidx="${index}">${index + 1}</button>`).join('')}</div><div class="side-stats">Відповіли: ${ex.ids.filter(questionId => complete(map.get(questionId), ex.answers[questionId] || [])).length}/${ex.ids.length}<br>Правильність прихована до Finish.</div></aside><section><div class="exam-progress"><span style="width:${pct(ex.index + 1, ex.ids.length)}%"></span></div>${questionCard(q, selected, false, 'exam')}<div class="actions"><span class="answer-requirement">Потрібно вибрати: <b>${q.correctCount}</b></span></div><div class="nav-row"><button class="button" id="examPrev" ${ex.index === 0 ? 'disabled' : ''}>← Попереднє</button>${ex.index === ex.ids.length - 1 ? `<button class="button primary" id="finishExam" >Завершити екзамен</button>` : `<button class="button primary" id="examNext" >Далі →</button>`}</div></section></div></main>`);

    bindQuestionOptions(q, 'exam', false);
    document.querySelectorAll('[data-eidx]').forEach(button => {
      button.onclick = () => {
        const target = Number(button.dataset.eidx);
        if (target >= 0 && target < ex.ids.length) {
          ex.index = target;
          save();
          render();
        }
      };
    });
    document.getElementById('examPrev').onclick = () => {
      if (ex.index > 0) {
        ex.index -= 1;
        save();
        render();
      }
    };
    const next = document.getElementById('examNext');
    if (next) next.onclick = () => {
      if (ex.index < ex.ids.length - 1) {
        ex.index += 1;
        save();
        render();
      }
    };
    const finish = document.getElementById('finishExam');
    if (finish) finish.onclick = finishExam;
  }

  async function finishExam() {
    const local = bs();
    const ex = local.exam;
    if (!ex || ex.finished || finishingExam) return;
    finishingExam = true;
    const map = byId();

    let correct = 0;
    const review = ex.ids.map(id => {
      const q = map.get(id);
      const selected = ex.answers[id] || [];
      const ok = sameAnswer(q, selected);
      if (ok) correct += 1;
      return { id, selected, correct: q.answer, ok };
    });
    const result = {
      correct,
      total: ex.ids.length,
      score: +(100*correct/ex.ids.length).toFixed(2),
      review,
      finishedAt: new Date().toISOString(),
    };
    ex.result = result;
    try {
      await persistFinished({...ex, finished:true});
      Object.assign(result, ex.result);
    } catch (error) {
      finishingExam = false;
      alert('Exam not saved. Your answers are retained. Please retry Finish. ' + error.message); return;
    }
    ex.finished = true;
    finishingExam = false;
    result.review.forEach(item => recordAttempt(item.id, item.ok));
    local.statistics.exams.push({
      uuid: ex.uuid, snapshot: structuredClone(ex), score: result.score,
      correct: result.correct,
      total: result.total,
      startedAt: ex.startedAt,
      finishedAt: result.finishedAt,
    });
    state.view = 'result';
    save();
    render();
  }

  function renderResult() {
    const ex=bs().exam,result=ex?.result;
    if(!result){state.view='home';return render();}
    const map=byId(), filter=state.reviewFilter||'all';
    const items=result.review.filter(r=>filter==='all'||(filter==='correct'?r.ok:!r.ok));
    $app.innerHTML=shell(`<main class="page"><section class="panel"><h1>Exam Review · ${escapeHtml(bank().product)}</h1><div class="score-big">${result.score}%</div><p>${result.correct} correct / ${result.total} questions</p><div class="actions"><button class="button" data-review-filter="all">All</button><button class="button" data-review-filter="correct">Correct</button><button class="button" data-review-filter="incorrect">Incorrect</button><button class="button primary" id="retryIncorrect" ${result.correct===result.total?'disabled':''}>Retry incorrect questions</button><button class="button" data-home>Home</button></div>${items.map(item=>{
      const q=map.get(item.id);
      return `<section class="review-item ${item.ok?'ok':'bad'}"><h3>${item.ok?'✅ Correct':'❌ Incorrect'}</h3>${questionCard(q,item.selected,true,'exam')}<p>Your answer: ${displayAnswers(q,item.selected,'exam')||'—'}</p><p>Correct answer: ${displayAnswers(q,item.correct,'exam')}</p></section>`;
    }).join('')}</section></main>`);
    document.querySelectorAll('[data-review-filter]').forEach(b=>b.onclick=()=>{state.reviewFilter=b.dataset.reviewFilter;render();});
    document.querySelectorAll('[data-zoom]').forEach(img=>img.onclick=()=>{$dialogImg.src=img.src;$dialog.showModal();});
    document.getElementById('retryIncorrect').onclick=()=>{
      const ids=result.review.filter(r=>!r.ok).map(r=>r.id);if(!ids.length)return;
      bs().exam={uuid:newAttemptId(),ids,index:0,answers:{},optionOrders:{},questionSnapshots:structuredClone(ids.map(id=>map.get(id))),
        mode:'practice',shuffleQuestions:false,shuffleAnswers:ex.shuffleAnswers,startedAt:new Date().toISOString(),finished:false,result:null};
      state.reviewFilter='all';state.view='exam';save();render();
    };
  }

  async function allRows(table, build) {
    const rows=[];
    for (let offset=0;;offset+=500) {
      let q=db.from(table).select('*').range(offset,offset+499);
      if(build) q=build(q);
      const {data,error}=await q; if(error) throw error;
      rows.push(...data); if(data.length<500) return rows;
    }
  }
  function metrics(rows) {
    const done=rows.filter(r=>r.finished_at), n=done.length;
    const total=done.reduce((s,r)=>s+r.total_questions,0), correct=done.reduce((s,r)=>s+r.correct_answers,0);
    return {tests:n,total,correct,wrong:total-correct,accuracy:total?+(100*correct/total).toFixed(2):0,
      average:n?+(done.reduce((s,r)=>s+Number(r.score_percent),0)/n).toFixed(2):0,
      best:n?Math.max(...done.map(r=>Number(r.score_percent))):0,
      duration:n?Math.round(done.reduce((s,r)=>s+r.duration_seconds,0)/n):0,
      last:done.map(r=>r.finished_at).sort().at(-1)||'—'};
  }
  function metricCards(rows) {
    const m=metrics(rows);
    return '<div class="summary-grid">'+Object.entries(m).map(([k,v])=>`<div class="metric"><strong>${escapeHtml(v)}</strong><span>${escapeHtml(k)}</span></div>`).join('')+'</div>';
  }
  function cloudPage(title,inner) {
    $app.innerHTML=shell(`<main class="page"><section class="panel"><h1>${escapeHtml(title)}</h1>${inner}</section></main>`); bindGlobal();
  }
  async function renderHistory(owner=userId) {
    cloudPage('History','Loading…');
    try {
      const rows=await allRows('exam_attempts',q=>q.eq('user_id',owner).order('started_at',{ascending:false}).order('id'));
      if(state.view!=='history'&&state.view!=='admin')return;
      cloudPage('History',rows.map(r=>`<button class="button history-row" data-attempt="${r.id}">${escapeHtml(bankMap.get(r.bank_id)?.product || r.bank_id)} · ${new Date(r.started_at).toLocaleString()} · ${r.total_questions} questions · ${r.finished_at ? `${r.correct_answers} correct · ${r.score_percent}% · ${Math.round(r.duration_seconds/60)} min` : 'Resume Exam'}</button>`).join('')||'No attempts yet.');
      document.querySelectorAll('[data-attempt]').forEach(b=>b.onclick=()=>{
        const row=rows.find(r=>r.id===b.dataset.attempt);
        if(!row.finished_at && owner!==userId){alert('This attempt is still in progress.');return;}
        state.activeBankId=row.bank_id;bs().exam={...row.snapshot,finished:Boolean(row.finished_at)};
        state.view=row.finished_at?'result':'exam';render();
      });
    } catch(e){cloudPage('History',escapeHtml(e.message));}
  }
  async function renderCloudStats() {
    cloudPage('Statistics','Loading…');
    try {
      const rows=await allRows('exam_attempts',q=>q.eq('user_id',userId).order('id'));
      if(state.view!=='stats')return;
      cloudPage('Statistics',metricCards(rows)+banks.map(b=>`<h2>${escapeHtml(b.product)}</h2>${metricCards(rows.filter(r=>r.bank_id===b.id))}`).join(''));
    }catch(e){cloudPage('Statistics',escapeHtml(e.message));}
  }
  async function renderProfile() {
    const p=window.SLATE_AUTH.profile;
    cloudPage('Profile',Object.entries({email:p.email,name:p.display_name,role:p.role,created:p.created_at,last_activity:p.last_seen_at}).map(([k,v])=>`<p>${escapeHtml(k)}: ${escapeHtml(v)}</p>`).join(''));
    try{const rows=await allRows('exam_attempts',q=>q.eq('user_id',userId).order('id'));if(state.view==='profile'){$app.querySelector('.panel').insertAdjacentHTML('beforeend',metricCards(rows));}}catch(e){alert(e.message);}
  }
  async function renderAdmin() {
    if(window.SLATE_AUTH.profile.role!=='admin'){cloudPage('Admin','Access denied');return;}
    cloudPage('Admin','Loading…');
    try{
      const profiles=await allRows('profiles',q=>q.order('id'));
      const rows=await allRows('exam_attempts',q=>q.order('id'));
      if(state.view!=='admin')return;
      cloudPage('Admin',`<p>Total users: ${profiles.length} · Active users: ${profiles.filter(p=>p.active).length}</p>`+metricCards(rows)+profiles.map(p=>{
        const m=metrics(rows.filter(r=>r.user_id===p.id));return `<button class="button history-row" data-user="${p.id}">${escapeHtml(p.display_name||p.email)} · Tests ${m.tests} · Questions ${m.total} · Accuracy ${m.accuracy}% · Average ${m.average}% · Best ${m.best}% · Last ${escapeHtml(m.last)}</button>`;
      }).join(''));
      document.querySelectorAll('[data-user]').forEach(b=>b.onclick=()=>{
        const p=profiles.find(p=>p.id===b.dataset.user);
        cloudPage('User details',`<h2>${escapeHtml(p.display_name||p.email)}</h2><p>Email: ${escapeHtml(p.email)}</p><p>Role: ${escapeHtml(p.role)} · Active: ${p.active}</p><p>Created: ${escapeHtml(p.created_at)}</p><p>Last activity: ${escapeHtml(p.last_seen_at||'—')}</p>${metricCards(rows.filter(r=>r.user_id===p.id))}<button class="button" id="userHistory">Exam history</button>`);
        document.getElementById('userHistory').onclick=()=>renderHistory(p.id);
      });
    }catch(e){cloudPage('Admin',escapeHtml(e.message));}
  }

  function recordAttempt(id, ok) {
    const local = bs();
    const attempt = local.statistics.attempts[id] || { attempts: 0, correct: 0, wrong: 0, lastAt: null };
    attempt.attempts += 1;
    if (ok) attempt.correct += 1;
    else attempt.wrong += 1;
    attempt.lastAt = new Date().toISOString();
    local.statistics.attempts[id] = attempt;
  }

  function summaryStats() {
    const exams = bs().statistics.exams || [];
    return {
      count: exams.length,
      best: exams.length ? Math.max(...exams.map(item => item.score)) : 0,
      avg: exams.length ? Math.round(exams.reduce((sum, item) => sum + item.score, 0) / exams.length) : 0,
      last: exams.length ? exams[exams.length - 1].score : 0,
    };
  }

  function renderStats() {
    const local = bs();
    const summary = summaryStats();
    const attempts = Object.entries(local.statistics.attempts || {})
      .map(([id, attempt]) => ({ id: Number(id), ...attempt, accuracy: pct(attempt.correct, attempt.attempts) }))
      .sort((left, right) => right.wrong - left.wrong || left.accuracy - right.accuracy);

    $app.innerHTML = shell(`<main class="page"><button class="button" data-home>← Головна</button><section class="panel" style="margin-top:14px"><span class="eyebrow">${escapeHtml(bank().title)} · Learning analytics</span><h1 style="font-size:30px">Статистика</h1><div class="summary-grid"><div class="metric"><strong>${summary.count}</strong><span>екзаменів</span></div><div class="metric"><strong>${summary.avg}%</strong><span>середній бал</span></div><div class="metric"><strong>${summary.best}%</strong><span>кращий бал</span></div><div class="metric"><strong>${local.statistics.studyChecks}</strong><span>Study checks</span></div></div><h2>Останні екзамени</h2>${local.statistics.exams.length ? `<table class="table"><thead><tr><th>Дата</th><th>Score</th><th>Correct</th><th>Total</th></tr></thead><tbody>${[...local.statistics.exams].reverse().slice(0, 10).map(item => `<tr><td>${new Date(item.finishedAt).toLocaleString()}</td><td><b>${item.score}%</b></td><td>${item.correct}</td><td>${item.total}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Ще немає завершених екзаменів.</div>'}<h2 style="margin-top:26px">Проблемні питання</h2><div class="mistake-list">${attempts.filter(item => item.wrong > 0).slice(0, 20).map(item => `<div class="mistake"><div><b>#${item.id}</b> · ${item.wrong} помилок · ${item.accuracy}% accuracy</div><button class="button" data-study-mistake="${item.id}">Вивчити</button></div>`).join('') || '<div class="empty">Помилок поки немає.</div>'}</div></section></main>`);
    document.querySelectorAll('[data-study-mistake]').forEach(button => {
      button.onclick = () => {
        local.studyId = Number(button.dataset.studyMistake);
        local.filter = 'all';
        local.search = '';
        state.view = 'study';
        save();
        render();
      };
    });
  }

  function shuffleArray(values) {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const other = Math.floor(Math.random() * (index + 1));
      [values[index], values[other]] = [values[other], values[index]];
    }
    return values;
  }

  db.from('profiles').update({last_seen_at:new Date().toISOString()}).eq('id',userId).then(()=>{});
  render();
})();
