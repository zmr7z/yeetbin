(() => {
  const { Engine, Render, Runner, Bodies, Body, Composite, Events, Query, World } = Matter;

  const canvas = document.getElementById("game");
  const scoreEl = document.getElementById("score");
  const timerEl = document.getElementById("timer");
  const hintEl = document.getElementById("hint");
  const titleEl = document.getElementById("title");
  const resultEl = document.getElementById("result");
  const finalScoreEl = document.getElementById("final-score");
  const flavorEl = document.getElementById("flavor");
  const resultTitleEl = document.getElementById("result-title");
  const leadEl = document.getElementById("lead");

  const ROUND_SEC = 30;
  const flavors = [
    "荷主「これ届いてる？」 物理「知らん」",
    "配達員の腕より、重力の方が主役だった。",
    "段ボールの魂が叫んでいる。YEET。",
    "丁寧な扱い？ そんなオプションはない。",
    "トラック「もう積みすぎだぞ」 君「まだいける」",
  ];

  const isCoarse = () => window.matchMedia("(pointer: coarse)").matches;
  const controlHint = () =>
    isCoarse() ? "荷物をつまんでフリック！" : "荷物をドラッグして投げる！（マウス）";
  const throwHint = () => (isCoarse() ? "離してぶん投げる！" : "離すと飛びます！");

  let W = 0;
  let H = 0;
  let engine;
  let render;
  let runner;
  let score = 0;
  let timeLeft = ROUND_SEC;
  let playing = false;
  let spawnTimer = 0;
  let clockId = null;
  let grabbed = null;
  let grabOffset = { x: 0, y: 0 };
  let scoredIds = new Set();
  let packageCount = 0;
  let dragSamples = [];
  let pointerId = null;

  function size() {
    const app = document.getElementById("app");
    const rect = app.getBoundingClientRect();
    W = Math.max(1, Math.floor(rect.width));
    H = Math.max(1, Math.floor(rect.height));
    canvas.width = W;
    canvas.height = H;
    if (render) {
      render.options.width = W;
      render.options.height = H;
      render.canvas.width = W;
      render.canvas.height = H;
      render.bounds.max.x = W;
      render.bounds.max.y = H;
    }
  }

  function pointerPos(e) {
    const src = e.touches && e.touches[0] ? e.touches[0] : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / Math.max(1, r.width);
    const sy = canvas.height / Math.max(1, r.height);
    return {
      x: (src.clientX - r.left) * sx,
      y: (src.clientY - r.top) * sy,
    };
  }

  function packages() {
    return Composite.allBodies(engine.world).filter((b) => b.label === "package");
  }

  function pickPackage(pos) {
    // Prefer top-most (last spawned) hit
    const hits = Query.point(packages(), pos);
    if (hits.length) return hits[hits.length - 1];
    // Generous click target for PC
    let best = null;
    let bestDist = 36;
    for (const b of packages()) {
      const dx = b.position.x - pos.x;
      const dy = b.position.y - pos.y;
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  function releaseGrab(pos) {
    canvas.classList.remove("grabbing");
    if (!grabbed) {
      pointerId = null;
      return;
    }
    const body = grabbed;
    let vx = 0;
    let vy = 0;
    if (dragSamples.length >= 2) {
      const a = dragSamples[0];
      const b = dragSamples[dragSamples.length - 1];
      const dt = Math.max(0.016, (b.t - a.t) / 1000);
      vx = (b.x - a.x) / dt;
      vy = (b.y - a.y) / dt;
    } else {
      vx = body.velocity.x;
      vy = body.velocity.y;
    }
    // Keep throws playful but not screen-exiting
    const maxSpeed = isCoarse() ? 22 : 18;
    const sp = Math.hypot(vx, vy);
    if (sp > maxSpeed) {
      vx = (vx / sp) * maxSpeed;
      vy = (vy / sp) * maxSpeed;
    }
    const scale = isCoarse() ? 1.15 : 1.05;
    Body.setStatic(body, false);
    Body.setVelocity(body, { x: vx * scale, y: vy * scale });
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.35);
    grabbed = null;
    grabOffset = { x: 0, y: 0 };
    dragSamples = [];
    pointerId = null;
    if (playing) hintEl.textContent = "荷台の光ってるとこへ！";
  }

  function onPointerDown(e) {
    if (!playing || !engine) return;
    if (e.button != null && e.button !== 0) return;
    const pos = pointerPos(e);
    const body = pickPackage(pos);
    if (!body) return;
    e.preventDefault();
    if (e.pointerId != null && canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
    }
    pointerId = e.pointerId != null ? e.pointerId : "touch";
    grabbed = body;
    grabOffset = { x: body.position.x - pos.x, y: body.position.y - pos.y };
    dragSamples = [{ x: pos.x, y: pos.y, t: performance.now() }];
    Body.setStatic(body, true);
    Body.setVelocity(body, { x: 0, y: 0 });
    canvas.classList.add("grabbing");
    hintEl.textContent = throwHint();
  }

  function onPointerMove(e) {
    if (!grabbed) return;
    if (pointerId != null && e.pointerId != null && e.pointerId !== pointerId) return;
    e.preventDefault();
    const pos = pointerPos(e);
    const x = pos.x + grabOffset.x;
    const y = pos.y + grabOffset.y;
    Body.setPosition(grabbed, { x, y });
    Body.setVelocity(grabbed, { x: 0, y: 0 });
    const now = performance.now();
    dragSamples.push({ x: pos.x, y: pos.y, t: now });
    // keep ~100ms of samples for throw vector
    while (dragSamples.length > 1 && now - dragSamples[0].t > 100) dragSamples.shift();
    if (dragSamples.length > 12) dragSamples.shift();
  }

  function onPointerUp(e) {
    if (pointerId != null && e.pointerId != null && e.pointerId !== pointerId) return;
    if (grabbed) e.preventDefault();
    releaseGrab(pointerPos(e));
  }

  function bindPointer() {
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function syncLead() {
    if (!leadEl) return;
    leadEl.textContent = isCoarse()
      ? "物理が狂った荷物を、トラックの荷台へぶち込め。スマホでフリック。"
      : "物理が狂った荷物を、トラックの荷台へぶち込め。PCはマウス、スマホはフリック。";
  }

  function makeWorld() {
    size();
    if (grabbed) {
      try {
        Body.setStatic(grabbed, false);
      } catch (_) {
        /* ignore */
      }
    }
    grabbed = null;
    pointerId = null;
    dragSamples = [];
    canvas.classList.remove("grabbing");

    engine = Engine.create({ gravity: { x: 0, y: 1.35 } });
    render = Render.create({
      canvas,
      engine,
      options: {
        width: W,
        height: H,
        wireframes: false,
        background: "transparent",
        pixelRatio: 1,
      },
    });

    const wallOpts = { isStatic: true, render: { visible: false } };
    const floorY = H - 18;
    const ground = Bodies.rectangle(W / 2, floorY, W + 80, 36, {
      ...wallOpts,
      render: { fillStyle: "#3a2718", visible: true },
      friction: 0.9,
      label: "ground",
    });
    const left = Bodies.rectangle(-20, H / 2, 40, H * 2, wallOpts);
    const right = Bodies.rectangle(W + 20, H / 2, 40, H * 2, wallOpts);

    const tw = Math.min(170, Math.max(120, W * 0.28));
    const th = Math.min(120, H * 0.18);
    const tx = W - tw * 0.55;
    const ty = floorY - th * 0.55 - 8;

    const truckBed = Bodies.rectangle(tx, ty + 18, tw * 0.92, th * 0.55, {
      isStatic: true,
      chamfer: { radius: 6 },
      render: { fillStyle: "#2f6b2a" },
      friction: 0.85,
      label: "truck",
    });
    const truckCab = Bodies.rectangle(tx + tw * 0.28, ty - 10, tw * 0.38, th * 0.42, {
      isStatic: true,
      chamfer: { radius: 8 },
      render: { fillStyle: "#245520" },
      label: "truck",
    });
    const truckWheel1 = Bodies.circle(tx - tw * 0.28, floorY - 14, 14, {
      isStatic: true,
      render: { fillStyle: "#1a1208" },
    });
    const truckWheel2 = Bodies.circle(tx + tw * 0.22, floorY - 14, 14, {
      isStatic: true,
      render: { fillStyle: "#1a1208" },
    });

    const truckSensor = Bodies.rectangle(tx - 8, ty - 8, tw * 0.62, th * 0.7, {
      isStatic: true,
      isSensor: true,
      render: { fillStyle: "rgba(232,163,23,0.18)" },
      label: "goal",
    });

    const ramp = Bodies.rectangle(W * 0.42, floorY - 10, W * 0.35, 16, {
      isStatic: true,
      angle: -0.12,
      render: { fillStyle: "#6b4a2e" },
      friction: 0.6,
    });

    Composite.add(engine.world, [
      ground,
      left,
      right,
      truckBed,
      truckCab,
      truckWheel1,
      truckWheel2,
      truckSensor,
      ramp,
    ]);

    Events.on(engine, "collisionStart", (e) => {
      if (!playing) return;
      for (const pair of e.pairs) {
        const a = pair.bodyA;
        const b = pair.bodyB;
        const pkg = a.label === "package" ? a : b.label === "package" ? b : null;
        const goal = a.label === "goal" || b.label === "goal";
        if (pkg && goal && !scoredIds.has(pkg.id) && pkg !== grabbed) {
          scoredIds.add(pkg.id);
          score += 1;
          scoreEl.textContent = String(score);
          pulseHint(`+1 配達！（${score}）`);
          Body.setVelocity(pkg, { x: pkg.velocity.x * 0.3, y: Math.min(pkg.velocity.y, 2) });
          pkg.render.strokeStyle = "#e8a317";
          pkg.render.lineWidth = 3;
        }
      }
    });

    Events.on(engine, "afterUpdate", () => {
      if (!playing) return;
      for (const b of packages()) {
        if (b === grabbed) continue;
        if (b.position.y > H + 120 || b.position.x < -120 || b.position.x > W + 120) {
          Composite.remove(engine.world, b);
        }
      }
    });

    Render.run(render);
    runner = Runner.create();
    Runner.run(runner, engine);
  }

  function packageColors() {
    const palette = ["#e8a317", "#c45c26", "#f3e6c8", "#1f6f6a", "#d97757", "#8bbf5c"];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  function spawnPackage() {
    if (!playing) return;
    packageCount += 1;
    const size = 28 + Math.random() * 22;
    const x = 40 + Math.random() * (W * 0.45);
    const y = 40 + Math.random() * 60;
    const weird = Math.random() < 0.22;
    let body;
    if (weird) {
      body = Bodies.circle(x, y, size * 0.45, {
        restitution: 0.85,
        friction: 0.2,
        density: 0.0012,
        label: "package",
        sleepThreshold: 60,
        render: { fillStyle: packageColors(), strokeStyle: "#1a1208", lineWidth: 2 },
      });
    } else {
      body = Bodies.rectangle(x, y, size, size * (0.75 + Math.random() * 0.4), {
        chamfer: { radius: 4 },
        restitution: 0.35 + Math.random() * 0.35,
        friction: 0.35,
        density: 0.0015,
        angle: (Math.random() - 0.5) * 0.6,
        label: "package",
        sleepThreshold: 60,
        render: { fillStyle: packageColors(), strokeStyle: "#1a1208", lineWidth: 2 },
      });
    }
    Body.setVelocity(body, { x: (Math.random() - 0.3) * 2, y: Math.random() * 1.5 });
    Composite.add(engine.world, body);
  }

  function clearPackages() {
    for (const b of packages()) Composite.remove(engine.world, b);
  }

  function pulseHint(text) {
    hintEl.textContent = text;
  }

  function startRound() {
    titleEl.classList.add("hidden");
    resultEl.classList.add("hidden");
    score = 0;
    timeLeft = ROUND_SEC;
    scoredIds = new Set();
    packageCount = 0;
    playing = true;
    scoreEl.textContent = "0";
    timerEl.textContent = String(timeLeft);
    hintEl.textContent = controlHint();
    canvas.classList.add("playable");
    clearPackages();
    spawnPackage();
    spawnPackage();

    if (clockId) clearInterval(clockId);
    clockId = setInterval(() => {
      if (!playing) return;
      timeLeft -= 1;
      timerEl.textContent = String(Math.max(0, timeLeft));
      if (timeLeft <= 0) endRound();
    }, 1000);

    if (spawnTimer) clearInterval(spawnTimer);
    spawnTimer = setInterval(() => {
      if (!playing) return;
      if (packages().length < 7) spawnPackage();
    }, 900);
  }

  function endRound() {
    playing = false;
    if (grabbed) releaseGrab({ x: 0, y: 0 });
    canvas.classList.remove("playable", "grabbing");
    if (clockId) clearInterval(clockId);
    if (spawnTimer) clearInterval(spawnTimer);
    finalScoreEl.textContent = String(score);
    resultTitleEl.textContent = score >= 12 ? "伝説の乱暴配達" : score >= 7 ? "そこそこ届いた" : "荷崩れ事故";
    flavorEl.textContent = flavors[Math.floor(Math.random() * flavors.length)];
    resultEl.classList.remove("hidden");
    hintEl.textContent = "タイムアップ";
  }

  function quitToTitle() {
    if (grabbed) {
      try {
        Body.setStatic(grabbed, false);
      } catch (_) {
        /* ignore */
      }
      grabbed = null;
      pointerId = null;
      dragSamples = [];
      canvas.classList.remove("grabbing");
    }
    playing = false;
    if (clockId) clearInterval(clockId);
    if (spawnTimer) clearInterval(spawnTimer);
    clockId = null;
    spawnTimer = null;
    canvas.classList.remove("playable", "grabbing");
    resultEl.classList.add("hidden");
    titleEl.classList.remove("hidden");
    hintEl.textContent = controlHint();
    score = 0;
    timeLeft = ROUND_SEC;
    scoreEl.textContent = "0";
    timerEl.textContent = String(ROUND_SEC);
    clearPackages();
  }

  function share() {
    const text = `ぶっ飛び宅配 YEET便で ${score} 件届けた（物理は礼儀を知らない）\n${location.href}`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener");
  }

  function rebuild() {
    if (grabbed) {
      try {
        Body.setStatic(grabbed, false);
      } catch (_) {
        /* ignore */
      }
      grabbed = null;
    }
    if (runner) Runner.stop(runner);
    if (render) Render.stop(render);
    if (engine) {
      World.clear(engine.world, false);
      Engine.clear(engine);
    }
    makeWorld();
  }

  document.getElementById("btn-start").addEventListener("click", () => startRound());
  document.getElementById("btn-again").addEventListener("click", () => {
    rebuild();
    startRound();
  });
  document.getElementById("btn-share").addEventListener("click", share);

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "Escape") {
      e.preventDefault();
      if (playing || !resultEl.classList.contains("hidden")) {
        quitToTitle();
      }
      return;
    }
    if (e.code === "Enter" || e.code === "Space") {
      if (!titleEl.classList.contains("hidden")) {
        e.preventDefault();
        startRound();
      } else if (!resultEl.classList.contains("hidden")) {
        e.preventDefault();
        rebuild();
        startRound();
      }
    }
    if (e.code === "KeyR" && playing) {
      e.preventDefault();
      rebuild();
      startRound();
    }
  });

  document.getElementById("btn-quit")?.addEventListener("click", () => quitToTitle());

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const wasPlaying = playing;
      const keepScore = score;
      const keepTime = timeLeft;
      rebuild();
      syncLead();
      if (wasPlaying) {
        playing = true;
        score = keepScore;
        timeLeft = keepTime;
        scoreEl.textContent = String(score);
        timerEl.textContent = String(timeLeft);
        hintEl.textContent = controlHint();
        canvas.classList.add("playable");
        spawnPackage();
      }
    }, 120);
  });

  document.body.addEventListener(
    "touchmove",
    (e) => {
      if (e.target === canvas || canvas.contains(e.target)) e.preventDefault();
    },
    { passive: false }
  );

  syncLead();
  hintEl.textContent = controlHint();
  makeWorld();
  bindPointer();
})();
