(function () {
  const params = new URLSearchParams(location.search);
  const courseId = params.get('id');

  let cmi = {};
  let initialized = false;
  let lastError = '0';
  let pendingSave = null;

  function getValue(key) {
    return cmi[key] !== undefined && cmi[key] !== null ? String(cmi[key]) : '';
  }
  function setValue(key, value) {
    cmi[key] = String(value);
    scheduleSave();
    return 'true';
  }
  function scheduleSave() {
    if (pendingSave) return;
    pendingSave = setTimeout(() => { pendingSave = null; saveNow(); }, 1500);
  }
  function saveNow() {
    if (pendingSave) { clearTimeout(pendingSave); pendingSave = null; }
    if (!courseId) return;
    return fetch('/api/scorm/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ courseId, data: cmi }),
    }).catch(() => {});
  }

  async function handleFinish() {
    initialized = false;
    try { await saveNow(); } catch (_) {}
    showCompletionOverlay();
  }

  // SCORM 1.2 — course looks for window.API
  window.API = {
    LMSInitialize:     () => { initialized = true; lastError = '0'; return 'true'; },
    LMSFinish:         () => { lastError = '0'; handleFinish(); return 'true'; },
    LMSGetValue:       (k) => { lastError = '0'; return getValue(k); },
    LMSSetValue:       (k, v) => { lastError = '0'; return setValue(k, v); },
    LMSCommit:         () => { lastError = '0'; saveNow(); return 'true'; },
    LMSGetLastError:   () => lastError,
    LMSGetErrorString: () => '',
    LMSGetDiagnostic:  () => '',
  };

  // SCORM 2004 — course looks for window.API_1484_11
  window.API_1484_11 = {
    Initialize:      () => { initialized = true; lastError = '0'; return 'true'; },
    Terminate:       () => { lastError = '0'; handleFinish(); return 'true'; },
    GetValue:        (k) => { lastError = '0'; return getValue(k); },
    SetValue:        (k, v) => { lastError = '0'; return setValue(k, v); },
    Commit:          () => { lastError = '0'; saveNow(); return 'true'; },
    GetLastError:    () => lastError,
    GetErrorString:  () => '',
    GetDiagnostic:   () => '',
  };

  // Браузер игнорирует window.close() из iframe — перехватываем, чтобы курс
  // мог сообщить «я закончил» обычным способом.
  function installFrameCloseShim(frame) {
    try {
      const w = frame.contentWindow;
      if (!w) return;
      w.close = () => handleFinish();
    } catch (_) { /* cross-origin не может случиться, но на всякий случай */ }
  }

  function showCompletionOverlay() {
    const existing = document.getElementById('completionOverlay');
    if (existing) return;

    const status = cmi['cmi.completion_status'] || cmi['cmi.core.lesson_status'] || '';
    const success = cmi['cmi.success_status'] || '';
    const rawScore = cmi['cmi.score.raw'] || cmi['cmi.core.score.raw'] || '';
    const maxScore = cmi['cmi.score.max'] || cmi['cmi.core.score.max'] || '';

    const labelMap = {
      passed: 'Пройден',
      failed: 'Не пройден',
      completed: 'Завершён',
      incomplete: 'Не завершён',
      'not attempted': 'Не начат',
      unknown: 'Статус неизвестен',
    };
    const verdict = labelMap[status] || labelMap[success] || 'Курс завершён';
    const scoreLine = rawScore
      ? `Результат: ${rawScore}${maxScore ? ' / ' + maxScore : ''}`
      : '';

    const div = document.createElement('div');
    div.id = 'completionOverlay';
    div.className = 'completion-overlay';
    div.innerHTML = `
      <div class="completion-card">
        <div class="completion-verdict"></div>
        <div class="completion-score"></div>
        <button class="submit-btn" id="completionBack">К моим курсам</button>
      </div>
    `;
    div.querySelector('.completion-verdict').textContent = verdict;
    div.querySelector('.completion-score').textContent = scoreLine;
    document.body.appendChild(div);
    document.getElementById('completionBack').addEventListener('click', () => {
      location.href = '/courses.html';
    });
  }

  window.addEventListener('beforeunload', () => {
    if (!courseId || !Object.keys(cmi).length) return;
    const blob = new Blob([JSON.stringify({ courseId, data: cmi })], { type: 'application/json' });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/scorm/state', blob);
  });

  document.addEventListener('DOMContentLoaded', async () => {
    const titleEl = document.getElementById('playerTitle');
    const frame   = document.getElementById('playerFrame');

    if (!courseId) { titleEl.textContent = 'Не указан id курса'; return; }

    try {
      const meRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (!meRes.ok) { location.href = '/'; return; }
    } catch (_) { location.href = '/'; return; }

    let course;
    try {
      const r = await fetch('/api/courses/' + encodeURIComponent(courseId), { credentials: 'include' });
      if (!r.ok) {
        titleEl.textContent = r.status === 403 ? 'Нет доступа к курсу' : 'Курс не найден';
        return;
      }
      course = await r.json();
    } catch (_) { titleEl.textContent = 'Ошибка сети'; return; }

    titleEl.textContent = course.title;

    try {
      const r = await fetch('/api/scorm/state?courseId=' + encodeURIComponent(courseId), { credentials: 'include' });
      if (r.ok) {
        const body = await r.json();
        cmi = (body && body.data) || {};
      }
    } catch (_) { /* нет состояния — стартуем с пустого */ }

    frame.addEventListener('load', () => installFrameCloseShim(frame));
    frame.src = '/content/' + encodeURIComponent(courseId) + '/' + course.entry_point;
  });
})();
