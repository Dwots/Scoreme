(function () {
  // ── Берём ссылки на элементы один раз ──
  const html        = document.documentElement;
  const card        = document.getElementById('authCard');
  const stage       = document.querySelector('.auth-stage');
  const sweep       = document.getElementById('sweep');
  const tabLogin    = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const title       = document.getElementById('authTitle');
  const submitBtn   = document.getElementById('submitBtn');
  const themeToggle = document.getElementById('themeToggle');
  const form        = document.getElementById('authForm');

  // ── Настраиваемые «ручки». Покрутишь под себя позже. ──
  const FAST_THRESHOLD = 300;  // мс между кликами => включаем быстрый режим
  const DUR_NORMAL     = 650;  // мс — обычный «парадный» блик
  const DUR_FAST       = 240;  // мс — ускоренный блик при частых кликах
  const DUR_REDUCED    = 150;  // мс — затухание для reduced-motion

  const reducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Состояние ──
  let mode      = 'login';  // текущий режим
  let lastClick = 0;        // время предыдущего клика
  let sweepAnim = null;     // ссылка на текущую анимацию блика
  let swapTimer = null;     // ссылка на таймер подмены контента

  // Меняет видимый контент: заголовок, кнопку, активную вкладку, поля.
  function applyContent(targetMode) {
    const isReg = targetMode === 'register';
    card.setAttribute('data-mode', targetMode);
    title.textContent     = isReg ? 'Создать аккаунт'   : 'С возвращением';
    submitBtn.textContent = isReg ? 'Зарегистрироваться' : 'Войти';
    tabLogin.classList.toggle('is-active', !isReg);
    tabRegister.classList.toggle('is-active', isReg);
    tabLogin.setAttribute('aria-selected', String(!isReg));
    tabRegister.setAttribute('aria-selected', String(isReg));
  }

  // Подмена контента + плавная анимация высоты формы.
  function swapWithHeight(targetMode) {
    const from = form.offsetHeight;
    applyContent(targetMode);
    form.style.height = 'auto';
    const to = form.offsetHeight;
    form.style.height = from + 'px';
    requestAnimationFrame(() => {
      form.style.height = to + 'px';
    });
  }

  form.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'height') form.style.height = '';
  });

  // Главная функция: переключение режима с бликом.
  function switchTo(targetMode) {
    if (targetMode === mode) return;

    if (sweepAnim) { sweepAnim.cancel(); sweepAnim = null; }
    if (swapTimer) { clearTimeout(swapTimer); swapTimer = null; }

    const now  = performance.now();
    const fast = (now - lastClick) < FAST_THRESHOLD;
    lastClick  = now;

    if (reducedMotion) {
      stage.classList.add('swapping');
      swapTimer = setTimeout(() => {
        applyContent(targetMode);
        stage.classList.remove('swapping');
      }, DUR_REDUCED / 2);
      mode = targetMode;
      return;
    }

    const duration   = fast ? DUR_FAST : DUR_NORMAL;
    const toRegister = targetMode === 'register';

    const leftPos  = 'translate(-110%, 70%) rotate(-18deg)';
    const rightPos = 'translate(110%, -70%) rotate(-18deg)';
    const start = toRegister ? leftPos  : rightPos;
    const end   = toRegister ? rightPos : leftPos;

    sweepAnim = sweep.animate(
      [
        { transform: start, opacity: 0 },
        { opacity: 1, offset: 0.18 },
        { opacity: 1, offset: 0.82 },
        { transform: end, opacity: 0 }
      ],
      { duration: duration, easing: 'ease-in-out' }
    );

    swapTimer = setTimeout(() => swapWithHeight(targetMode), duration / 2);

    sweepAnim.onfinish = () => { sweepAnim = null; };
    mode = targetMode;
  }

  // ── Слушатели вкладок ──
  tabLogin.addEventListener('click',    () => switchTo('login'));
  tabRegister.addEventListener('click', () => switchTo('register'));

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

  // ── Отправка формы на /api/auth/{login,register} ──
  const errorBox      = document.getElementById('authError');
  const emailInput    = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const confirmInput  = document.getElementById('confirmPassword');
  const firstNameInput = document.getElementById('firstName');
  const lastNameInput  = document.getElementById('lastName');

  function showError(msg) { errorBox.textContent = msg || ''; }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');

    const email    = (emailInput.value || '').trim();
    const password = passwordInput.value || '';
    if (!email || !password) { showError('Введите email и пароль'); return; }
    if (mode === 'register') {
      if (password.length < 6) { showError('Пароль не короче 6 символов'); return; }
      if (password !== (confirmInput.value || '')) { showError('Пароли не совпадают'); return; }
    }

    // Тело запроса. При регистрации передаём имя и фамилию — сервер их сохраняет.
    const payload = { email, password };
    if (mode === 'register') {
      payload.firstName = (firstNameInput.value || '').trim();
      payload.lastName  = (lastNameInput.value  || '').trim();
    }

    submitBtn.disabled = true;
    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showError(body.error || 'Ошибка'); return; }
      location.href = '/courses.html';
    } catch (err) {
      showError('Сеть недоступна');
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ── Если уже залогинены — сразу на /courses.html ──
  fetch('/api/auth/me', { credentials: 'include' })
    .then((r) => { if (r.ok) location.href = '/courses.html'; })
    .catch(() => { /* offline — остаёмся на форме */ });
})();
