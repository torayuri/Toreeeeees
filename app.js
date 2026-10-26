/* =========================================================
   Toreeeeees — スマホがトレース台になる
   ========================================================= */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const MAX_SIDE = 4096;          // 大きすぎる画像は縮小（iOSのメモリ対策）
  const MIN_SCALE = 0.01;
  const MAX_SCALE = 20;
  const HOLD_MS = 1200;           // ロック解除の長押し時間
  const CARD_W = 85.6, CARD_H = 53.98;

  const el = {
    body: document.body,
    welcome: $('#welcome'), file: $('#file'), drop: $('#drop'),
    resume: $('#resume'), resumeThumb: $('#resumeThumb'),
    stage: $('#stage'), art: $('#art'), grid: $('#grid'),
    topbar: $('#topbar'), panel: $('#panel'),
    roScale: $('#roScale'), roRot: $('#roRot'), roMm: $('#roMm'),
    rScale: $('#rScale'), oScale: $('#oScale'),
    rRot: $('#rRot'), oRot: $('#oRot'),
    rContrast: $('#rContrast'), oContrast: $('#oContrast'),
    rBright: $('#rBright'), oBright: $('#oBright'),
    rOpacity: $('#rOpacity'), oOpacity: $('#oOpacity'),
    sGray: $('#sGray'), sInvert: $('#sInvert'), sLine: $('#sLine'),
    sTwist: $('#sTwist'), sCross: $('#sCross'),
    tFlipH: $('#tFlipH'), tFlipV: $('#tFlipV'),
    mmInputs: $('#mmInputs'), mmW: $('#mmW'), mmH: $('#mmH'), calibLabel: $('#calibLabel'),
    gridHint: $('#gridHint'),
    lock: $('#lock'), unlock: $('#unlock'), lockCornerTxt: $('#lockCornerTxt'),
    calib: $('#calib'), card: $('#card'), cardWrap: $('#cardWrap'), rCalib: $('#rCalib'), calibVal: $('#calibVal'),
    coach: $('#coach'), toast: $('#toast'), dragOver: $('#dragOver'),
  };

  /* ---------------- state ---------------- */
  const defaults = {
    x: 0, y: 0, scale: 1, rot: 0, flipX: false, flipY: false,
    gray: false, invert: false, line: false,
    contrast: 100, bright: 100, opacity: 100,
    bg: 'white', grid: 'off', gridColor: '#ff5a5a', cross: false,
    twist: true, corner: 'br',
  };
  const S = { ...defaults };
  let iw = 0, ih = 0;               // 画像の実ピクセルサイズ
  let imageBlob = null;
  let imageURL = null;
  let locked = false;
  let pxPerMm = parseFloat(localStorage.getItem('toreeeeees.ppm')) || 0;

  /* ---------------- storage (IndexedDB) ---------------- */
  const db = (() => {
    let p;
    const open = () => p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('toreeeeees', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => {
      const d = await open();
      return new Promise((res, rej) => {
        const t = d.transaction('kv', mode);
        const req = fn(t.objectStore('kv'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
      });
    };
    return {
      get: k => tx('readonly', s => s.get(k)).catch(() => null),
      set: (k, v) => tx('readwrite', s => s.put(v, k)).catch(() => null),
    };
  })();

  let saveTimer = 0;
  const saveState = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => db.set('state', { ...S }), 300);
  };

  /* ---------------- helpers ---------------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const normDeg = d => { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; };
  const fmt = (n, d = 0) => Number(n).toFixed(d).replace(/\.0+$/, '');
  const stageSize = () => ({ w: el.stage.clientWidth, h: el.stage.clientHeight });

  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-on'), ms);
  }

  const setRangeFill = r => {
    const p = (r.value - r.min) / (r.max - r.min) * 100;
    r.style.setProperty('--p', p + '%');
  };

  // 大きさスライダーは対数（1% 〜 1000%）
  const scaleToSlider = s => Math.round((Math.log10(clamp(s, MIN_SCALE, 10)) + 2) / 3 * 1000);
  const sliderToScale = v => Math.pow(10, v / 1000 * 3 - 2);

  /* ---------------- render ---------------- */
  let raf = 0;
  const render = () => { if (!raf) raf = requestAnimationFrame(draw); };

  function draw() {
    raf = 0;
    const sx = S.scale * (S.flipX ? -1 : 1);
    const sy = S.scale * (S.flipY ? -1 : 1);
    el.art.style.transform =
      `translate(-50%,-50%) translate(${S.x}px,${S.y}px) rotate(${S.rot}deg) scale(${sx},${sy})`;

    const f = [];
    if (S.gray || S.line) f.push('grayscale(1)');
    if (S.invert) f.push('invert(1)');
    const c = S.contrast * (S.line ? 2.2 : 1);
    if (c !== 100) f.push(`contrast(${c}%)`);
    const b = S.bright * (S.line ? 1.12 : 1);
    if (b !== 100) f.push(`brightness(${b}%)`);
    el.art.style.filter = f.join(' ') || 'none';
    el.art.style.opacity = S.opacity / 100;

    el.stage.dataset.bg = S.bg;
    el.grid.dataset.grid = S.grid;
    el.grid.classList.toggle('has-cross', S.cross);
    el.grid.style.setProperty('--gc', S.gridColor);
    const g = S.grid === 'fine'
      ? (pxPerMm ? pxPerMm * 5 : 20)
      : (pxPerMm ? pxPerMm * 10 : 40);
    el.grid.style.setProperty('--g', g + 'px');

    syncReadouts();
  }

  function syncReadouts() {
    const pct = fmt(S.scale * 100, S.scale < 0.1 ? 1 : 0) + '%';
    const deg = fmt(S.rot, 1) + '°';
    el.roScale.textContent = pct;
    el.roRot.textContent = deg;
    el.oScale.textContent = pct;
    el.oRot.textContent = deg;
    if (document.activeElement !== el.rScale) el.rScale.value = scaleToSlider(S.scale);
    if (document.activeElement !== el.rRot) el.rRot.value = S.rot;
    setRangeFill(el.rScale); setRangeFill(el.rRot);

    const hasMm = pxPerMm > 0 && iw > 0;
    $$('.ro-mm').forEach(n => n.hidden = !hasMm);
    el.mmInputs.classList.toggle('is-disabled', !hasMm);
    if (hasMm) {
      const wmm = iw * S.scale / pxPerMm, hmm = ih * S.scale / pxPerMm;
      el.roMm.textContent = `${fmt(wmm, 0)}×${fmt(hmm, 0)}mm`;
      if (document.activeElement !== el.mmW) el.mmW.value = fmt(wmm, 1);
      if (document.activeElement !== el.mmH) el.mmH.value = fmt(hmm, 1);
    } else {
      el.mmW.value = ''; el.mmH.value = '';
    }
    el.calibLabel.textContent = pxPerMm ? '画面の校正をやり直す' : '実寸で合わせる（画面を校正）';
    el.gridHint.textContent = pxPerMm
      ? '1マス = あらく 10mm / こまかく 5mm（校正済み）'
      : '校正すると 1マス = 10mm / 5mm になります。';
  }

  function syncControls() {
    el.rContrast.value = S.contrast; el.oContrast.textContent = S.contrast + '%';
    el.rBright.value = S.bright; el.oBright.textContent = S.bright + '%';
    el.rOpacity.value = S.opacity; el.oOpacity.textContent = S.opacity + '%';
    [el.rContrast, el.rBright, el.rOpacity].forEach(setRangeFill);
    el.sGray.checked = S.gray; el.sInvert.checked = S.invert; el.sLine.checked = S.line;
    el.sTwist.checked = S.twist; el.sCross.checked = S.cross;
    el.tFlipH.setAttribute('aria-pressed', S.flipX);
    el.tFlipV.setAttribute('aria-pressed', S.flipY);
    setSeg('#segBg', S.bg); setSeg('#segGrid', S.grid); setSeg('#segCorner', S.corner);
    $$('#swGrid button').forEach(b => b.classList.toggle('is-on', b.dataset.v === S.gridColor));
    el.unlock.dataset.corner = S.corner;
    el.lockCornerTxt.textContent = { tl: '左上', tr: '右上', bl: '左下', br: '右下' }[S.corner];
  }
  const setSeg = (sel, v) => $$(sel + ' button').forEach(b => b.classList.toggle('is-on', b.dataset.v === v));

  /* ---------------- transform ops ---------------- */
  // 点 (px,py)（画面中心基準）を中心に k 倍・da 度回転
  function zoomAt(px, py, k, da = 0) {
    const ns = clamp(S.scale * k, MIN_SCALE, MAX_SCALE);
    k = ns / S.scale;
    const r = da * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    const dx = S.x - px, dy = S.y - py;
    S.x = px + k * (dx * cos - dy * sin);
    S.y = py + k * (dx * sin + dy * cos);
    S.scale = ns;
    S.rot = normDeg(S.rot + da);
  }

  function rotatedBox() {
    const r = S.rot * Math.PI / 180;
    const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    return { w: iw * c + ih * s, h: iw * s + ih * c };
  }

  function fit(mode = 'all', animate = true) {
    if (!iw) return;
    const { w, h } = stageSize();
    const b = rotatedBox();
    const sc = mode === 'width' ? w / b.w : Math.min(w / b.w, h / b.h) * 0.92;
    S.scale = clamp(sc, MIN_SCALE, MAX_SCALE);
    S.x = 0; S.y = 0;
    commit(animate);
  }

  function commit(animate = false) {
    if (animate) {
      el.art.style.transition = 'transform .45s cubic-bezier(.2,.8,.2,1)';
      clearTimeout(commit.t);
      commit.t = setTimeout(() => el.art.style.transition = '', 480);
    }
    render();
    saveState();
  }

  /* ---------------- gestures ---------------- */
  const pointers = new Map();
  let gesture = null;

  function pairInfo() {
    const [a, b] = [...pointers.values()];
    const { w, h } = stageSize();
    return {
      mx: (a.x + b.x) / 2 - w / 2,
      my: (a.y + b.y) / 2 - h / 2,
      d: Math.hypot(b.x - a.x, b.y - a.y),
      a: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI,
    };
  }

  el.stage.addEventListener('pointerdown', e => {
    if (locked) return;
    el.stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.art.style.transition = '';
    el.body.classList.add('is-gesturing');
    dismissCoach();
    gesture = pointers.size >= 2 ? { pair: pairInfo(), snapAcc: 0 } : { last: { x: e.clientX, y: e.clientY } };
  });

  el.stage.addEventListener('pointermove', e => {
    if (locked || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2 && gesture && gesture.pair) {
      const p = pairInfo(), q = gesture.pair;
      const k = q.d > 0 ? p.d / q.d : 1;
      let da = S.twist ? normDeg(p.a - q.a) : 0;
      // 0/90/180°付近では軽く吸着
      if (da) {
        const target = Math.round((S.rot + da) / 90) * 90;
        const off = S.rot + da - target;
        if (Math.abs(off) < 2.5 && Math.abs(gesture.snapAcc + da) < 6) {
          gesture.snapAcc += da;
          da = target - S.rot;
        } else gesture.snapAcc = 0;
      }
      S.x += p.mx - q.mx; S.y += p.my - q.my;
      zoomAt(p.mx, p.my, k, da);
      gesture.pair = p;
      render();
    } else if (pointers.size === 1 && gesture && gesture.last) {
      S.x += e.clientX - gesture.last.x;
      S.y += e.clientY - gesture.last.y;
      gesture.last = { x: e.clientX, y: e.clientY };
      render();
    }
  });

  const endPointer = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      const [p] = pointers.values();
      gesture = { last: { ...p } };
    } else if (pointers.size >= 2) {
      gesture = { pair: pairInfo(), snapAcc: 0 };
    } else {
      gesture = null;
      el.body.classList.remove('is-gesturing');
      saveState();
    }
  };
  el.stage.addEventListener('pointerup', endPointer);
  el.stage.addEventListener('pointercancel', endPointer);

  el.stage.addEventListener('wheel', e => {
    if (locked) return;
    e.preventDefault();
    const { w, h } = stageSize();
    const px = e.clientX - w / 2, py = e.clientY - h / 2;
    if (e.shiftKey || e.altKey) zoomAt(px, py, 1, e.deltaY > 0 ? 1 : -1);
    else zoomAt(px, py, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    render(); saveState();
  }, { passive: false });

  // iOS Safari のピンチズーム・ダブルタップズーム・スクロールを封じる
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t =>
    document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', e => {
    if (locked || !e.target.closest('.panes, .welcome, .sheet__card, input[type="range"]')) e.preventDefault();
  }, { passive: false });
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

  /* ---------------- image loading ---------------- */
  async function loadBlob(blob, restored = null) {
    if (!blob || !/^image\//.test(blob.type || 'image/')) { toast('画像ファイルを選んでください'); return; }
    try {
      blob = await downscale(blob);
      const url = URL.createObjectURL(blob);
      const img = el.art;
      img.src = url;
      await img.decode();
      if (imageURL) URL.revokeObjectURL(imageURL);
      imageURL = url;
      imageBlob = blob;
      iw = img.naturalWidth; ih = img.naturalHeight;
      img.style.width = iw + 'px';
      img.style.height = ih + 'px';

      enterEditor();
      if (restored) {
        Object.assign(S, defaults, restored);
        syncControls(); render();
      } else {
        S.x = 0; S.y = 0; S.rot = 0; S.flipX = false; S.flipY = false;
        syncControls();
        fit('all', false);
        db.set('image', blob);
        showCoach();
      }
    } catch (err) {
      console.error(err);
      toast('画像を読み込めませんでした');
    }
  }

  async function downscale(blob) {
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch { return blob; }
    const m = Math.max(bmp.width, bmp.height);
    if (m <= MAX_SIDE) { bmp.close && bmp.close(); return blob; }
    const k = MAX_SIDE / m;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    return new Promise(res => c.toBlob(b => res(b || blob), 'image/png'));
  }

  function enterEditor() {
    el.welcome.hidden = true;
    el.stage.hidden = false;
    el.topbar.hidden = false;
    el.panel.hidden = false;
    el.body.classList.add('is-editing');
  }

  function pickImage() {
    el.file.value = '';
    el.file.click();
  }

  el.file.addEventListener('change', () => { const f = el.file.files[0]; if (f) loadBlob(f); });

  // drag & drop
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if (!locked && [...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; el.dragOver.hidden = false; } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; el.dragOver.hidden = true; } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; el.dragOver.hidden = true;
    if (locked) return;
    const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
    if (f) loadBlob(f);
  });
  // paste
  window.addEventListener('paste', e => {
    if (locked) return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) loadBlob(item.getAsFile());
  });

  // 前回のつづき
  (async () => {
    const [blob, st] = await Promise.all([db.get('image'), db.get('state')]);
    if (!blob) return;
    el.resumeThumb.src = URL.createObjectURL(blob);
    el.resume.hidden = false;
    el.resume.onclick = () => loadBlob(blob, st || {});
  })();

  /* ---------------- coach mark ---------------- */
  function showCoach() {
    if (localStorage.getItem('toreeeeees.coached')) return;
    el.coach.hidden = false;
    setTimeout(dismissCoach, 4200);
  }
  function dismissCoach() {
    if (el.coach.hidden || el.coach.classList.contains('is-out')) return;
    localStorage.setItem('toreeeeees.coached', '1');
    el.coach.classList.add('is-out');
    setTimeout(() => { el.coach.hidden = true; el.coach.classList.remove('is-out'); }, 500);
  }

  /* ---------------- panel controls ---------------- */
  // tabs
  const tabs = $$('.tab');
  tabs.forEach((t, i) => t.addEventListener('click', () => {
    el.panel.classList.remove('is-collapsed');
    tabs.forEach(x => { x.classList.toggle('is-on', x === t); x.setAttribute('aria-selected', x === t); });
    $$('.pane').forEach(p => { const on = p.dataset.pane === t.dataset.tab; p.hidden = !on; p.classList.toggle('is-on', on); });
    $('.tabs__ink').style.transform = `translateX(${i * 100}%)`;
  }));
  $('#panelToggle').addEventListener('click', () => el.panel.classList.toggle('is-collapsed'));

  el.rScale.addEventListener('input', () => {
    const ns = sliderToScale(+el.rScale.value);
    zoomAt(0, 0, ns / S.scale);
    render(); saveState();
  });
  el.rRot.addEventListener('input', () => {
    zoomAt(0, 0, 1, +el.rRot.value - S.rot);
    render(); saveState();
  });
  [el.rScale, el.rRot].forEach(r => r.addEventListener('change', () => r.blur()));

  const bindRange = (r, o, key) => r.addEventListener('input', () => {
    S[key] = +r.value; o.textContent = r.value + '%'; setRangeFill(r); render(); saveState();
  });
  bindRange(el.rContrast, el.oContrast, 'contrast');
  bindRange(el.rBright, el.oBright, 'bright');
  bindRange(el.rOpacity, el.oOpacity, 'opacity');

  const bindCheck = (c, key) => c.addEventListener('change', () => { S[key] = c.checked; render(); saveState(); });
  bindCheck(el.sGray, 'gray'); bindCheck(el.sInvert, 'invert'); bindCheck(el.sLine, 'line');
  bindCheck(el.sTwist, 'twist'); bindCheck(el.sCross, 'cross');

  const bindSeg = (sel, key, after) => $$(sel + ' button').forEach(b => b.addEventListener('click', () => {
    S[key] = b.dataset.v; setSeg(sel, S[key]); after && after(); render(); saveState();
  }));
  bindSeg('#segBg', 'bg');
  bindSeg('#segGrid', 'grid');
  bindSeg('#segCorner', 'corner', syncControls);
  $$('#swGrid button').forEach(b => b.addEventListener('click', () => {
    S.gridColor = b.dataset.v; syncControls(); render(); saveState();
  }));

  $('#tFit').addEventListener('click', () => fit('all'));
  $('#tFitW').addEventListener('click', () => fit('width'));
  $('#tRot90').addEventListener('click', () => { zoomAt(0, 0, 1, 90 - (((S.rot % 90) + 90) % 90 || 0)); commit(true); });
  el.tFlipH.addEventListener('click', () => { S.flipX = !S.flipX; syncControls(); commit(true); });
  el.tFlipV.addEventListener('click', () => { S.flipY = !S.flipY; syncControls(); commit(true); });
  $('#btnReset').addEventListener('click', () => {
    S.rot = 0; S.flipX = false; S.flipY = false;
    syncControls(); fit('all');
    toast('位置と角度をリセットしました');
  });
  $('#btnNew').addEventListener('click', pickImage);

  const mmInput = (input, isW) => input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (!(v > 0) || !pxPerMm) return;
    const ns = v * pxPerMm / (isW ? iw : ih);
    zoomAt(0, 0, ns / S.scale);
    render(); saveState();
  });
  mmInput(el.mmW, true); mmInput(el.mmH, false);
  [el.mmW, el.mmH].forEach(i => {
    i.addEventListener('blur', syncReadouts);
    i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
  });

  /* ---------------- calibration ---------------- */
  let calPpm = 6;
  const guessPpm = () => matchMedia('(pointer: coarse)').matches ? 6.1 : 3.78;

  function drawCard() {
    const portrait = el.cardWrap.clientWidth < CARD_W * calPpm + 20;
    const w = (portrait ? CARD_H : CARD_W) * calPpm;
    const h = (portrait ? CARD_W : CARD_H) * calPpm;
    el.card.style.width = w + 'px';
    el.card.style.height = h + 'px';
    el.card.style.setProperty('--ppm', calPpm + 'px');
    el.card.classList.toggle('is-portrait', portrait);
    $('#calibEdge').textContent = portrait ? 'カードの短い辺（54mm）' : 'カードの長い辺（85.6mm）';
    el.rCalib.value = calPpm; setRangeFill(el.rCalib);
    el.calibVal.textContent = `${calPpm.toFixed(2)} px/mm ・ ${(calPpm * 25.4).toFixed(0)} ppi`;
  }
  function openCalib() {
    calPpm = pxPerMm || guessPpm();
    el.calib.hidden = false;
    requestAnimationFrame(drawCard);
  }
  const closeCalib = () => { el.calib.hidden = true; };
  $('#btnCalib').addEventListener('click', openCalib);
  $('#calibClose').addEventListener('click', closeCalib);
  el.calib.addEventListener('click', e => { if (e.target === el.calib) closeCalib(); });
  el.rCalib.addEventListener('input', () => { calPpm = +el.rCalib.value; drawCard(); });
  const nudge = d => { calPpm = clamp(+(calPpm + d).toFixed(2), 2, 12); drawCard(); };
  let nudgeTimer = 0;
  [['#calMinus', -0.02], ['#calPlus', 0.02]].forEach(([s, d]) => {
    const b = $(s);
    const stop = () => { clearInterval(nudgeTimer); clearTimeout(nudgeTimer); };
    b.addEventListener('pointerdown', () => { nudge(d); nudgeTimer = setTimeout(() => nudgeTimer = setInterval(() => nudge(d), 50), 350); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, stop));
  });
  $('#calibOk').addEventListener('click', () => {
    pxPerMm = calPpm;
    localStorage.setItem('toreeeeees.ppm', pxPerMm);
    closeCalib(); render();
    toast('校正しました。mmでサイズを指定できます');
  });
  $('#calibClear').addEventListener('click', () => {
    pxPerMm = 0;
    localStorage.removeItem('toreeeeees.ppm');
    closeCalib(); render();
    toast('校正をリセットしました');
  });
  window.addEventListener('resize', () => { if (!el.calib.hidden) drawCard(); });

  /* ---------------- lock ---------------- */
  let wakeLock = null;
  async function requestWake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch { /* not allowed */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (locked && document.visibilityState === 'visible' && !wakeLock) requestWake();
  });

  let freshTimer = 0;
  async function lock() {
    if (locked) return;
    locked = true;
    pointers.clear(); gesture = null;
    el.body.classList.remove('is-gesturing');
    document.activeElement && document.activeElement.blur();
    el.body.classList.add('is-locked');
    el.lock.hidden = false;
    el.lock.classList.add('is-fresh');
    clearTimeout(freshTimer);
    freshTimer = setTimeout(() => el.lock.classList.remove('is-fresh'), 3200);
    saveState();

    const de = document.documentElement;
    try {
      if (de.requestFullscreen && !document.fullscreenElement) await de.requestFullscreen({ navigationUI: 'hide' });
      else if (de.webkitRequestFullscreen) de.webkitRequestFullscreen();
    } catch { /* iPhone Safari など非対応 */ }
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock(screen.orientation.type);
      }
    } catch { /* 非対応 */ }
    requestWake();
    if (navigator.vibrate) navigator.vibrate(18);
  }

  // 解除した指を離したときのクリックが下のボタンに届かないようにする
  let suppressClickUntil = 0;
  window.addEventListener('click', e => {
    if (performance.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  function unlock() {
    if (!locked) return;
    locked = false;
    suppressClickUntil = performance.now() + 700;
    el.body.classList.remove('is-locked');
    el.lock.hidden = true;
    el.unlock.classList.remove('is-holding');
    try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch { }
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch { }
    if (wakeLock) { wakeLock.release().catch(() => { }); wakeLock = null; }
    if (navigator.vibrate) navigator.vibrate([12, 40, 12]);
    toast('ロックを解除しました');
  }

  $('#btnLock').addEventListener('click', lock);

  // ロック中は全ての入力を握りつぶす
  const swallow = e => { if (e.target.closest && e.target.closest('#unlock')) return; e.preventDefault(); e.stopPropagation(); };
  ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'click', 'wheel']
    .forEach(t => el.lock.addEventListener(t, swallow, { passive: false }));

  // 長押しで解除
  let holdTimer = 0;
  const holdStart = e => {
    e.preventDefault(); e.stopPropagation();
    el.unlock.style.setProperty('--hold', HOLD_MS + 'ms');
    el.unlock.classList.add('is-holding');
    clearTimeout(holdTimer);
    holdTimer = setTimeout(unlock, HOLD_MS);
  };
  const holdEnd = e => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    clearTimeout(holdTimer);
    el.unlock.classList.remove('is-holding');
  };
  el.unlock.addEventListener('pointerdown', holdStart);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.unlock.addEventListener(t, holdEnd));
  el.unlock.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  el.unlock.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });

  // キーボード（PC）
  window.addEventListener('keydown', e => {
    if (e.target.matches('input[type="number"]')) return;
    if (locked) {
      if (e.key === 'Escape') { e.preventDefault(); }
      return;
    }
    if (el.stage.hidden) return;
    const step = e.shiftKey ? 10 : 2;
    switch (e.key) {
      case 'l': case 'L': lock(); break;
      case 'f': case 'F': fit('all'); break;
      case '+': case '=': zoomAt(0, 0, 1.05); commit(); break;
      case '-': case '_': zoomAt(0, 0, 1 / 1.05); commit(); break;
      case 'ArrowLeft': S.x -= step; commit(); break;
      case 'ArrowRight': S.x += step; commit(); break;
      case 'ArrowUp': S.y -= step; commit(); break;
      case 'ArrowDown': S.y += step; commit(); break;
      default: return;
    }
    e.preventDefault();
  });

  // 全画面を抜けてもロックは維持（解除は長押しのみ）
  document.addEventListener('fullscreenchange', () => {
    if (locked && !document.fullscreenElement) toast('全画面を終了しました（ロック中）');
  });

  /* ---------------- init ---------------- */
  syncControls();
  render();
  $$('input[type="range"]').forEach(setRangeFill);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
})();
