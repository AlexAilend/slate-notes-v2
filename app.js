(() => {
  'use strict';

  const banks = Array.isArray(window.SLATE_BANKS) ? window.SLATE_BANKS : [];
  if (!banks.length) throw new Error('Question banks not loaded');

  const bankMap = new Map(banks.map(bank => [bank.id, bank]));
  const STORAGE_KEY = 'slate-combined-v1';
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
    return new Map(questions().map(question => [question.id, question]));
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
        <div class="top-actions">
          <span class="pill">${escapeHtml(current.product)}</span>
          <span class="muted">${current.questionCount} питань</span>
        </div>
      </header>
      ${inner}
      <footer class="footer">Slate Combined · FortiOS 7.6 Administrator + FortiSIEM Practice Exam · прогрес зберігається локально у браузері.</footer>
    </div>`;
  }

  function render() {
    if (state.view === 'home') renderHome();
    else if (state.view === 'study') renderStudy();
    else if (state.view === 'examSetup') renderExamSetup();
    else if (state.view === 'exam') renderExam();
    else if (state.view === 'result') renderResult();
    else if (state.view === 'stats') renderStats();
    bindGlobal();
  }

  function bindGlobal() {
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
        <button class="button" id="studyShuffle">Випадкове</button>
      </div>
      <div class="workspace">
        <aside class="side-card"><h3>${escapeHtml(bank().product)} · ${filtered.length}</h3><div class="question-grid">${filtered.map(studyDot).join('')}</div><div class="side-stats">Study checks: ${local.statistics.studyChecks}<br>Правильно: ${local.statistics.studyCorrect}<br>Accuracy: ${pct(local.statistics.studyCorrect, local.statistics.studyChecks)}%</div></aside>
        <section>${questionCard(q, selected, checked, 'study')}${checked ? `<div class="feedback ${correct ? 'ok' : 'bad'}">${correct ? '✓ Правильно' : '✕ Неправильно'}${!correct ? `. Правильна відповідь: <b>${q.answer.join(', ')}</b>` : ''}</div>` : ''}<div class="actions">${!checked ? `<button class="button primary" id="checkStudy" ${!complete(q, selected) ? 'disabled' : ''}>Перевірити</button>` : '<button class="button primary" id="nextStudy">Наступне питання →</button>'}<span class="answer-requirement">Потрібно вибрати: <b>${q.correctCount}</b></span></div><div class="nav-row"><button class="button" id="prevStudy">← Попереднє</button><button class="button" id="nextStudyNav" ${!checked ? 'disabled' : ''}>Далі →</button></div></section>
      </div>
    </main>`);

    bindQuestionOptions(q, 'study', checked);
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

  function questionCard(q, selected, checked, mode) {
    return `<article class="question-card">
      <div class="question-top"><span>${escapeHtml(bank().product)} · Question ${q.id} of ${questions().length}</span><span>${isOrdering(q) ? 'Arrange in order' : q.correctCount === 1 ? 'Single answer' : `Choose ${q.correctCount}`}</span></div>
      <h2 class="question-text">${escapeHtml(q.text)}</h2>
      ${q.note ? `<div class="exhibit-note">${escapeHtml(q.note)}</div>` : ''}
      ${q.image ? `<div class="exhibit"><img src="${escapeHtml(q.image)}" data-zoom alt="Exhibit for question ${q.id}"></div>` : ''}
      <div class="instruction">${isOrdering(q) ? 'Розташуй критерії по порядку. Кожен використай один раз.' : `Вибери рівно ${q.correctCount} ${q.correctCount === 1 ? 'відповідь' : 'відповіді'}`}</div>
      <div class="options">${isOrdering(q) ? orderingHtml(q, selected, checked) : Object.entries(q.options).map(([key, value]) => optionHtml(q, key, value, selected, checked, mode)).join('')}</div>
    </article>`;
  }

  function optionHtml(q, key, value, selected, checked) {
    const isSelected = selected.includes(key);
    const isRight = q.answer.includes(key);
    let className = isSelected ? 'selected' : '';
    if (checked) {
      if (isRight) className += ' correct';
      else if (isSelected) className += ' wrong';
    }
    return `<label class="option ${className}"><input type="checkbox" value="${escapeHtml(key)}" ${isSelected ? 'checked' : ''} ${checked ? 'disabled' : ''}><span class="letter">${escapeHtml(key)}</span><span>${escapeHtml(value)}</span></label>`;
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
    if (!choices.includes(local.examSize)) local.examSize = Math.min(20, total);

    $app.innerHTML = shell(`<main class="page"><div class="exam-setup"><button class="button" data-home>← Головна</button><section class="panel" style="margin-top:14px"><span class="eyebrow">${escapeHtml(bank().title)}</span><h1 style="font-size:30px">Налаштування екзамену</h1><p class="muted">Питання перемішуються. Поки не вибрано рівно потрібну кількість відповідей, перейти далі не можна.</p><div class="choice-grid">${choices.map(count => `<button class="count-choice ${local.examSize === count ? 'active' : ''}" data-count="${count}">${count === total ? `Full ${total}` : count}</button>`).join('')}</div><label><input type="checkbox" id="shuffleExam" checked> Перемішати питання</label><button class="button primary wide" id="startExam" style="margin-top:20px">Почати екзамен</button></section></div></main>`);
    document.querySelectorAll('[data-count]').forEach(button => {
      button.onclick = () => {
        local.examSize = Number(button.dataset.count);
        save();
        render();
      };
    });
    document.getElementById('startExam').onclick = () => startExam(document.getElementById('shuffleExam').checked);
  }

  function startExam(shuffle) {
    const local = bs();
    let ids = questions().map(question => question.id);
    if (shuffle) shuffleArray(ids);
    ids = ids.slice(0, local.examSize);
    local.exam = { ids, index: 0, answers: {}, startedAt: new Date().toISOString(), finished: false, result: null };
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

    $app.innerHTML = shell(`<main class="page"><div class="workspace"><aside class="side-card"><h3>${escapeHtml(bank().product)} Exam</h3><div class="question-grid">${ex.ids.map((questionId, index) => `<button class="qdot ${index === ex.index ? 'current' : ''} ${complete(map.get(questionId), ex.answers[questionId] || []) ? 'answered' : ''}" data-eidx="${index}">${index + 1}</button>`).join('')}</div><div class="side-stats">Відповіли: ${ex.ids.filter(questionId => complete(map.get(questionId), ex.answers[questionId] || [])).length}/${ex.ids.length}<br>Правильність прихована до Finish.</div></aside><section><div class="exam-progress"><span style="width:${pct(ex.index + 1, ex.ids.length)}%"></span></div>${questionCard(q, selected, false, 'exam')}<div class="actions"><span class="answer-requirement">Потрібно вибрати: <b>${q.correctCount}</b></span></div><div class="nav-row"><button class="button" id="examPrev" ${ex.index === 0 ? 'disabled' : ''}>← Попереднє</button>${ex.index === ex.ids.length - 1 ? `<button class="button primary" id="finishExam" ${!canNext ? 'disabled' : ''}>Завершити екзамен</button>` : `<button class="button primary" id="examNext" ${!canNext ? 'disabled' : ''}>Далі →</button>`}</div></section></div></main>`);

    bindQuestionOptions(q, 'exam', false);
    document.querySelectorAll('[data-eidx]').forEach(button => {
      button.onclick = () => {
        const target = Number(button.dataset.eidx);
        if (target <= ex.index || complete(q, selected)) {
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
      if (canNext) {
        ex.index += 1;
        save();
        render();
      }
    };
    const finish = document.getElementById('finishExam');
    if (finish) finish.onclick = finishExam;
  }

  function finishExam() {
    const local = bs();
    const ex = local.exam;
    if (!ex) return;
    const map = byId();
    for (const id of ex.ids) {
      if (!complete(map.get(id), ex.answers[id] || [])) {
        alert('Спочатку дай повну відповідь на всі питання.');
        return;
      }
    }
    let correct = 0;
    const review = ex.ids.map(id => {
      const q = map.get(id);
      const selected = ex.answers[id] || [];
      const ok = sameAnswer(q, selected);
      if (ok) correct += 1;
      recordAttempt(id, ok);
      return { id, selected, correct: q.answer, ok };
    });
    const result = {
      correct,
      total: ex.ids.length,
      score: pct(correct, ex.ids.length),
      review,
      finishedAt: new Date().toISOString(),
    };
    ex.finished = true;
    ex.result = result;
    local.statistics.exams.push({
      score: result.score,
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
    const local = bs();
    const ex = local.exam;
    const result = ex?.result;
    if (!result) {
      state.view = 'home';
      return render();
    }
    const map = byId();
    $app.innerHTML = shell(`<main class="page"><section class="panel"><span class="eyebrow">${escapeHtml(bank().title)} · Exam result</span><div class="score-big">${result.score}%</div><div class="summary-grid"><div class="metric"><strong>${result.correct}</strong><span>правильно</span></div><div class="metric"><strong>${result.total - result.correct}</strong><span>помилок</span></div><div class="metric"><strong>${result.total}</strong><span>питань</span></div><div class="metric"><strong>${summaryStats().best}%</strong><span>кращий результат</span></div></div><div class="actions"><button class="button primary" id="retryExam">Новий екзамен</button><button class="button" id="studyMistakes">Вчити помилки</button><button class="button" data-home>На головну</button></div><div class="review-list">${result.review.map(item => { const q = map.get(item.id); return `<div class="review-item ${item.ok ? 'ok' : 'bad'}"><h4>#${item.id} · ${item.ok ? '✓ правильно' : '✕ помилка'}</h4><p>${escapeHtml(q.text)}</p>${!item.ok ? `<p>Твоя: <b>${item.selected.join(', ') || '—'}</b> · Правильна: <b>${item.correct.join(', ')}</b></p>` : ''}</div>`; }).join('')}</div></section></main>`);
    document.getElementById('retryExam').onclick = () => {
      local.exam = null;
      state.view = 'examSetup';
      save();
      render();
    };
    document.getElementById('studyMistakes').onclick = () => {
      local.exam = null;
      local.filter = 'wrong';
      state.view = 'study';
      const first = questions().find(question => local.statistics.attempts?.[question.id]?.wrong > 0);
      if (first) local.studyId = first.id;
      save();
      render();
    };
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

  render();
})();
