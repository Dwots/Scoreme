(function () {
  const html         = document.documentElement;
  const userEmail    = document.getElementById('userEmail');
  const themeToggle  = document.getElementById('themeToggle');
  const logoutBtn    = document.getElementById('logoutBtn');
  const uploadZone   = document.getElementById('uploadZone');
  const fileInput    = document.getElementById('fileInput');
  const uploadStatus = document.getElementById('uploadStatus');
  const coursesGrid  = document.getElementById('coursesGrid');
  const emptyState   = document.getElementById('emptyState');
  const coursesCount = document.getElementById('coursesCount');

  function setStatus(text, isError) {
    uploadStatus.textContent = text || '';
    uploadStatus.classList.toggle('is-error', !!isError);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  async function api(url, options) {
    const res = await fetch(url, Object.assign({ credentials: 'include' }, options || {}));
    if (res.status === 401) { location.href = '/'; throw new Error('unauthorized'); }
    return res;
  }

  const STATUS_LABEL = {
    passed: 'Пройден',
    failed: 'Не пройден',
    completed: 'Завершён',
    incomplete: 'Не завершён',
    'not attempted': 'Не начат',
    unknown: 'Неизвестно',
  };

  function statusBadge(progress) {
    if (!progress) return '';
    const label = STATUS_LABEL[progress.status] || STATUS_LABEL[progress.success] || null;
    if (!label && !progress.score) return '';
    const ok = progress.status === 'passed' || progress.status === 'completed' || progress.success === 'passed';
    const bad = progress.status === 'failed' || progress.success === 'failed';
    const cls = ok ? 'is-ok' : bad ? 'is-bad' : 'is-muted';
    const icon = ok ? '<i class="ti ti-check" aria-hidden="true"></i>' : bad ? '<i class="ti ti-x" aria-hidden="true"></i>' : '';
    return `<span class="badge ${cls}">${icon}${label || 'В процессе'}</span>`;
  }

  // Порог прохождения, заданный автором курса (если он есть в манифесте).
  function passingLine(c) {
    if (c.passing_score == null) return '';
    return `<div class="course-pass"><i class="ti ti-target" aria-hidden="true"></i> Для прохождения нужно ${Math.round(c.passing_score)}%</div>`;
  }

  function progressBar(progress) {
    if (!progress || progress.percent == null) return '';
    const pct = Math.max(0, Math.min(100, progress.percent));
    const ok  = progress.status === 'passed' || progress.status === 'completed' || progress.success === 'passed';
    const bad = progress.status === 'failed' || progress.success === 'failed';
    const cls = ok ? 'is-ok' : bad ? 'is-bad' : '';
    return `
      <div class="course-progress" title="Прохождение: ${pct}%">
        <div class="course-progress-track">
          <div class="course-progress-fill ${cls}" style="width:${pct}%"></div>
        </div>
        <span class="course-progress-label">${pct}%</span>
      </div>`;
  }

  function buildCard(c) {
    const dateHtml = c.uploaded_at
      ? `<div class="course-date"><i class="ti ti-clock" aria-hidden="true"></i> ${fmtDate(c.uploaded_at)}</div>`
      : '';
    const card = document.createElement('div');
    card.className = 'course-card';
    card.innerHTML = `
      <div class="course-head">
        <span class="course-icon"><i class="ti ti-book-2" aria-hidden="true"></i></span>
        <div class="course-title"></div>
      </div>
      <div class="course-badges">
        <span class="badge">SCORM ${c.scorm_version}</span>
        ${statusBadge(c.progress)}
      </div>
      ${progressBar(c.progress)}
      ${passingLine(c)}
      ${dateHtml}
      <div class="course-actions">
        <a class="btn btn-primary" href="/player.html?id=${encodeURIComponent(c.id)}"><i class="ti ti-player-play" aria-hidden="true"></i> Запустить</a>
        <a class="icon-btn" href="/api/courses/${encodeURIComponent(c.id)}/download" aria-label="Скачать" title="Скачать"><i class="ti ti-download" aria-hidden="true"></i></a>
        <button class="icon-btn icon-btn-danger" data-delete="${c.id}" aria-label="Удалить" title="Удалить"><i class="ti ti-trash" aria-hidden="true"></i></button>
      </div>
    `;
    card.querySelector('.course-title').textContent = c.title;
    return card;
  }

  function renderCourses(list) {
    coursesGrid.innerHTML = '';
    coursesCount.textContent = list.length ? String(list.length) : '';
    if (!list.length) {
      coursesGrid.appendChild(emptyState);
      return;
    }
    for (const c of list) coursesGrid.appendChild(buildCard(c));
  }

  // Мгновенно добавляет карточку нового курса наверх, не дожидаясь
  // повторного запроса списка с сервера.
  function prependCourse(c) {
    if (emptyState.parentNode === coursesGrid) coursesGrid.removeChild(emptyState);
    coursesGrid.insertBefore(buildCard(c), coursesGrid.firstChild);
    coursesCount.textContent = String(coursesGrid.querySelectorAll('.course-card').length);
  }

  async function loadCourses() {
    try {
      const res = await api('/api/courses');
      const list = await res.json();
      renderCourses(list);
    } catch (_) { /* redirect handled */ }
  }

  async function uploadFile(file) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      setStatus('Нужен .zip', true);
      return;
    }
    setStatus(`Загрузка «${file.name}»…`);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api('/api/courses', { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setStatus(body.error || 'Ошибка загрузки', true); return; }
      setStatus(`Курс «${body.title}» добавлен`);
      // Ответ содержит все данные курса — рисуем карточку сразу,
      // без повторного запроса списка. uploaded_at — в формате сервера (UTC).
      body.uploaded_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
      prependCourse(body);
    } catch (_) { /* redirect handled */ }
  }

  // ── Кастомное окно подтверждения (Promise<boolean>) ──
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmText    = document.getElementById('confirmText');
  const confirmOk      = document.getElementById('confirmOk');
  const confirmCancel  = document.getElementById('confirmCancel');

  function askConfirm(message) {
    return new Promise((resolve) => {
      if (message) confirmText.textContent = message;
      confirmOverlay.hidden = false;
      confirmOk.focus();
      function cleanup(result) {
        confirmOverlay.hidden = true;
        confirmOk.removeEventListener('click', onOk);
        confirmCancel.removeEventListener('click', onCancel);
        confirmOverlay.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onOk()       { cleanup(true); }
      function onCancel()   { cleanup(false); }
      function onBackdrop(e){ if (e.target === confirmOverlay) cleanup(false); }
      function onKey(e)     { if (e.key === 'Escape') cleanup(false); }
      confirmOk.addEventListener('click', onOk);
      confirmCancel.addEventListener('click', onCancel);
      confirmOverlay.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
    });
  }

  coursesGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const id = btn.getAttribute('data-delete');
    if (!(await askConfirm('Курс будет удалён без возможности восстановления.'))) return;
    try {
      const res = await api('/api/courses/' + encodeURIComponent(id), { method: 'DELETE' });
      if (res.ok) loadCourses();
      else setStatus('Не удалось удалить', true);
    } catch (_) { /* redirect handled */ }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) uploadFile(fileInput.files[0]);
    fileInput.value = '';
  });
  uploadZone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'INPUT') fileInput.click();
  });
  ['dragenter', 'dragover'].forEach((evt) =>
    uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadZone.classList.add('is-drag');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadZone.classList.remove('is-drag');
    })
  );
  uploadZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });

  // ── Тема: переключение + запоминание в localStorage + иконка ──
  function syncThemeIcon() {
    const dark = html.getAttribute('data-theme') === 'dark';
    themeToggle.innerHTML = dark ? '<i class="ti ti-sun"></i>' : '<i class="ti ti-moon"></i>';
    themeToggle.setAttribute('aria-label', dark ? 'Светлая тема' : 'Тёмная тема');
  }
  themeToggle.addEventListener('click', () => {
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    try { localStorage.setItem('scoreme-theme', next); } catch (_) {}
    syncThemeIcon();
  });
  syncThemeIcon();

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    location.href = '/';
  });

  (async function init() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) { location.href = '/'; return; }
      const me = await res.json();
      const name = [me.firstName, me.lastName].filter(Boolean).join(' ');
      userEmail.textContent = name ? `${name} · ${me.email}` : me.email;
      loadCourses();
    } catch (_) {
      location.href = '/';
    }
  })();
})();
