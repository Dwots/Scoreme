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
    const cls = (progress.status === 'passed' || progress.status === 'completed' || progress.success === 'passed')
      ? 'is-ok'
      : (progress.status === 'failed' || progress.success === 'failed')
        ? 'is-bad'
        : '';
    const score = progress.score ? ` · ${progress.score}` : '';
    return `<span class="badge ${cls}">${label || 'В процессе'}${score}</span>`;
  }

  function renderCourses(list) {
    coursesGrid.innerHTML = '';
    if (!list.length) {
      coursesGrid.appendChild(emptyState);
      return;
    }
    for (const c of list) {
      const card = document.createElement('div');
      card.className = 'course-card';
      card.innerHTML = `
        <div class="course-title"></div>
        <div class="course-meta">SCORM ${c.scorm_version} · ${fmtDate(c.uploaded_at)} ${statusBadge(c.progress)}</div>
        <div class="course-actions">
          <a class="primary" href="/player.html?id=${encodeURIComponent(c.id)}">Запустить</a>
          <a href="/api/courses/${encodeURIComponent(c.id)}/download">Скачать</a>
          <button class="danger" data-delete="${c.id}">Удалить</button>
        </div>
      `;
      card.querySelector('.course-title').textContent = c.title;
      coursesGrid.appendChild(card);
    }
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
      loadCourses();
    } catch (_) { /* redirect handled */ }
  }

  coursesGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const id = btn.getAttribute('data-delete');
    if (!confirm('Удалить курс?')) return;
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

  themeToggle.addEventListener('click', () => {
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    themeToggle.textContent = next === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    location.href = '/';
  });

  (async function init() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) { location.href = '/'; return; }
      const me = await res.json();
      userEmail.textContent = me.email;
      loadCourses();
    } catch (_) {
      location.href = '/';
    }
  })();
})();
