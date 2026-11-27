(() => {
  const { Engine, Render, Runner, Bodies, Body, Composite, Events, Mouse, MouseConstraint, World } =
    Matter;

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
  let mouse;
  let mouseConstraint;
  let truckSensor;
  let ground;
  let score = 0;
  let timeLeft = ROUND_SEC;
  let playing = false;
  let spawnTimer = 0;
  let clockId = null;
  let grabbed = null;
  let scoredIds = new Set();
  let packageCount = 0;
  let dragTrail = [];

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
    if (mouse) {
      // Keep pointer coords aligned with canvas CSS pixels (PC HiDPI fix)
      mouse.pixelRatio = 1;
    }
  }

  function syncLead() {
    if (!leadEl) return;
    leadEl.textContent = isCoarse()
      ? "物理が狂った荷物を、トラックの荷台へぶち込め。スマホでフリック。"
      : "物理が狂った荷物を、トラックの荷台へぶち込め。PCはマウス、スマホはフリック。";
  }

  function makeWorld() {
    size();
    engine = Engine.create({ gravity: { x: 0, y: 1.35 } });
    render = Render.create({
      canvas,
      engine,
      options: {
        width: W,
        height: H,
        wireframes: false,
        background: "transparent",
        // 1 keeps Matter mouse mapping correct on PC retina displays
        pixelRatio: 1,
      },
    });

    const wallOpts = { isStatic: true, render: { visible: false } };
    const floorY = H - 18;
    ground = Bodies.rectangle(W / 2, floorY, W + 80, 36, {
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

    truckSensor = Bodies.rectangle(tx - 8, ty - 8, tw * 0.62, th * 0.7, {
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

    mouse = Mouse.create(canvas);
    mouse.pixelRatio = 1;
    mouse.element.removeEventListener("mousewheel", mouse.mousewheel);
    mouse.element.removeEventListener("DOMMouseScroll", mouse.mousewheel);

    // Slightly snappier grab on mouse (PC), softer on touch
    const fine = !isCoarse();
    mouseConstraint = MouseConstraint.create(engine, {
      mouse,
      constraint: {
        stiffness: fine ? 0.22 : 0.18,
        damping: fine ? 0.1 : 0.12,
        render: { visible: false },
      },
    });
    Composite.add(engine.world, mouseConstraint);
    render.mouse = mouse;

    Events.on(mouseConstraint, "startdrag", (e) => {
      if (!playing) return;
      const body = e.body;
      if (!body || body.label !== "package") {
        mouseConstraint.constraint.bodyB = null;
        mouseConstraint.body = null;
        return;
      }
      grabbed = body;
      dragTrail = [];
      canvas.classList.add("grabbing");
      hintEl.textContent = throwHint();
    });

    Events.on(engine, "afterUpdate", () => {
      if (!playing) return;
      if (grabbed && mouseConstraint.body === grabbed) {
        dragTrail.push({ x: grabbed.velocity.x, y: grabbed.velocity.y, t: performance.now() });
        if (dragTrail.length > 8) dragTrail.shift();
      }
      const bodies = Composite.allBodies(engine.world);
      for (const b of bodies) {
        if (b.label !== "package") continue;
        if (b.position.y > H + 120 || b.position.x < -120 || b.position.x > W + 120) {
          Composite.remove(engine.world, b);
        }
      }
    });

    Events.on(mouseConstraint, "enddrag", () => {
      canvas.classList.remove("grabbing");
      if (!playing) return;
      if (grabbed) {
        const boost = isCoarse() ? 1.55 : 1.75;
        let vx = grabbed.velocity.x;
        let vy = grabbed.velocity.y;
        if (dragTrail.length >= 3) {
          const recent = dragTrail.slice(-3);
          vx = recent.reduce((s, p) => s + p.x, 0) / recent.length;
          vy = recent.reduce((s, p) => s + p.y, 0) / recent.length;
        }
        Body.setVelocity(grabbed, { x: vx * boost, y: vy * boost * 0.95 });
        Body.setAngularVelocity(grabbed, grabbed.angularVelocity + (Math.random() - 0.5) * 0.4);
        grabbed = null;
        dragTrail = [];
        hintEl.textContent = "荷台の光ってるとこへ！";
      }
    });

    Events.on(engine, "collisionStart", (e) => {
      if (!playing) return;
      for (const pair of e.pairs) {
        const a = pair.bodyA;
        const b = pair.bodyB;
        const pkg = a.label === "package" ? a : b.label === "package" ? b : null;
        const goal = a.label === "goal" || b.label === "goal";
        if (pkg && goal && !scoredIds.has(pkg.id)) {
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
        render: { fillStyle: packageColors(), strokeStyle: "#1a1208", lineWidth: 2 },
      });
    }
    Body.setVelocity(body, { x: (Math.random() - 0.3) * 2, y: Math.random() * 1.5 });
    Composite.add(engine.world, body);
  }

  function clearPackages() {
    const bodies = Composite.allBodies(engine.world).filter((b) => b.label === "package");
    for (const b of bodies) Composite.remove(engine.world, b);
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
      const alive = Composite.allBodies(engine.world).filter((b) => b.label === "package").length;
      if (alive < 7) spawnPackage();
    }, 900);
  }

  function endRound() {
    playing = false;
    canvas.classList.remove("playable", "grabbing");
    if (clockId) clearInterval(clockId);
    if (spawnTimer) clearInterval(spawnTimer);
    finalScoreEl.textContent = String(score);
    resultTitleEl.textContent = score >= 12 ? "伝説の乱暴配達" : score >= 7 ? "そこそこ届いた" : "荷崩れ事故";
    flavorEl.textContent = flavors[Math.floor(Math.random() * flavors.length)];
    resultEl.classList.remove("hidden");
    hintEl.textContent = "タイムアップ";
  }

  function share() {
    const text = `ぶっ飛び宅配 YEET便で ${score} 件届けた（物理は礼儀を知らない）\n${location.href}`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener");
  }

  function rebuild() {
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

  // PC shortcuts (does not affect phone)
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
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

  // iOS bounce only when actually touching the canvas
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
})();
