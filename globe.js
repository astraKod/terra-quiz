/* ─────────────────────────────────────────────
   Терра — рендер вращающегося глобуса на Canvas 2D
   Текстура-развёртка запекается один раз, затем каждый кадр
   сдвигается по долготе и проецируется через заранее рассчитанную
   таблицу ортографической сферы.
   ───────────────────────────────────────────── */

(function () {
  'use strict';

  const PALETTE = {
    'europe': '#f6c85f',
    'asia': '#ef8a62',
    'russia': '#ff9d7a',
    'africa': '#72cfa4',
    'north-america': '#7ba7f7',
    'south-america': '#c39bf2',
    'oceania': '#6fd6d0',
    'antarctica': '#dfe9f4',
  };

  /* Идентификаторы совпадают с полем c в world.js */
  const ID_TO_KEY = {
    1: 'europe',
    2: 'asia',
    3: 'africa',
    4: 'north-america',
    5: 'south-america',
    6: 'oceania',
    7: 'antarctica',
    8: 'russia',
  };

  const TW = 2048;
  const TH = 1024;
  const IDW = 1024;
  const IDH = 512;
  const TILT = 0.31;
  const COS_T = Math.cos(TILT);
  const SIN_T = Math.sin(TILT);
  const SPIN = 0.085; // радиан в секунду

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function wrap(v, m) {
    v %= m;
    return v < 0 ? v + m : v;
  }

  function lighten(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(((n >> 16) & 255) + amount, 0, 255);
    const g = clamp(((n >> 8) & 255) + amount, 0, 255);
    const b = clamp((n & 255) + amount, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  function traceFeature(g, feature, width, height) {
    const rings = feature.r;
    g.beginPath();
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      for (let i = 0; i < ring.length; i += 2) {
        const x = ((ring[i] + 180) / 360) * width;
        const y = ((90 - ring[i + 1]) / 180) * height;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    }
  }

  /* ─────────── Текстура ─────────── */

  function buildTexture(world) {
    const canvas = document.createElement('canvas');
    canvas.width = TW;
    canvas.height = TH;
    const g = canvas.getContext('2d', { alpha: false });

    // Океан: глубина у полюсов темнее, у экватора — светлее.
    const sea = g.createLinearGradient(0, 0, 0, TH);
    sea.addColorStop(0, '#071a2e');
    sea.addColorStop(0.16, '#0a2744');
    sea.addColorStop(0.46, '#0d365c');
    sea.addColorStop(0.54, '#0d3660');
    sea.addColorStop(0.84, '#0a2744');
    sea.addColorStop(1, '#06182a');
    g.fillStyle = sea;
    g.fillRect(0, 0, TW, TH);

    // Мягкие «течения» — крупные радиальные пятна света.
    const blooms = [
      [0.18, 0.58, 0.2, 0.05],
      [0.48, 0.64, 0.26, 0.06],
      [0.74, 0.42, 0.18, 0.045],
      [0.34, 0.26, 0.22, 0.05],
      [0.9, 0.7, 0.16, 0.04],
    ];
    for (const [bx, by, br, ba] of blooms) {
      // Рисуем пятно с повторами по горизонтали, чтобы развёртка
      // оставалась бесшовной на стыке -180°/180°.
      for (const offset of [-TW, 0, TW]) {
        const cx = bx * TW + offset;
        const rg = g.createRadialGradient(cx, by * TH, 0, cx, by * TH, br * TW);
        rg.addColorStop(0, `rgba(96,164,226,${ba})`);
        rg.addColorStop(1, 'rgba(96,164,226,0)');
        g.fillStyle = rg;
        g.fillRect(0, 0, TW, TH);
      }
    }

    // Сетка меридианов и параллелей.
    g.lineWidth = 1;
    for (let lon = -165; lon < 180; lon += 15) {
      const x = ((lon + 180) / 360) * TW;
      g.strokeStyle = lon % 90 === 0 ? 'rgba(150,200,255,0.07)' : 'rgba(150,200,255,0.035)';
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, TH);
      g.stroke();
    }
    for (let lat = -75; lat <= 75; lat += 15) {
      const y = ((90 - lat) / 180) * TH;
      g.strokeStyle = lat === 0 ? 'rgba(150,205,255,0.085)' : 'rgba(150,200,255,0.04)';
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(TW, y);
      g.stroke();
    }

    if (!world || !world.length) return canvas;

    // Слой суши: сначала контуры, затем лёгкая широтная подсветка.
    const land = document.createElement('canvas');
    land.width = TW;
    land.height = TH;
    const lg = land.getContext('2d');

    for (let i = 0; i < world.length; i++) {
      const feature = world[i];
      const key = ID_TO_KEY[feature.c];
      const color = PALETTE[key] || '#9db4c9';
      traceFeature(lg, feature, TW, TH);
      lg.fillStyle = color;
      lg.fill();
      lg.strokeStyle = 'rgba(6,16,28,0.55)';
      lg.lineWidth = 2.4;
      lg.stroke();
      lg.strokeStyle = lighten(color, 26);
      lg.globalAlpha = 0.55;
      lg.lineWidth = 0.9;
      lg.stroke();
      lg.globalAlpha = 1;
    }

    // Внутреннее затенение суши — от светлого сверху к холодному снизу.
    lg.globalCompositeOperation = 'source-atop';
    const landShade = lg.createLinearGradient(0, 0, 0, TH);
    landShade.addColorStop(0, 'rgba(255,255,255,0.14)');
    landShade.addColorStop(0.3, 'rgba(255,255,255,0.02)');
    landShade.addColorStop(0.72, 'rgba(0,10,26,0.04)');
    landShade.addColorStop(1, 'rgba(0,10,26,0.2)');
    lg.fillStyle = landShade;
    lg.fillRect(0, 0, TW, TH);
    lg.globalCompositeOperation = 'source-over';

    // Лёгкое свечение вокруг береговой линии.
    g.save();
    g.shadowColor = 'rgba(5,14,26,0.55)';
    g.shadowBlur = 16;
    g.shadowOffsetY = 3;
    g.drawImage(land, 0, 0);
    g.restore();

    // Лёгкая синеватая дымка поверх всей карты у полюсов.
    g.globalCompositeOperation = 'multiply';
    const cold = g.createLinearGradient(0, 0, 0, TH);
    cold.addColorStop(0, 'rgba(168,196,228,1)');
    cold.addColorStop(0.14, 'rgba(225,236,247,1)');
    cold.addColorStop(0.5, 'rgba(255,255,255,1)');
    cold.addColorStop(0.86, 'rgba(224,235,247,1)');
    cold.addColorStop(1, 'rgba(160,190,224,1)');
    g.fillStyle = cold;
    g.fillRect(0, 0, TW, TH);
    g.globalCompositeOperation = 'source-over';

    // Полярные льды: мягкая белая кромка у полюсов.
    const iceSouth = g.createLinearGradient(0, TH * 0.82, 0, TH);
    iceSouth.addColorStop(0, 'rgba(226,238,249,0)');
    iceSouth.addColorStop(0.45, 'rgba(226,238,249,0.22)');
    iceSouth.addColorStop(1, 'rgba(240,247,255,0.8)');
    g.fillStyle = iceSouth;
    g.fillRect(0, TH * 0.82, TW, TH * 0.18);

    const iceNorth = g.createLinearGradient(0, 0, 0, TH * 0.075);
    iceNorth.addColorStop(0, 'rgba(232,242,252,0.62)');
    iceNorth.addColorStop(1, 'rgba(232,242,252,0)');
    g.fillStyle = iceNorth;
    g.fillRect(0, 0, TW, TH * 0.075);

    return canvas;
  }

  /* ─────────── Карта материков для попадания курсором ─────────── */

  function buildIdMap(world) {
    const canvas = document.createElement('canvas');
    canvas.width = IDW;
    canvas.height = IDH;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000';
    g.fillRect(0, 0, IDW, IDH);

    if (!world || !world.length) return { data: g.getImageData(0, 0, IDW, IDH).data, width: IDW };

    for (let i = 0; i < world.length; i++) {
      const feature = world[i];
      if (!feature.c) continue;
      // Кодируем id в красном канале с шагом 32, чтобы сглаживание
      // на краях не перепутывало соседние материки.
      g.fillStyle = `rgb(${feature.c * 16},0,0)`;
      traceFeature(g, feature, IDW, IDH);
      g.fill();
    }

    // Южная ледовая шапка тоже реагирует как Антарктида:
    // так белая кромка у полюса не остаётся «мёртвой» зоной.
    g.fillStyle = 'rgb(112,0,0)';
    g.fillRect(0, Math.floor(IDH * 0.865), IDW, IDH);

    return { data: g.getImageData(0, 0, IDW, IDH).data, width: IDW };
  }

  /* ─────────── Ортографическая проекция ─────────── */

  function buildProjection(size) {
    const max = size * size;
    const pos = new Int32Array(max);
    const sxArr = new Int32Array(max);
    const rowArr = new Int32Array(max);
    const alphaArr = new Int32Array(max);
    let count = 0;

    const half = size / 2;
    const edgeAA = 1.5;

    for (let y = 0; y < size; y++) {
      const ny = (y + 0.5) / half - 1;
      for (let x = 0; x < size; x++) {
        const nx = (x + 0.5) / half - 1;
        const r2 = nx * nx + ny * ny;
        if (r2 >= 1) continue;

        const zs = Math.sqrt(1 - r2);
        const cy = -ny;
        const oy = cy * COS_T + zs * SIN_T;
        const oz = -cy * SIN_T + zs * COS_T;

        const lat = Math.asin(clamp(oy, -1, 1));
        const lon = Math.atan2(nx, oz);

        let u = lon / (2 * Math.PI) + 0.5;
        if (u >= 1) u -= 1;
        else if (u < 0) u += 1;

        let ty = Math.floor((0.5 - lat / Math.PI) * TH);
        if (ty < 0) ty = 0;
        else if (ty >= TH) ty = TH - 1;

        let sx = Math.floor(u * TW) % TW;

        const edge = 1 - Math.sqrt(r2);
        const aa = clamp((edge * half) / edgeAA, 0, 1);

        pos[count] = y * size + x;
        sxArr[count] = sx;
        rowArr[count] = ty * TW;
        alphaArr[count] = Math.round(aa * 255) << 24;
        count++;
      }
    }

    return { pos, sxArr, rowArr, alphaArr, count };
  }

  /* ─────────── Свет и атмосфера запекаются в отдельный слой ─────────── */

  function buildOverlay(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');
    const c = size / 2;
    const r = size / 2;

    g.save();
    g.beginPath();
    g.arc(c, c, r - 0.7, 0, Math.PI * 2);
    g.clip();

    // Свет сверху-слева, мягкая тень снизу-справа.
    const light = g.createRadialGradient(
      c - r * 0.4, c - r * 0.44, r * 0.08,
      c, c, r * 1.18
    );
    light.addColorStop(0, 'rgba(255,243,219,0.16)');
    light.addColorStop(0.38, 'rgba(255,255,255,0.02)');
    light.addColorStop(0.72, 'rgba(2,8,20,0.16)');
    light.addColorStop(1, 'rgba(1,4,14,0.6)');
    g.fillStyle = light;
    g.fillRect(0, 0, size, size);

    // Голубая кайма атмосферы у лимба.
    const rim = g.createRadialGradient(c, c, r * 0.7, c, c, r);
    rim.addColorStop(0, 'rgba(86,158,255,0)');
    rim.addColorStop(0.66, 'rgba(86,158,255,0.05)');
    rim.addColorStop(0.9, 'rgba(124,196,255,0.2)');
    rim.addColorStop(1, 'rgba(198,234,255,0.36)');
    g.fillStyle = rim;
    g.fillRect(0, 0, size, size);

    g.restore();

    // Тонкий контур сферы.
    g.beginPath();
    g.arc(c, c, r - 0.6, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(168,214,255,0.15)';
    g.lineWidth = 1;
    g.stroke();

    return canvas;
  }

  /* ─────────── Публичный конструктор ─────────── */

  function createGlobe(options) {
    const opts = options || {};
    const canvas = opts.canvas;
    if (!canvas) throw new Error('createGlobe: canvas не передан');

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('createGlobe: Canvas 2D недоступен');

    const world = window.WORLD || [];
    const textureCanvas = buildTexture(world);
    const texCtx = textureCanvas.getContext('2d', { willReadFrequently: true });
    const texPixels = texCtx.getImageData(0, 0, TW, TH);
    const tex32 = new Uint32Array(texPixels.data.buffer);
    // Обнуляем альфу текстуры: в кадре она заменяется своей.
    for (let i = 0; i < tex32.length; i++) tex32[i] &= 0x00ffffff;

    const idMap = buildIdMap(world);
    const id32 = new Uint32Array(idMap.data.buffer);

    let size = 0;
    let projection = null;
    let overlay = null;
    let imageData = null;
    let out32 = null;

    let shift = Math.PI * 0.62 * TW / (2 * Math.PI); // стартовый ракурс
    let velocity = 0;
    let paused = false;
    let destroyed = false;
    let raf = 0;
    let lastTime = 0;
    let ready = false;
    let startedAt = 0;
    let frames = 0;
    let frameCost = 0;

    const reduceMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

    /* ── состояние указателя ── */
    let dragging = false;
    let dragMoved = 0;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartTime = 0;
    let lastPointerX = 0;
    let lastMoveTime = 0;
    let hoverAt = 0;
    let hoverKey = null;

    function applySize(nextSize) {
      size = nextSize;
      canvas.width = size;
      canvas.height = size;
      projection = buildProjection(size);
      overlay = buildOverlay(size);
      imageData = ctx.createImageData(size, size);
      out32 = new Uint32Array(imageData.data.buffer);
      // imageData создаётся полностью прозрачной; за пределами сферы
      // пиксели так и остаются нетронутыми.
    }

    function rebuildIfNeeded() {
      // clientWidth/clientHeight не учитывают CSS-трансформации входа,
      // поэтому внутреннее разрешение совпадает с итоговым размером.
      const rect = canvas.getBoundingClientRect();
      const cssSize = Math.max(
        1,
        Math.min(canvas.clientWidth || rect.width, canvas.clientHeight || rect.height)
      );
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const target = Math.round(clamp(cssSize * dpr, 300, 760));
      if (!size || Math.abs(target - size) >= 28) {
        applySize(target);
        renderFrame(performance.now(), 0);
      }
    }

    function sampleContinent(nx, ny) {
      const r2 = nx * nx + ny * ny;
      if (r2 >= 1) return null;

      const zs = Math.sqrt(1 - r2);
      const cy = -ny;
      const oy = cy * COS_T + zs * SIN_T;
      const oz = -cy * SIN_T + zs * COS_T;
      const lat = Math.asin(clamp(oy, -1, 1));
      const lon = Math.atan2(nx, oz);

      let u = lon / (2 * Math.PI) + 0.5;
      if (u >= 1) u -= 1;
      else if (u < 0) u += 1;

      const shiftU = (shift / TW) * IDW;
      let x = Math.floor(u * IDW + shiftU) % IDW;
      if (x < 0) x += IDW;
      let y = Math.floor((0.5 - lat / Math.PI) * IDH);
      if (y < 0) y = 0;
      else if (y >= IDH) y = IDH - 1;

      // Края фигур сглажены — берём ближайший id, но только если
      // значение уверенно попадает в его «полку».
      const raw = id32[y * IDW + x] & 255;
      let id = 0;
      let best = 11;
      for (let candidate = 1; candidate <= 8; candidate++) {
        const diff = Math.abs(raw - candidate * 16);
        if (diff < best) {
          best = diff;
          id = candidate;
        }
      }
      return ID_TO_KEY[id] || null;
    }

    function pickAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((clientY - rect.top) / rect.height) * 2 - 1;
      return sampleContinent(nx, ny);
    }

    function renderFrame(now, dt) {
      if (!projection) return;

      if (!paused) {
        if (!dragging) {
          // Осевое вращение Земли + инерция после броска.
          shift -= (reduceMotion ? SPIN * 0.25 : SPIN) * dt * (TW / (2 * Math.PI));
          shift += velocity * dt;
          velocity *= Math.exp(-2.6 * dt);
          if (Math.abs(velocity) < 1.2) velocity = 0;
        }
        shift = wrap(shift, TW);

        const s = Math.round(shift) % TW;
        const pos = projection.pos;
        const sxs = projection.sxArr;
        const rows = projection.rowArr;
        const alphas = projection.alphaArr;
        const total = projection.count;

        for (let i = 0; i < total; i++) {
          let x = sxs[i] + s;
          if (x >= TW) x -= TW;
          out32[pos[i]] = tex32[rows[i] + x] | alphas[i];
        }

        ctx.putImageData(imageData, 0, 0);
        ctx.drawImage(overlay, 0, 0);
      }

      if (!ready) {
        ready = true;
        startedAt = now;
        if (typeof opts.onReady === 'function') opts.onReady();
      }

      if (!paused && frames < 240 && startedAt) {
        const cost = performance.now() - now;
        frameCost += cost;
        frames++;
        // Если на слабом устройстве отрисовка стабильно тяжёлая —
        // один раз понижаем внутреннее разрешение.
        if (frames === 120 && frameCost / frames > 26 && size > 560) {
          applySize(Math.max(520, Math.round(size * 0.76)));
        }
      }
    }

    function tick(now) {
      if (destroyed) return;
      raf = requestAnimationFrame(tick);
      let dt = lastTime ? (now - lastTime) / 1000 : 0.016;
      lastTime = now;
      dt = Math.min(dt, 0.05);
      renderFrame(now, dt);
    }

    /* ── события ── */

    function onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      dragMoved = 0;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartTime = performance.now();
      lastPointerX = e.clientX;
      lastMoveTime = dragStartTime;
      velocity = 0;
      lastTime = 0;
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      }
      canvas.classList.add('is-grabbing');
      hideHover();
    }

    function onPointerMove(e) {
      if (dragging) {
        const now = performance.now();
        const dx = e.clientX - lastPointerX;
        lastPointerX = e.clientX;
        dragMoved += Math.abs(dx);

        const rect = canvas.getBoundingClientRect();
        if (rect.width) {
          const perCssPx = TW / (Math.PI * rect.width);
          const delta = -dx * perCssPx;
          shift = wrap(shift + delta, TW);
          const elapsed = Math.max(0.008, (now - lastMoveTime) / 1000);
          lastMoveTime = now;
          velocity = clamp(delta / elapsed, -2800, 2800);
        }
        return;
      }

      if (e.pointerType === 'touch') return;
      const now = performance.now();
      if (now - hoverAt < 32) return;
      hoverAt = now;

      const key = pickAt(e.clientX, e.clientY);
      if (key) {
        hoverKey = key;
        if (typeof opts.onHover === 'function') {
          opts.onHover(key, e.clientX, e.clientY);
        }
        canvas.classList.add('is-over');
      } else {
        hideHover();
      }
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      canvas.classList.remove('is-grabbing');
      if (canvas.releasePointerCapture) {
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      }
      const dist = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
      const elapsed = performance.now() - dragStartTime;

      if (dist < 6 && elapsed < 800) {
        const key = pickAt(e.clientX, e.clientY);
        if (key && typeof opts.onSelect === 'function') {
          opts.onSelect(key);
        }
      }
    }

    function onPointerCancel() {
      dragging = false;
      canvas.classList.remove('is-grabbing');
    }

    function onPointerLeave() {
      if (!dragging) hideHover();
    }

    function hideHover() {
      if (hoverKey === null) return;
      hoverKey = null;
      canvas.classList.remove('is-over');
      if (typeof opts.onHoverEnd === 'function') opts.onHoverEnd();
    }

    function onVisibility() {
      lastTime = 0;
    }

    function onResize() {
      rebuildIfNeeded();
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);

    let resizeObserver = null;
    let resizeTimer = 0;
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(rebuildIfNeeded, 120);
      });
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener('resize', onResize);
    }

    // Первый расчёт размера и запуск цикла.
    rebuildIfNeeded();
    if (!size) applySize(600);
    lastTime = 0;
    raf = requestAnimationFrame(tick);

    return {
      setPaused: function (value) {
        paused = Boolean(value);
        if (!paused) lastTime = 0;
      },
      isPaused: function () {
        return paused;
      },
      refresh: rebuildIfNeeded,
      destroy: function () {
        destroyed = true;
        cancelAnimationFrame(raf);
        clearTimeout(resizeTimer);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        document.removeEventListener('visibilitychange', onVisibility);
        if (resizeObserver) resizeObserver.disconnect();
        else window.removeEventListener('resize', onResize);
      },
    };
  }

  window.createGlobe = createGlobe;
})();
