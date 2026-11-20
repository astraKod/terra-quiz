/* ─────────────────────────────────────────────
   Терра — атлас-викторина: карты материков,
   случайная подсветка, ответ на 2 секунды,
   страны без повторов до нажатия «Обновить».
   Масштаб: кнопки, колёсико, перетаскивание
   и автоматическое приближение мелких стран.
   ───────────────────────────────────────────── */

(function () {
  'use strict';

  const CONTINENTS = window.CONTINENTS || [];
  const MAPS = window.MAPS || {};
  const byId = new Map(CONTINENTS.map(function (c) { return [c.id, c]; }));
  const byCode = new Map(CONTINENTS.reduce(function (all, c) {
    return all.concat(c.countries.map(function (country) { return [country.code, country]; }));
  }, []));
  const active = CONTINENTS.filter(function (c) { return !!MAPS[c.id]; });
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ZOOM_MAX = 60;
  const AUTO_ZOOM_MAX = 45;
  const AUTO_ZOOM_MIN = 1.4;
  const AUTO_TARGET_SHARE = 0.3;
  const AUTO_MIN_BOX = 8;
  const SETTINGS_KEY = 'terra.quiz.settings.v1';

  const russiaData = byId.get('russia');
  const regionDefaults = {};
  (russiaData && russiaData.regionTypes || []).forEach(function (t) {
    regionDefaults[t.key] = (russiaData.defaultTypes || []).indexOf(t.key) !== -1;
  });

  const DEFAULT_SETTINGS = {
    showCountry: true,
    showCapital: true,
    showFlag: true,
    showBefore: false,
    showHoverName: false,
    showWhere: true,
    showMapLabels: false,
    autoZoom: false,
    smoothZoomOut: false,
    revealTime: 2000,
    ruTypes: regionDefaults,
  };

  /* Поля ответа всегда включены — в настройках их больше нет */
  const ALWAYS_ON_FIELDS = ['showCountry', 'showCapital', 'showFlag', 'showWhere'];

  const SHORT = {
    'europe': 'Европа',
    'asia': 'Азия',
    'russia': 'Россия',
    'africa': 'Африка',
    'north-america': 'Америка',
    'south-america': 'Америка',
    'oceania': 'Океания',
  };

  const els = {
    stars: document.getElementById('stars'),
    shell: document.getElementById('globeShell'),
    canvas: document.getElementById('globe'),
    stage: document.getElementById('globeStage'),
    legend: document.getElementById('legend'),
    tip: document.getElementById('globeTip'),
    tipName: document.getElementById('globeTipName'),
    tipMeta: document.getElementById('globeTipMeta'),

    detail: document.getElementById('detail'),
    detailWord: document.getElementById('detailWord'),
    back: document.getElementById('back'),
    crumbContinent: document.getElementById('crumbContinent'),
    crumbCount: document.getElementById('crumbCount'),
    refresh: document.getElementById('refresh'),

    answerBar: document.getElementById('answerBar'),
    answerLabel: document.getElementById('answerLabel'),
    cardCounter: document.getElementById('cardCounter'),
    answerFlag: document.getElementById('answerFlag'),
    countryName: document.getElementById('countryName'),
    capitalName: document.getElementById('capitalName'),
    answerWhere: document.getElementById('answerWhere'),
    hoverName: document.getElementById('hoverName'),

    map: document.getElementById('map'),
    mapLand: document.getElementById('mapLand'),
    mapMarkers: document.getElementById('mapMarkers'),
    mapLabels: document.getElementById('mapLabels'),
    mapBadgeText: document.getElementById('mapBadgeText'),
    mapFoot: document.getElementById('mapFoot'),
    zoomIn: document.getElementById('zoomIn'),
    zoomOut: document.getElementById('zoomOut'),
    zoomReset: document.getElementById('zoomReset'),
    zoomValue: document.getElementById('zoomValue'),
    zoomMode: document.getElementById('zoomMode'),

    toast: document.getElementById('toast'),
    live: document.getElementById('live'),

    mapsCount: document.getElementById('mapsCount'),
    mapsWord: document.getElementById('mapsWord'),
    countriesCount: document.getElementById('countriesCount'),
    countriesWord: document.getElementById('countriesWord'),
    settingsToggle: document.getElementById('settingsToggle'),
    settingsLink: document.getElementById('settingsLink'),
    settingsPanel: document.getElementById('settingsPanel'),
    settingsClose: document.getElementById('settingsClose'),
    settingsReset: document.getElementById('settingsReset'),
    revealTime: document.getElementById('revealTime'),
  };

  /* ─────────── Утилиты ─────────── */

  function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  function countriesWord(n) {
    return plural(n, 'страна', 'страны', 'стран');
  }

  function regionsWord(n) {
    return plural(n, 'регион', 'региона', 'регионов');
  }

  function unitWord(cont, n) {
    return cont && cont.id === 'russia' ? regionsWord(n) : countriesWord(n);
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function maskFor(value) {
    const n = Math.max(5, Math.min(15, String(value).length));
    return '•'.repeat(n);
  }

  function flagEmoji(code) {
    if (!code || code.length !== 2) return '';
    return String.fromCodePoint.apply(
      null,
      code.toUpperCase().split('').map(function (ch) { return 127397 + ch.charCodeAt(0); })
    );
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function coordText(place) {
    const lat = Math.abs(place.lat).toFixed(1) + '° ' + (place.lat >= 0 ? 'с.ш.' : 'ю.ш.');
    const lng = Math.abs(place.lng).toFixed(1) + '° ' + (place.lng >= 0 ? 'в.д.' : 'з.д.');
    return lat + ', ' + lng;
  }

  /* ─────────── Фон: звёзды ─────────── */

  function drawStars() {
    const canvas = els.stars;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const count = Math.round((w * h) / 5200);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = Math.random() < 0.92 ? Math.random() * 0.9 + 0.25 : Math.random() * 1.5 + 1;
      const a = Math.random() * 0.55 + 0.18;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(214,232,255,' + a.toFixed(3) + ')';
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      if (r > 1.15) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 7);
        glow.addColorStop(0, 'rgba(190,220,255,' + (a * 0.35).toFixed(3) + ')');
        glow.addColorStop(1, 'rgba(190,220,255,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r * 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (let i = 0; i < 5; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h * 0.75;
      ctx.strokeStyle = 'rgba(226,240,255,0.4)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x + 5, y);
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y + 5);
      ctx.stroke();
    }
  }

  /* ─────────── Легенда ─────────── */

  function buildLegend() {
    if (!els.legend) return;
    active.forEach(function (cont) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'legend__item';
      btn.dataset.continent = cont.id;
      btn.style.setProperty('--c', cont.color);
      btn.setAttribute('aria-label', cont.name + ', ' + cont.count + ' ' + unitWord(cont, cont.count) + ' — открыть карту');

      const dot = document.createElement('i');
      dot.setAttribute('aria-hidden', 'true');
      const label = document.createTextNode(cont.name);
      const num = document.createElement('b');
      num.textContent = String(cont.count);

      btn.append(dot, label, num);
      btn.addEventListener('click', function () { openContinent(cont.id); });
      els.legend.append(btn);
    });
  }

  /* ─────────── Подсказка над глобусом ─────────── */

  function showTip(key, clientX, clientY) {
    const cont = byId.get(key);
    if (!cont || !els.tip) return;

    els.tipName.textContent = cont.name;
    els.tipMeta.textContent = cont.count
      ? cont.count + ' ' + unitWord(cont, cont.count)
      : 'полярные станции';

    const stageRect = els.stage.getBoundingClientRect();
    let x = clientX - stageRect.left;
    let y = clientY - stageRect.top;
    x = Math.max(76, Math.min(stageRect.width - 76, x));
    y = Math.max(70, y);
    els.tip.style.left = x + 'px';
    els.tip.style.top = y + 'px';
    els.tip.hidden = false;
  }

  function hideTip() {
    if (els.tip) els.tip.hidden = true;
  }

  /* ─────────── Уведомление ─────────── */

  let toastTimer = 0;

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-visible');
    }, 2600);
  }

  /* ─────────── Состояние викторины ─────────── */

  const state = {
    continent: null,
    used: new Set(),
    country: null,
    revealed: false,
    gen: 0,
    revealTimer: 0,
    advanceTimer: 0,
    paths: {},
    dots: {},
    location: null,
    hoverCode: null,
    label: null,
    labelParts: null,
    labelData: null,
    base: { x: 0, y: 0, w: 1000, h: 700 },
    view: { x: 0, y: 0, w: 1000, h: 700 },
    zoomScale: 1,
    zoomMode: 'full',
    viewAnim: 0,
    dragMoved: false,
    settings: loadSettings(),
  };

  let viewOpen = false;
  let lastFocus = null;
  let settingsOpen = false;
  let settingsOpener = null;

  /* ─────────── Настройки викторины ─────────── */

  function loadSettings() {
    const base = {
      showCountry: DEFAULT_SETTINGS.showCountry,
      showCapital: DEFAULT_SETTINGS.showCapital,
      showFlag: DEFAULT_SETTINGS.showFlag,
      showBefore: DEFAULT_SETTINGS.showBefore,
      showHoverName: DEFAULT_SETTINGS.showHoverName,
      showWhere: DEFAULT_SETTINGS.showWhere,
      showMapLabels: DEFAULT_SETTINGS.showMapLabels,
      autoZoom: DEFAULT_SETTINGS.autoZoom,
      smoothZoomOut: DEFAULT_SETTINGS.smoothZoomOut,
      revealTime: DEFAULT_SETTINGS.revealTime,
      ruTypes: Object.assign({}, DEFAULT_SETTINGS.ruTypes),
    };
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (_) {}
    if (!saved || typeof saved !== 'object') return base;

    Object.keys(base).forEach(function (key) {
      if (key === 'ruTypes') return;
      if (typeof saved[key] === typeof base[key]) base[key] = saved[key];
    });
    ALWAYS_ON_FIELDS.forEach(function (key) { base[key] = true; });
    if ([1500, 2000, 3000, 5000].indexOf(base.revealTime) === -1) base.revealTime = 2000;
    if (saved.ruTypes && typeof saved.ruTypes === 'object') {
      Object.keys(base.ruTypes).forEach(function (key) {
        if (typeof saved.ruTypes[key] === 'boolean') base.ruTypes[key] = saved.ruTypes[key];
      });
    }
    return base;
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (_) {}
  }

  function poolFor(cont) {
    if (!cont) return [];
    if (cont.id !== 'russia') return cont.countries;
    return cont.countries.filter(function (c) { return !!state.settings.ruTypes[c.regionType]; });
  }

  function refreshCounts() {
    let total = 0;
    CONTINENTS.forEach(function (c) {
      c.count = poolFor(c).length;
      if (active.indexOf(c) !== -1) total += c.count;
    });
    if (els.countriesCount) els.countriesCount.textContent = String(total);
    if (els.countriesWord) els.countriesWord.textContent = 'стран и регионов';
    if (els.mapsCount) els.mapsCount.textContent = String(active.length);
    if (els.mapsWord) els.mapsWord.textContent = plural(active.length, 'карта', 'карты', 'карт');

    if (els.legend) {
      Array.prototype.forEach.call(els.legend.children, function (btn) {
        const cont = byId.get(btn.dataset.continent);
        if (!cont) return;
        const num = btn.querySelector('b');
        if (num) num.textContent = String(cont.count);
        btn.setAttribute('aria-label', cont.name + ', ' + cont.count + ' ' + unitWord(cont, cont.count) + ' — открыть карту');
      });
    }
    if (state.continent) {
      els.crumbCount.textContent = state.continent.count + ' ' + unitWord(state.continent, state.continent.count);
      if (state.country) els.cardCounter.textContent = state.used.size + ' / ' + state.continent.count;
    }
  }

  function applySettings() {
    const s = state.settings;
    document.documentElement.style.setProperty('--reveal-time', s.revealTime + 'ms');

    els.answerBar.classList.toggle('hide-country', !s.showCountry);
    els.answerBar.classList.toggle('hide-capital', !s.showCapital);
    els.answerBar.classList.toggle('hide-flag', !s.showFlag);
    els.answerBar.classList.toggle('hide-where', !s.showWhere);
    if (!s.showHoverName) hideHoverName();

    if (els.revealTime) {
      Array.prototype.forEach.call(els.revealTime.querySelectorAll('button'), function (btn) {
        const on = Number(btn.dataset.ms) === s.revealTime;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    refreshCounts();
    renderAllLabels();
    applyPreAnswer();
    if (state.hoverCode && s.showHoverName && !s.showBefore && viewOpen && !state.revealed) {
      const hovered = byCode.get(state.hoverCode);
      if (hovered) setField('country', hovered.name, true);
    }
  }

  /* Короткие подписи: «Тверская область» → «Тверь», «Ростовская область» → «Ростов» */
  function shortCapital(capital) {
    let s = String(capital || '').trim();
    if (s === 'Санкт-Петербург') return 'Петербург';
    if (s === 'Великий Новгород') return 'Новгород';
    if (s === 'Нижний Новгород') return 'Нижний';
    s = s.replace(/-на-[^-\s]+/gi, '').replace(/-Камчатский$/i, '');
    return s.split(/\s+/)[0] || s;
  }

  function shortLabel(country) {
    if (country.regionType) return shortCapital(country.capital);
    const names = {
      'Босния и Герцеговина': 'Босния',
      'Папуа — Новая Гвинея': 'Папуа',
      'Доминиканская Республика': 'Доминикана',
    };
    return names[country.name] || country.name;
  }

  function showHoverName(code) {
    if (!els.hoverName || !state.settings.showHoverName || !viewOpen) return;
    const country = byCode.get(code);
    if (!country) return;

    state.hoverCode = code;
    els.hoverName.textContent = country.name;
    els.hoverName.classList.add('is-visible');

    /* Без «Показывать до ответа» имя под курсором заменяет точки в ответе */
    if (!state.settings.showBefore && !state.revealed && state.country) {
      setField('country', country.name, true);
    }
  }

  function hideHoverName() {
    state.hoverCode = null;
    if (!els.hoverName) return;
    els.hoverName.classList.remove('is-visible');
    els.hoverName.textContent = '';
    if (!state.revealed && state.country) applyPreAnswer();
  }

  /* Подписи всех объектов карты — до ответа, а не только цели после него */
  function renderAllLabels(cont) {
    const current = cont || state.continent;
    els.mapLabels.replaceChildren();
    state.label = null;
    state.labelParts = null;
    state.labelData = null;
    if (!current || !state.settings.showMapLabels) return;
    const s = state.settings;
    if (!s.showCountry && !s.showCapital) return;

    const places = (MAPS[current.id] && MAPS[current.id].places) || {};
    const frag = document.createDocumentFragment();

    poolFor(current).forEach(function (country) {
      const place = places[country.code];
      if (!place) return;

      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', 'map__label map__label--all');
      group.dataset.code = country.code;

      function addText(cls, value, y) {
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('class', cls);
        text.setAttribute('x', place.x);
        text.setAttribute('y', y);
        text.setAttribute('text-anchor', 'middle');
        text.textContent = value;
        group.append(text);
      }

      const name = shortLabel(country);
      const capital = shortCapital(country.capital);

      if (s.showCountry && s.showCapital && name !== capital) {
        addText('map__label-country', name, place.y - 13);
        addText('map__label-capital', capital, place.y + 2);
      } else if (s.showCountry) {
        addText('map__label-country', name, place.y - 6);
      } else {
        addText('map__label-capital', capital, place.y - 6);
      }
      frag.append(group);
    });

    els.mapLabels.append(frag);
  }

  /* «Показывать до ответа» использует уже включённые поля ответа */
  function applyPreAnswer() {
    if (!state.continent || !state.country || state.revealed) return;
    const s = state.settings;
    const country = state.country;
    const preview = !!s.showBefore;

    setField('country', country.name, preview && s.showCountry);
    setField('capital', country.capital, preview && s.showCapital);

    const flag = country.emoji || flagEmoji(country.code) || '★';
    els.answerFlag.textContent = preview && s.showFlag ? flag : '?';
    els.answerFlag.classList.toggle('is-revealed', preview && s.showFlag);
    els.answerWhere.textContent = 'Ответ появится после нажатия на страну';
  }

  function syncSettingsUI() {
    const s = state.settings;
    Array.prototype.forEach.call(document.querySelectorAll('[data-setting]'), function (input) {
      input.checked = !!s[input.dataset.setting];
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-region-type]'), function (input) {
      input.checked = !!s.ruTypes[input.dataset.regionType];
    });
    applySettings();
  }

  function regionTypesChanged() {
    refreshCounts();
    if (state.continent && state.continent.id === 'russia') {
      const codes = new Set(poolFor(state.continent).map(function (c) { return c.code; }));
      Array.from(state.used).forEach(function (code) {
        if (!codes.has(code)) state.used.delete(code);
      });
      if (!state.country || !codes.has(state.country.code)) pickCountry(null);
      else els.cardCounter.textContent = state.used.size + ' / ' + state.continent.count;
    }
  }

  function setSettingsOpen(open, opener) {
    settingsOpen = !!open;
    if (!els.settingsPanel) return;
    if (settingsOpen) settingsOpener = opener || els.settingsToggle;
    els.settingsPanel.hidden = !settingsOpen;
    [els.settingsToggle, els.settingsLink].forEach(function (btn) {
      if (btn) btn.setAttribute('aria-expanded', settingsOpen ? 'true' : 'false');
    });
    if (settingsOpen && els.settingsClose) els.settingsClose.focus({ preventScroll: true });
    else if (!settingsOpen && settingsOpener && settingsOpener.focus) {
      settingsOpener.focus({ preventScroll: true });
      settingsOpener = null;
    }
  }


  function clearTimers() {
    if (state.revealTimer) {
      clearTimeout(state.revealTimer);
      state.revealTimer = 0;
    }
    if (state.advanceTimer) {
      clearTimeout(state.advanceTimer);
      state.advanceTimer = 0;
    }
  }

  function setAccent(hex) {
    const rgb = hexToRgb(hex);
    document.documentElement.style.setProperty('--accent', hex);
    document.documentElement.style.setProperty('--accent-rgb', rgb.join(', '));
  }

  function setField(field, value, revealed) {
    const el = field === 'country' ? els.countryName : els.capitalName;
    el.classList.remove('is-revealed');
    void el.offsetWidth;
    if (revealed) {
      el.textContent = value;
      el.classList.add('is-revealed');
    } else {
      el.innerHTML = '<span class="mask">' + maskFor(value) + '</span>';
    }
  }

  /* ─────────── Масштаб карты ─────────── */

  function parseViewBox(value) {
    const p = String(value || '').trim().split(/[\s,]+/).map(Number);
    return {
      x: Number.isFinite(p[0]) ? p[0] : 0,
      y: Number.isFinite(p[1]) ? p[1] : 0,
      w: Number.isFinite(p[2]) && p[2] > 0 ? p[2] : 1000,
      h: Number.isFinite(p[3]) && p[3] > 0 ? p[3] : 700,
    };
  }

  function clampView(x, y, w, h) {
    const b = state.base;
    w = Math.min(b.w, Math.max(b.w / ZOOM_MAX, w));
    h = w * (b.h / b.w);
    return {
      x: Math.min(Math.max(x, b.x), b.x + b.w - w),
      y: Math.min(Math.max(y, b.y), b.y + b.h - h),
      w: w,
      h: h,
    };
  }

  function viewForScale(scale, cx, cy) {
    scale = Math.min(ZOOM_MAX, Math.max(1, scale));
    const w = state.base.w / scale;
    const h = state.base.h / scale;
    const centerX = Number.isFinite(cx) ? cx : state.view.x + state.view.w / 2;
    const centerY = Number.isFinite(cy) ? cy : state.view.y + state.view.h / 2;
    return clampView(centerX - w / 2, centerY - h / 2, w, h);
  }

  function cancelViewAnim() {
    if (state.viewAnim) {
      cancelAnimationFrame(state.viewAnim);
      state.viewAnim = 0;
    }
  }

  function updateMarkerSizes() {
    const s = state.zoomScale;
    Object.keys(state.dots).forEach(function (code) {
      state.dots[code].setAttribute('r', (5 / s).toFixed(3));
    });
    if (state.location) {
      state.location.setAttribute('r', (13 / s).toFixed(3));
    }
  }

  function updateZoomUI() {
    if (!els.zoomValue) return;
    const s = state.zoomScale;
    const zoomed = s > 1.02;

    const mode = state.zoomMode;
    els.zoomValue.textContent = Math.round(s * 100) + '%';
    els.zoomMode.textContent = mode === 'auto' ? 'авто'
      : (mode === 'user' ? 'вручную'
      : (mode === 'reveal' ? 'обзор' : ''));
    els.zoomIn.disabled = s >= ZOOM_MAX - 0.01;
    els.zoomOut.disabled = !zoomed;
    els.zoomReset.disabled = !zoomed && mode !== 'auto' && mode !== 'reveal';

    els.map.classList.toggle('is-zoomed', zoomed);

    if (els.mapBadgeText) {
      els.mapBadgeText.textContent = mode === 'auto'
        ? (state.continent && state.continent.id === 'russia'
          ? 'Небольшой регион — карта увеличена'
          : 'Маленькая страна — карта увеличена')
        : (mode === 'reveal' ? 'Ответ показан — обзор карты'
        : (mode === 'user' ? 'Масштаб изменён вручную'
          : (state.continent && state.continent.id === 'russia'
            ? 'Подсвеченный регион — ваш вопрос'
            : 'Подсвеченная страна — ваш вопрос')));
    }
    if (els.mapFoot) {
      els.mapFoot.textContent = mode === 'reveal'
        ? 'Следующая страна появится автоматически'
        : (zoomed
          ? 'Перетащите карту · колёсико или кнопки меняют масштаб'
          : 'Нажмите именно на подсвеченный контур или точку');
    }
  }

  function applyView(view, mode) {
    state.view = view;
    state.zoomScale = state.base.w / view.w;
    state.zoomMode = mode || state.zoomMode;
    els.map.setAttribute(
      'viewBox',
      view.x.toFixed(2) + ' ' + view.y.toFixed(2) + ' ' + view.w.toFixed(2) + ' ' + view.h.toFixed(2)
    );
    updateMarkerSizes();
    drawLabel();
    updateZoomUI();
  }

  function setZoom(scale, cx, cy, mode) {
    cancelViewAnim();
    applyView(viewForScale(scale, cx, cy), mode || 'user');
  }

  function resetZoom(mode) {
    setZoom(1, state.base.x + state.base.w / 2, state.base.y + state.base.h / 2, mode || 'full');
  }

  function zoomBy(factor, center, mode) {
    setZoom(state.zoomScale * factor, center && center.x, center && center.y, mode || 'user');
  }

  function animateView(to, mode, duration) {
    cancelViewAnim();
    const from = { x: state.view.x, y: state.view.y, w: state.view.w, h: state.view.h };
    const start = performance.now();
    state.zoomMode = mode;

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      applyView({
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        w: from.w + (to.w - from.w) * e,
        h: from.h + (to.h - from.h) * e,
      }, mode);
      state.viewAnim = t < 1 ? requestAnimationFrame(frame) : 0;
    }

    state.viewAnim = requestAnimationFrame(frame);
  }

  function svgPoint(clientX, clientY) {
    const rect = els.map.getBoundingClientRect();
    const fit = Math.min(rect.width / state.view.w, rect.height / state.view.h) || 1;
    const padX = (rect.width - state.view.w * fit) / 2;
    const padY = (rect.height - state.view.h * fit) / 2;
    return {
      x: state.view.x + (clientX - rect.left - padX) / fit,
      y: state.view.y + (clientY - rect.top - padY) / fit,
    };
  }

  function focusCountry(country) {
    const data = MAPS[state.continent.id];
    const place = data.places[country.code];
    const path = state.paths[country.code];
    let box = null;

    if (path && path.getAttribute('d')) {
      try {
        const b = path.getBBox();
        if (b && (b.width > 0.01 || b.height > 0.01)) box = b;
      } catch (_) {}
    }
    if (!box) {
      const p = place || { x: state.base.x + state.base.w / 2, y: state.base.y + state.base.h / 2 };
      box = { x: p.x - AUTO_MIN_BOX / 2, y: p.y - AUTO_MIN_BOX / 2, width: AUTO_MIN_BOX, height: AUTO_MIN_BOX };
    }

    const w = Math.max(box.width, AUTO_MIN_BOX);
    const h = Math.max(box.height, AUTO_MIN_BOX);
    const scale = Math.min(
      AUTO_ZOOM_MAX,
      Math.max(
        state.base.w * AUTO_TARGET_SHARE / w,
        state.base.h * AUTO_TARGET_SHARE / h
      )
    );

    if (scale < AUTO_ZOOM_MIN) {
      const full = { x: state.base.x, y: state.base.y, w: state.base.w, h: state.base.h };
      if (state.settings.smoothZoomOut) animateView(full, 'full', 460);
      else resetZoom('full');
      return;
    }

    animateView(viewForScale(scale, box.x + box.width / 2, box.y + box.height / 2), 'auto', 460);
  }

  function resetTarget() {
    Object.keys(state.paths).forEach(function (code) {
      const path = state.paths[code];
      path.classList.remove('is-target');
      path.removeAttribute('tabindex');
      path.removeAttribute('role');
      path.removeAttribute('aria-label');
    });
    Object.keys(state.dots).forEach(function (code) {
      const dot = state.dots[code];
      dot.classList.remove('is-target');
      dot.removeAttribute('tabindex');
      dot.removeAttribute('role');
      dot.removeAttribute('aria-label');
    });
    if (state.location && state.location.parentNode) {
      state.location.parentNode.removeChild(state.location);
    }
    if (state.label && state.label.parentNode) {
      state.label.parentNode.removeChild(state.label);
    }
    state.location = null;
    state.label = null;
    state.labelParts = null;
    state.labelData = null;
  }

  function markTarget(country) {
    const path = state.paths[country.code];
    const dot = state.dots[country.code];
    const label = (state.continent && state.continent.id === 'russia'
      ? 'Подсвеченный регион. Нажмите, чтобы проверить себя.'
      : 'Подсвеченная страна. Нажмите, чтобы проверить себя.');
    [path, dot].forEach(function (el) {
      if (!el) return;
      el.classList.add('is-target');
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', label);
    });
  }

  function showLocation(place) {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('class', 'map__locate');
    circle.setAttribute('cx', place.x);
    circle.setAttribute('cy', place.y);
    circle.setAttribute('r', (13 / state.zoomScale).toFixed(3));
    circle.setAttribute('aria-hidden', 'true');
    els.mapMarkers.append(circle);
    state.location = circle;
  }

  function drawLabel() {
    const parts = state.labelParts;
    const data = state.labelData;
    if (!parts || !data) return;

    const place = data.place;
    const view = state.view;
    const rect = els.map.getBoundingClientRect();
    const fit = Math.min(rect.width / view.w, rect.height / view.h) || 1;
    const unit = 1 / fit;
    const toLeft = place.x > view.x + view.w * 0.62;
    const below = place.y < view.y + view.h * 0.16;
    const dx = (toLeft ? -18 : 18) * unit;
    const nameY = place.y + (below ? 20 : -18) * unit;
    const capitalY = place.y + (below ? 37 : -35) * unit;
    const anchor = toLeft ? 'end' : 'start';

    parts.group.setAttribute('class', 'map__label' + (toLeft ? ' is-left' : '') + (below ? ' is-below' : ''));
    parts.line.setAttribute('x1', place.x);
    parts.line.setAttribute('y1', place.y);
    parts.line.setAttribute('x2', place.x + dx * 0.7);
    parts.line.setAttribute('y2', nameY + (below ? -5 : 5) * unit);
    parts.line.style.strokeWidth = (1.2 * unit).toFixed(3) + 'px';

    parts.name.setAttribute('x', place.x + dx);
    parts.name.setAttribute('y', nameY);
    parts.name.setAttribute('text-anchor', anchor);
    parts.name.style.fontSize = (21 * unit).toFixed(3) + 'px';
    parts.name.style.strokeWidth = (4 * unit).toFixed(3) + 'px';

    parts.capital.setAttribute('x', place.x + dx);
    parts.capital.setAttribute('y', capitalY);
    parts.capital.setAttribute('text-anchor', anchor);
    parts.capital.style.fontSize = (14 * unit).toFixed(3) + 'px';
    parts.capital.style.strokeWidth = (4 * unit).toFixed(3) + 'px';

    const showName = state.settings.showCountry;
    const showCap = state.settings.showCapital;
    if (!showName && showCap) {
      const y = (nameY + capitalY) / 2;
      parts.capital.setAttribute('y', y);
      parts.line.setAttribute('y2', y + (below ? -5 : 5) * unit);
    } else if (showName && !showCap) {
      parts.name.setAttribute('y', (nameY + capitalY) / 2);
    }
  }

  function showLabels(place, country) {
    if (state.label && state.label.parentNode) {
      state.label.parentNode.removeChild(state.label);
    }

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'map__label');
    group.setAttribute('aria-hidden', 'true');

    const line = document.createElementNS(SVG_NS, 'line');
    group.append(line);

    const name = document.createElementNS(SVG_NS, 'text');
    name.setAttribute('class', 'map__label-country');
    name.textContent = country.name;
    name.style.display = state.settings.showCountry ? '' : 'none';
    group.append(name);

    const capital = document.createElementNS(SVG_NS, 'text');
    capital.setAttribute('class', 'map__label-capital');
    capital.textContent = 'столица · ' + country.capital;
    capital.style.display = state.settings.showCapital ? '' : 'none';
    group.append(capital);

    els.mapLabels.append(group);

    state.label = group;
    state.labelParts = { group: group, line: line, name: name, capital: capital };
    state.labelData = { place: place, country: country };
    drawLabel();
  }

  /* ─────────── Карта ─────────── */

  function onMapHit(code) {
    if (state.dragMoved) {
      state.dragMoved = false;
      return;
    }
    if (!state.country || !viewOpen) return;
    if (state.revealed) {
      toast('Ответ уже показан — ждите следующую страну');
      return;
    }
    if (code !== state.country.code) {
      toast(state.continent && state.continent.id === 'russia'
        ? 'Ищите подсвеченный регион'
        : 'Ищите подсвеченную страну');
      return;
    }
    revealAnswer();
  }

  function buildMap(cont) {
    const data = MAPS[cont.id];
    if (!data) return false;

    const base = parseViewBox(data.viewBox);
    cancelViewAnim();
    state.base = base;
    state.view = { x: base.x, y: base.y, w: base.w, h: base.h };
    state.zoomScale = 1;
    state.zoomMode = 'full';
    els.map.setAttribute('aria-label', 'Карта: ' + cont.name + '. Найдите подсвеченный ' +
      (cont.id === 'russia' ? 'регион' : 'объект') + '.');
    els.mapLand.replaceChildren();
    els.mapMarkers.replaceChildren();
    els.mapLabels.replaceChildren();
    state.paths = {};
    state.dots = {};
    const background = new Set(data.background || []);
    state.location = null;
    state.label = null;
    state.labelParts = null;
    state.labelData = null;

    Object.keys(data.paths).forEach(function (code) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', data.paths[code]);
      path.setAttribute('fill-rule', 'evenodd');
      path.dataset.code = code;
      if (background.has(code)) path.classList.add('is-bg');
      path.addEventListener('click', function () { onMapHit(code); });
      path.addEventListener('pointerenter', function () { showHoverName(code); });
      path.addEventListener('pointerleave', hideHoverName);
      els.mapLand.append(path);
      state.paths[code] = path;
    });

    Object.keys(data.places).forEach(function (code) {
      const place = data.places[code];
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('class', 'map__dot');
      dot.setAttribute('cx', place.x);
      dot.setAttribute('cy', place.y);
      dot.setAttribute('r', '5');
      dot.dataset.code = code;
      dot.addEventListener('click', function () { onMapHit(code); });
      dot.addEventListener('pointerenter', function () { showHoverName(code); });
      dot.addEventListener('pointerleave', hideHoverName);
      els.mapMarkers.append(dot);
      state.dots[code] = dot;
    });

    applyView({ x: base.x, y: base.y, w: base.w, h: base.h }, 'full');
    renderAllLabels(cont);
    return true;
  }

  els.map.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const target = e.target;
    if (!target || !target.dataset || !target.dataset.code) return;
    e.preventDefault();
    onMapHit(target.dataset.code);
  });

  els.map.addEventListener('wheel', function (e) {
    if (!viewOpen) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, svgPoint(e.clientX, e.clientY), 'user');
  }, { passive: false });

  let drag = null;

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
      state.dragMoved = true;
    }
    if (!drag.moved) return;

    const rect = els.map.getBoundingClientRect();
    const fit = Math.min(rect.width / drag.view.w, rect.height / drag.view.h) || 1;
    const cx = drag.view.x + drag.view.w / 2 - dx / fit;
    const cy = drag.view.y + drag.view.h / 2 - dy / fit;
    cancelViewAnim();
    applyView(clampView(cx - drag.view.w / 2, cy - drag.view.h / 2, drag.view.w, drag.view.h), 'user');
  }

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    els.map.classList.remove('is-dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    setTimeout(function () { state.dragMoved = false; }, 80);
  }

  els.map.addEventListener('pointerdown', function (e) {
    if (!viewOpen || state.zoomScale <= 1.02 || e.button !== 0 || drag) return;
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      view: { x: state.view.x, y: state.view.y, w: state.view.w, h: state.view.h },
      moved: false,
    };
    state.dragMoved = false;
    els.map.classList.add('is-dragging');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  });

  /* ─────────── Ход викторины ─────────── */

  function showComplete() {
    const cont = state.continent;
    clearTimers();
    resetTarget();
    state.country = null;
    state.revealed = false;

    els.answerBar.classList.remove('is-counting', 'is-next');
    els.answerLabel.textContent = cont.id === 'russia' ? 'Все регионы пройдены' : 'Все страны пройдены';
    els.countryName.textContent = 'Нажмите «Обновить»';
    els.countryName.classList.remove('is-revealed');
    els.capitalName.textContent = 'чтобы начать заново';
    els.capitalName.classList.remove('is-revealed');
    els.answerFlag.textContent = '✓';
    els.answerFlag.classList.remove('is-revealed');
    els.answerWhere.textContent = '';
    els.cardCounter.textContent = cont.count + ' / ' + cont.count;
    els.live.textContent = (cont.id === 'russia' ? 'Все регионы пройдены' : 'Все страны пройдены') +
      '. Нажмите «Обновить», чтобы вернуть их.';
  }

  function pickCountry(excludeCode) {
    const cont = state.continent;
    if (!cont) return;

    state.gen++;
    clearTimers();
    resetTarget();
    hideHoverName();

    const pool = shuffle(poolFor(cont).filter(function (c) {
      return !state.used.has(c.code) && c.code !== excludeCode;
    }));

    if (!pool.length) {
      showComplete();
      return;
    }

    const country = pool[0];
    state.used.add(country.code);
    state.country = country;
    state.revealed = false;

    applyPreAnswer();
    els.answerLabel.textContent = cont.id === 'russia'
      ? 'Найдите подсвеченный регион на карте'
      : 'Найдите подсвеченную страну на карте';

    els.answerBar.classList.remove('is-counting', 'is-next');
    els.cardCounter.textContent = state.used.size + ' / ' + cont.count;
    els.crumbCount.textContent = cont.count + ' ' + unitWord(cont, cont.count);

    markTarget(country);
    if (state.settings.autoZoom) {
      focusCountry(country);
    } else {
      /* Ручной масштаб сохраняется при смене страны */
      updateZoomUI();
    }
    els.live.textContent = 'Подсвечен новый объект ' + cont.where + '.';
  }

  function revealAnswer() {
    const country = state.country;
    if (!country || state.revealed) return;
    const place = MAPS[state.continent.id].places[country.code];
    const gen = state.gen;

    state.revealed = true;
    setField('country', country.name, true);
    setField('capital', country.capital, true);

    els.answerFlag.textContent = country.emoji || flagEmoji(country.code) || '★';
    els.answerFlag.classList.add('is-revealed');
    els.answerLabel.textContent = 'Правильный ответ';

    if (place && state.settings.showWhere) {
      const prefix = country.regionType ? country.regionType + ' · ' : '';
      els.answerWhere.textContent = prefix + '≈ ' + coordText(place) + ' — на карте';
      showLocation(place);
    } else {
      els.answerWhere.textContent = country.regionType || '';
    }
    els.answerBar.classList.add('is-counting');

    const full = { x: state.base.x, y: state.base.y, w: state.base.w, h: state.base.h };
    if (state.settings.smoothZoomOut) animateView(full, 'reveal', 720);
    else applyView(full, 'reveal');

    els.live.textContent = country.name + '. Столица — ' + country.capital + '.';

    state.revealTimer = setTimeout(function () {
      state.revealTimer = 0;
      if (gen !== state.gen) return;
      fadeToNext(gen);
    }, state.settings.revealTime);
  }

  function fadeToNext(gen) {
    els.answerBar.classList.add('is-next');
    state.advanceTimer = setTimeout(function () {
      state.advanceTimer = 0;
      if (gen !== state.gen) return;
      pickCountry(state.country && state.country.code);
    }, 260);
  }

  function openContinent(id) {
    const cont = byId.get(id);
    if (!cont) return;
    if (!cont.count) {
      toast(cont.id === 'russia'
        ? 'Включите типы регионов России в настройках'
        : 'В Антарктиде нет стран — только полярные станции');
      return;
    }
    if (!MAPS[cont.id] || !buildMap(cont)) {
      toast('Карта материка временно недоступна');
      return;
    }

    lastFocus = document.activeElement;
    state.continent = cont;
    state.used.clear();
    state.country = null;
    state.revealed = false;
    state.gen++;
    clearTimers();

    setAccent(cont.color);
    els.crumbContinent.textContent = cont.name;
    els.crumbCount.textContent = cont.count + ' ' + unitWord(cont, cont.count);
    els.detailWord.textContent = (SHORT[cont.id] || cont.name).toUpperCase();

    els.detail.hidden = false;
    document.body.classList.add('is-locked');
    if (globe) globe.setPaused(true);

    pickCountry(null);

    viewOpen = true;
    void els.detail.offsetWidth;
    requestAnimationFrame(function () {
      els.detail.classList.add('is-open');
      els.back.focus({ preventScroll: true });
    });
  }

  function closeDetail() {
    if (!viewOpen) return;
    viewOpen = false;
    state.gen++;
    clearTimers();
    cancelViewAnim();
    els.answerBar.classList.remove('is-counting', 'is-next');
    els.detail.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    hideHoverName();
    hideTip();

    setTimeout(function () {
      if (!viewOpen) els.detail.hidden = true;
    }, 380);

    if (globe) globe.setPaused(false);
    if (lastFocus && lastFocus.focus) {
      try { lastFocus.focus({ preventScroll: true }); } catch (_) {}
    }
  }

  /* ─────────── Глобус ─────────── */

  let globe = null;

  if (window.createGlobe) {
    globe = window.createGlobe({
      canvas: els.canvas,
      onReady: function () {
        if (els.shell) els.shell.classList.add('is-ready');
      },
      onSelect: function (id) {
        if (id === 'antarctica') {
          toast('В Антарктиде нет стран — только полярные станции');
          return;
        }
        openContinent(id);
      },
      onHover: function (id, x, y) { showTip(id, x, y); },
      onHoverEnd: hideTip,
    });
  }

  /* ─────────── События интерфейса ─────────── */

  els.back.addEventListener('click', closeDetail);

  if (els.settingsToggle) {
    els.settingsToggle.addEventListener('click', function () { setSettingsOpen(!settingsOpen, els.settingsToggle); });
  }
  if (els.settingsLink) {
    els.settingsLink.addEventListener('click', function () { setSettingsOpen(!settingsOpen, els.settingsLink); });
  }
  if (els.settingsClose) {
    els.settingsClose.addEventListener('click', function () { setSettingsOpen(false); });
  }
  document.addEventListener('pointerdown', function (e) {
    if (!settingsOpen) return;
    if (els.settingsPanel && els.settingsPanel.contains(e.target)) return;
    if (els.settingsToggle && els.settingsToggle.contains(e.target)) return;
    if (els.settingsLink && els.settingsLink.contains(e.target)) return;
    setSettingsOpen(false);
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-setting]'), function (input) {
    input.addEventListener('change', function () {
      state.settings[input.dataset.setting] = input.checked;
      saveSettings();
      applySettings();
      if (input.dataset.setting === 'autoZoom' && viewOpen && !state.revealed && state.country) {
        if (input.checked) focusCountry(state.country);
        else resetZoom('full');
      }
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-region-type]'), function (input) {
    input.addEventListener('change', function () {
      state.settings.ruTypes[input.dataset.regionType] = input.checked;
      saveSettings();
      applySettings();
      regionTypesChanged();
    });
  });

  if (els.revealTime) {
    els.revealTime.addEventListener('click', function (e) {
      const btn = e.target.closest ? e.target.closest('button[data-ms]') : null;
      if (!btn) return;
      state.settings.revealTime = Number(btn.dataset.ms) || 2000;
      saveSettings();
      applySettings();
    });
  }

  if (els.settingsReset) {
    els.settingsReset.addEventListener('click', function () {
      state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      saveSettings();
      syncSettingsUI();
      regionTypesChanged();
      toast('Настройки сброшены');
    });
  }

  els.zoomIn.addEventListener('click', function () { zoomBy(1.35); });
  els.zoomOut.addEventListener('click', function () { zoomBy(1 / 1.35); });
  els.zoomReset.addEventListener('click', function () { resetZoom('full'); });

  els.refresh.addEventListener('click', function () {
    if (!state.continent) return;
    els.refresh.classList.remove('is-spinning');
    void els.refresh.offsetWidth;
    els.refresh.classList.add('is-spinning');
    setTimeout(function () { els.refresh.classList.remove('is-spinning'); }, 540);
    state.used.clear();
    pickCountry(state.country && state.country.code);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && settingsOpen) {
      e.preventDefault();
      setSettingsOpen(false);
      return;
    }
    if (e.key === 'Escape' && viewOpen) {
      e.preventDefault();
      closeDetail();
      return;
    }
    if (!viewOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    if (settingsOpen && els.settingsPanel && els.settingsPanel.contains(document.activeElement)) return;

    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomBy(1.35);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      zoomBy(1 / 1.35);
    } else if (e.key === '0') {
      e.preventDefault();
      resetZoom('full');
    }
  });

  window.addEventListener('beforeunload', function () {
    if (globe) globe.destroy();
  });

  let starResizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(starResizeTimer);
    starResizeTimer = setTimeout(drawStars, 180);
  });

  /* ─────────── Старт ─────────── */

  drawStars();
  buildLegend();
  syncSettingsUI();
})();
