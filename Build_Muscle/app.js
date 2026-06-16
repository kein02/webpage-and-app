// ====== STATE ======
var ST = {
  currentView: "plan",
  workout: null,
  curEx: 0,
  curSet: 0,
  restTimer: null,
  restLeft: 0,
  settings: {},
  filter: "all",
  wristOn: true,
  workoutStart: null,
  soundOn: true
};

// ====== HELPERS ======
function exData(id) { return DATA.EX.find(function(e){return e.id===id;}); }
function mgLabel(mg) { return DATA.LABELS[mg] || "综合"; }
function mgColor(mg) { return DATA.COLORS[mg] || "#4d96ff"; }
function dayRest(s) { if(s<=30) return "快休"; if(s<=45) return "中休"; return s+"秒"; }

// ====== VOICE ======
// 双方案：speechSynthesis (电脑/Edge/iOS) + AudioContext 合成提示音 (小米/QQ/夸克)
var synthSupported = 'speechSynthesis' in window;
var audioCtxSupported = 'AudioContext' in window || 'webkitAudioContext' in window;

function speak(text, cb) {
  if(!ST.soundOn) return cb ? cb() : void 0;
  if(!synthSupported) return cb ? cb() : void 0;

  // 先尝试 speechSynthesis
  try {
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.9;
    u.pitch = 1;
    u.onend = function() { if(cb) cb(); };
    u.onerror = function() {
      // speechSynthesis 失败，降级到 AudioContext 提示音
      playBeep();
      if(cb) cb();
    };
    window.speechSynthesis.speak(u);
  } catch(e) {
    playBeep();
    if(cb) cb();
  }
}

function playBeep(freq, duration) {
  if(!audioCtxSupported) return;
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq || 880;
    osc.type = 'sine';
    gain.gain.value = 0.3;
    osc.start();
    setTimeout(function() {
      osc.stop();
      ctx.close();
    }, duration || 150);
  } catch(e) { /* ignore */ }
}

function clearAllVoice() {
  if(synthSupported) window.speechSynthesis.cancel();
}

window.toggleSound = function() {
  ST.soundOn = !ST.soundOn;
  var btn = document.getElementById("sound-toggle");
  if(btn) btn.textContent = ST.soundOn ? "🔊" : "🔇";
  if(!ST.soundOn) clearAllVoice();
};
function todayStr() { return new Date().toISOString().split("T")[0]; }
function mgTagHTML(mg) {
  var c = mgColor(mg), l = mgLabel(mg);
  return '<span class="mg-tag" style="background:'+c+'22;color:'+c+'">'+l+'</span>';
}
function wristTagHTML(on) {
  if(on) return '<span class="wrist-tag">🛡️ 腕友好</span>';
  return '<span class="wrist-tag no" style="background:#ff6b6b22;color:#ff6b6b">⚠️ 腕负担</span>';
}

// ====== NAVIGATION ======
function navigateTo(view) {
  ST.currentView = view;
  document.querySelectorAll(".view").forEach(function(v){v.classList.remove("active");});
  var t = document.getElementById("view-"+view);
  if(t) t.classList.add("active");
  document.querySelectorAll(".nav-item").forEach(function(i){i.classList.remove("active");});
  var n = document.getElementById("nav-"+view);
  if(n) n.classList.add("active");

  if(view==="plan") renderPlan();
  if(view==="exercise") renderExLibrary();
  if(view==="ex-detail") renderExDetail();
  if(view==="progress") renderProgress();
  if(view==="settings") renderSettings();
}

// View registry
var Views = {
  plan: renderPlan,
  exercise: renderExLibrary,
  "ex-detail": renderExDetail,
  progress: renderProgress,
  settings: renderSettings
};

// ====== PLAN VIEW ======
function getPlanActions(planId) {
  var poolKey = planId;
  var pools = DATA.ACTION_POOLS[poolKey];
  if(!pools) return null;
  var kneeOn = ST.settings.knee !== false;
  var wristOn = ST.wristOn !== false;
  if(kneeOn && wristOn) return pools.wrist;
  if(kneeOn && !wristOn) return pools.normal;
  if(!kneeOn && wristOn) return pools.wrist;
  return pools.normal;
}

function renderPlan() {
  var c = document.getElementById("plan-list");
  if(!c) return;
  var today = new Date().getDay();
  var plan = DATA.PLANS.find(function(p){return p.day===today;});
  if(!plan) plan = DATA.PLANS[0];
  var actions = getPlanActions(plan.id);
  if(!actions) {
    // 降级：使用旧 PLANS 数据
    var totalSets = 0;
    plan.ex.forEach(function(e){totalSets+=e.s;});
    actions = plan.ex;
  }
  var totalSets = 0;
  actions.forEach(function(e){totalSets+=e.s;});

  var html = "";
  // Today header
  html += '<div class="card today-card">';
  html += '<div class="today-tag">今天 · ' + DATA.DAYS[today] + '</div>';
  html += '<h2 class="today-name">' + plan.name + '</h2>';
  html += '<div class="today-meta">' + totalSets + '组 · 约30分钟</div>';
  html += '<div class="ex-cards">';

  actions.forEach(function(ex,i) {
    var ed = exData(ex.eid);
    var col = ed ? mgColor(ed.mg) : "#4d96ff";
    html += '<div class="ex-card" onclick="startWorkoutDynamic(\''+plan.id+'\',\''+ex.n+'\')">';
    html += '<div class="ex-num" style="border-color:'+col+'">'+(i+1)+'</div>';
    html += '<div class="ex-info">';
    html += '<div class="ex-name">'+ex.n+'</div>';
    html += '<div class="ex-detail">'+ex.s+'组 × '+ex.r+'次 · '+dayRest(ex.rest)+'</div>';
    html += '</div>';
    html += '<div class="ex-arrow">›</div>';
    html += '</div>';
  });

  html += '</div>';
  html += '<button class="btn-start" onclick="startWorkoutDynamic(\''+plan.id+'\',\''+actions[0].n+'\')">▶ 开始训练</button>';
  html += '</div>';

  // Week preview
  html += '<div class="card">';
  html += '<h3 class="section-h">本周计划</h3>';
  DATA.PLANS.forEach(function(p) {
    var isToday = p.day === today;
    var acts = getPlanActions(p.id);
    var name = p.name;
    if(acts) {
      var kneeOn = ST.settings.knee !== false;
      var wristOn = ST.wristOn !== false;
      var mode = (!kneeOn && !wristOn) ? "自由组合" : (kneeOn && wristOn ? "双保护" : (kneeOn ? "护膝" : "护腕"));
      name += ' <span style="font-size:11px;color:var(--text2)">(' + mode + ')</span>';
    }
    html += '<div class="day-row' + (isToday?' day-today':'') + '">';
    html += '<span class="day-label">' + DATA.DAYS[p.day] + '</span>';
    html += '<span>' + name + '</span>';
    if(isToday) html += '<span class="today-dot"></span>';
    html += '</div>';
  });
  html += '</div>';

  c.innerHTML = html;
}

window.startWorkoutDynamic = function(planId, exName) {
  var plan = DATA.PLANS.find(function(p){return p.id===planId;});
  if(!plan) return;
  var actions = getPlanActions(planId);
  if(!actions) {
    startWorkout(planId, 0);
    return;
  }
  var idx = actions.findIndex(function(a){return a.n === exName;});
  if(idx < 0) idx = 0;
  ST.workout = plan;
  ST.workoutActions = actions;
  ST.curEx = idx;
  ST.curSet = 0;
  ST.workoutStart = new Date().toISOString();
  clearRest();
  navigateTo("workout");
  renderWorkout();
  var ex = actions[idx];
  speak("开始训练，" + ex.n + "，共" + ex.s + "组，每组" + ex.r + "次");
};

function startWorkout(planId, startIdx) {
  var plan = DATA.PLANS.find(function(p){return p.id===planId;});
  if(!plan) return;
  ST.workout = plan;
  ST.curEx = startIdx;
  ST.curSet = 0;
  ST.workoutStart = new Date().toISOString();
  clearRest();
  navigateTo("workout");
  renderWorkout();
  // 语音播报第一个动作
  var ex = ST.workoutActions || plan.ex;
  speak("开始训练，" + ex[0].n + "，共" + ex[0].s + "组，每组" + ex[0].r + "次");
}

// ====== WORKOUT VIEW ======
function renderWorkout() {
  var c = document.getElementById("workout-content");
  if(!c || !ST.workout) return;
  var plan = ST.workout;
  var exArr = ST.workoutActions || plan.ex;
  var ex = exArr[ST.curEx];
  if(!ex) return;
  var ed = exData(ex.eid);
  var col = ed ? mgColor(ed.mg) : "#4d96ff";
  var pct = ((ST.curEx+1)/exArr.length*100).toFixed(0);

  var html = "";
  // Header
  html += '<div class="workout-header">';
  html += '<div class="wp-bar"><div class="wp-fill" style="width:'+pct+'%"></div></div>';
  html += '<span class="wp-text">'+(ST.curEx+1)+'/'+exArr.length+'</span>';
  html += '</div>';

  // Exercise card
  html += '<div class="ex-show card">';
  html += '<div class="ex-show-top">';
  html += '<span class="mg-tag" style="background:'+col+'22;color:'+col+'">'+mgLabel(ed?ed.mg:"core")+'</span>';
  html += '<span class="set-label">第 '+(ST.curSet+1)+'/'+ex.s+' 组</span>';
  html += '</div>';
  html += '<h2 class="ex-show-name">'+ex.n+'</h2>';
  html += '<div class="ex-show-target">'+ex.r+'次 · 休息'+ex.rest+'秒</div>';
  html += '</div>';

  // Rep counter
  html += '<div class="rep-area">';
  html += '<div class="rep-ctr">';
  html += '<button class="ctr-btn" onclick="adjRep(-1)">−</button>';
  html += '<span id="rep-val">'+ex.r+'</span>';
  html += '<button class="ctr-btn" onclick="adjRep(1)">+</button>';
  html += '<div class="rep-lbl">目标: '+ex.r+' 次</div>';
  html += '</div>';
  html += '</div>';

  // Buttons
  var isLastSet = ST.curSet >= ex.s - 1;
  var fn = isLastSet ? 'doCompleteEx' : 'doCompleteSet';
  var txt = isLastSet ? '完成动作' : '完成这组';
  html += '<button class="btn-done" onclick="'+fn+'()">✓ '+txt+'</button>';

  // Nav
  html += '<div class="w-nav">';
  if(ST.curEx > 0) html += '<button class="btn-back" onclick="doPrevEx()">← 上一个</button>';
  if(ST.curEx < exArr.length - 1) html += '<button class="btn-fwd" onclick="doNextEx()">下一个 →</button>';
  html += '</div>';

  html += '<button class="btn-finish" onclick="doFinish()">⏹ 结束训练</button>';

  c.innerHTML = html;
}

window.adjRep = function(d) {
  var el = document.getElementById("rep-val");
  if(!el) return;
  var v = parseInt(el.textContent)||0;
  el.textContent = Math.max(0, v+d);
};

function recordRep() {
  var exArr = ST.workoutActions || ST.workout.ex;
  var ex = exArr[ST.curEx];
  var ed = exData(ex.eid);
  if(!ed) return;
  var rv = parseInt(document.getElementById("rep-val")?.textContent || ex.r);
  DB.saveProgress(ed.id, todayStr(), rv, true);
}

window.doCompleteSet = function() {
  recordRep();
  ST.curSet++;
  renderWorkout();
  // 渲染完再开始休息倒计时
  startRest((ST.workoutActions || ST.workout.ex)[ST.curEx].rest);
};

window.doCompleteEx = function() {
  recordRep();
  // 判断是否是最后一个动作
  var exArr = ST.workout.ex;
  if(ST.curEx < exArr.length - 1) {
    doNextEx();
  } else {
    // 最后一个动作完成，结束训练
    finishWorkout();
  }
};

window.doPrevEx = function() {
  if(ST.curEx > 0) { ST.curEx--; ST.curSet = 0; clearRest(); announceExercise(ST.curEx); renderWorkout(); }
};

window.doNextEx = function() {
  var exArr = ST.workout.ex;
  if(ST.curEx < exArr.length - 1) {
    ST.curEx++; ST.curSet = 0; clearRest(); announceExercise(ST.curEx); renderWorkout();
  }
};

function startRest(sec) {
  clearRest();
  ST.restLeft = sec;
  showRestTimer(sec);
  var nEl = document.getElementById("rt-num");
  speak("休息" + sec + "秒");

  function tick() {
    ST.restTimer = setTimeout(function() {
      ST.restLeft--;
      if(ST.restLeft <= 0) {
        clearRest();
        hideRestOverlay();
        onRestDone();
        return;
      }
      // 屏幕数字和语音同步播
      if(nEl) nEl.textContent = ST.restLeft;
      speak(ST.restLeft, function() {
        // 语音播完再等下一秒
        tick();
      });
    }, 1000);
  }
  tick();
}

// 切换动作时播报
function announceExercise(idx) {
  var ex = (ST.workoutActions || ST.workout.ex)[idx];
  speak("第" + (idx+1) + "个动作，" + ex.n + "，共" + ex.s + "组，每组" + ex.r + "次");
}

function clearRest() {
  if(ST.restTimer) { clearInterval(ST.restTimer); ST.restTimer = null; }
}

function showRestTimer(sec) {
  var a = document.getElementById("rest-overlay");
  if(!a) return;
  a.style.display = "flex";
  a.querySelector("span").textContent = sec;
}

function hideRestOverlay() {
  var a = document.getElementById("rest-overlay");
  if(a) a.style.display = "none";
  var flash = document.getElementById("rest-flash");
  if(flash) { flash.classList.add("flash"); setTimeout(function(){flash.classList.remove("flash");}, 2000); }
}

function onRestDone() {
  // 休息结束，播报并自动进入下一组
  speak("休息结束", function() {
    var ex = (ST.workoutActions || ST.workout.ex)[ST.curEx];
    if(ST.curSet >= ex.s) {
      // 所有组完成了，跳到下一个动作
      doNextEx();
    } else {
      // 还有组没做，渲染下一组
      renderWorkout();
    }
  });
}

function finishWorkout() {
  speak("训练完成");
  doFinish();
}

window.doSkipRest = function() {
  clearRest();
  clearAllVoice();
  var a = document.getElementById("rest-overlay");
  if(a) a.style.display = "none";
};

window.doFinish = function() {
  if(!confirm("确定结束本次训练？")) return;
  var st = new Date(ST.workoutStart);
  var now = new Date();
  var dur = Math.round((now-st)/1000);
  var vol = 0;
  (ST.workoutActions || ST.workout.ex).forEach(function(e){vol += e.s * e.r;});
  var log = {
    date: new Date().toISOString(),
    planId: ST.workout.id,
    planName: ST.workout.name,
    durationSeconds: dur,
    totalVolume: vol
  };
  DB.saveLog(log).then(function(){
    clearRest();
    ST.workout = null;
    navigateTo("progress");
  });
};

// ====== EXERCISE LIBRARY ======
function renderExLibrary() {
  var c = document.getElementById("ex-list");
  if(!c) return;
  var grp = ST.filter || "all";

  // 搜索框只创建一次
  var searchWrap = c.querySelector(".search-wrap");
  if(!searchWrap) {
    searchWrap = document.createElement("div");
    searchWrap.className = "search-wrap";
    searchWrap.innerHTML = '<input type="text" id="ex-search" placeholder="🔍 搜索动作名称..." class="search-input">';
    c.insertBefore(searchWrap, c.firstChild);
  }
  var searchInput = document.getElementById("ex-search");
  if(!searchInput._bound) {
    searchInput.addEventListener("input", function() { renderExLibrary(); });
    searchInput._bound = true;
  }
  var term = (searchInput.value || "").toLowerCase();

  var filtered = DATA.EX.filter(function(ex) {
    var ms = !term || ex.name.toLowerCase().includes(term);
    var mg = grp==="all" || ex.mg === grp;
    var wk = !ST.wristOn || ex.wrist !== false;
    var kc = !ST.settings.knee || ex.knee !== false;
    return ms && mg && wk && kc;
  });

  var html = "";

  // Filter buttons（只更新一次）
  var filterRow = c.querySelector(".filter-row");
  if(!filterRow) {
    filterRow = document.createElement("div");
    filterRow.className = "filter-row";
    c.insertBefore(filterRow, searchWrap.nextSibling);
  }
  html = '';
  html += '<button class="filter-btn'+(grp==="all"?" filter-active":"")+'" onclick="setFilter(\'all\')">全部</button>';
  Object.keys(DATA.LABELS).forEach(function(g) {
    var col = mgColor(g);
    var cls = grp===g ? "filter-active":"";
    html += '<button class="filter-btn '+cls+'" data-mg="'+g+'" style="'+(grp===g?'background:'+col+';color:#fff;border-color:'+col:'')+'" onclick="setFilter(\''+g+'\')">'+DATA.LABELS[g]+'</button>';
  });
  filterRow.innerHTML = html;

  // Ex cards（只更新这部分）
  var cardsContainer = c.querySelector(".ex-cards-container");
  if(!cardsContainer) {
    cardsContainer = document.createElement("div");
    cardsContainer.className = "ex-cards-container";
    c.insertBefore(cardsContainer, filterRow.nextSibling);
  }

  html = "";
  if(filtered.length === 0) {
    html += '<div class="empty-msg">没有找到匹配的动作</div>';
  }
  filtered.forEach(function(ex) {
    var col = mgColor(ex.mg);
    html += '<div class="ex-detail-card" onclick="showExDetail('+ex.id+')">';
    html += '<div class="ex-d-header">';
    html += '<div class="ex-d-dot" style="background:'+col+'"></div>';
    html += '<div class="ex-d-name">'+ex.name+'</div>';
    html += '</div>';
    html += '<div class="ex-d-tags">';
    html += mgTagHTML(ex.mg);
    html += '<span class="tag" style="background:'+col+'22;color:'+col+'">'+ex.diff+'</span>';
    html += '<span class="knee-tag">🛡️ 膝盖友好</span>';
    html += wristTagHTML(ex.wrist !== false);
    html += '</div>';
    html += '<div class="ex-d-desc">'+ex.desc+'</div>';
    html += '</div>';
  });

  cardsContainer.innerHTML = html;
}

window.setFilter = function(g) { ST.filter = g; renderExLibrary(); };

window.showExDetail = function(id) {
  ST.detailExId = id;
  navigateTo("ex-detail");
};

function renderExDetail() {
  var id = ST.detailExId;
  if(!id) return;
  var ex = exData(id);
  if(!ex) return;
  var col = mgColor(ex.mg);
  var c = document.getElementById("ex-detail-container");
  if(!c) return;
  var html = "";

  // Top bar
  html += '<div class="ex-detail-top">';
  html += '<div class="ex-back-btn" onclick="navigateTo(\'exercise\')">← 返回</div>';
  html += '<div class="ex-d-header">';
  html += mgTagHTML(ex.mg);
  html += '<span class="tag">'+ex.diff+'</span>';
  html += '</div></div>';

  // Title
  html += '<h1 class="ex-detail-title">'+ex.name+'</h1>';
  html += '<span class="knee-tag">🛡️ 膝盖友好</span>';
  html += wristTagHTML(ex.wrist !== false);

  // Data-driven detail blocks
  var BLOCKS = [
    {field:"equipment", title:"🏠 所需器材",  tag:"p"},
    {field:"breathing", title:"🫁 呼吸节奏",  tag:"p"},
    {field:"targetMuscles", title:"🎯 目标肌群", tag:"p"},
    {field:"desc",      title:"💡 动作说明",  tag:"p"},
    {field:"steps",     title:"📝 分步指导",  list:"steps"},
    {field:"tips",      title:"✅ 要点提示",  list:"tips"},
    {field:"mistakes",  title:"❌ 常见错误",  list:"mistakes"},
    {field:"prog",      title:"📈 进阶方向",  list:"prog"},
    {field:"substitute",title:"🔄 替代动作",  list:"substitute"}
  ];

  BLOCKS.forEach(function(block) {
    var val = ex[block.field];
    if(!val || !val.length && typeof val !== "string") return;
    html += '<div class="detail-block"><h3>'+block.title+'</h3>';

    if(typeof val === "string") {
      html += '<p>'+val+'</p>';
    } else if(block.list === "steps") {
      html += '<div class="step-list">';
      val.forEach(function(item, i) {
        html += '<div class="step-item"><span class="step-num">'+(i+1)+'</span><span class="step-text">'+item+'</span></div>';
      });
      html += '</div>';
    } else {
      var cls = block.list === "mistakes" ? "mistakes-list" : "tip-list";
      var prefix = block.list === "tips" ? "✓ " : block.list === "mistakes" ? "✗ " : block.list === "prog" ? "→ " : block.list === "substitute" ? "⇄ " : "";
      html += '<ul class="'+cls+'">';
      val.forEach(function(item) {
        html += '<li class="'+(block.list === "mistakes" ? "tip-item err-li" : "tip-item")+'">'+prefix+item+'</li>';
      });
      html += '</ul>';
    }
    html += '</div>';
  });

  // History chart
  html += '<div class="detail-block"><h3>📊 最近30天记录</h3><div id="ex-chart-'+id+'">加载中...</div></div>';

  c.innerHTML = html;

  // Load history
  var containerRef = c.lastElementChild;
  DB.getHistory(id, 30).then(function(hist) {
    if(!containerRef) return;
    if(hist.length === 0) { containerRef.innerHTML = '<div class="empty-msg">暂无记录，开始训练吧！</div>'; return; }
    containerRef.innerHTML = '<div class="mini-chart">';
    hist.slice(-7).forEach(function(h) {
      var h2 = Math.min(100, (h.reps/30)*100);
      containerRef.innerHTML += '<div class="m-bar" style="height:'+h2+'%;background:'+col+'"><span class="m-val">'+h.reps+'</span></div>';
    });
    containerRef.innerHTML += '</div>';
  });
};

// ====== PROGRESS VIEW ======
function renderProgress() {
  var c = document.getElementById("progress-content");
  if(!c) return;
  var html = "";
  html += '<div class="stats-row">';
  html += '<div class="stat-item"><div class="stat-num" id="s-total">0</div><div class="stat-txt">总训练次数</div></div>';
  html += '<div class="stat-item"><div class="stat-num" id="s-min">0</div><div class="stat-txt">总训练分钟</div></div>';
  html += '<div class="stat-item"><div class="stat-num" id="s-vol">0</div><div class="stat-txt">总容量</div></div>';
  html += '</div>';
  html += '<div class="card">';
  html += '<h3 class="section-h">近4周训练</h3>';
  html += '<div class="week-chart" id="week-chart"></div>';
  html += '</div>';
  html += '<div class="card">';
  html += '<h3 class="section-h">最近训练</h3>';
  html += '<div id="recent-list">加载中...</div>';
  html += '</div>';
  c.innerHTML = html;

  DB.getStats().then(function(s) {
    var te = document.getElementById("s-total");
    var me = document.getElementById("s-min");
    var ve = document.getElementById("s-vol");
    if(te) te.textContent = s.totalWorkouts;
    if(me) me.textContent = Math.round(s.totalDuration/60);
    if(ve) ve.textContent = s.totalVolume;

    var wc = document.getElementById("week-chart");
    if(wc) {
      var keys = Object.keys(s.weeklyData).reverse().slice(0,4);
      var max = Math.max(1, ...Object.values(s.weeklyData));
      var maxH = wc.parentElement.clientHeight - 60;
      keys.forEach(function(k){
        var v = s.weeklyData[k]||0;
        var h = Math.max(4, (v/max)*maxH);
        var dk = k.substring(5);
        wc.innerHTML += '<div class="w-bar-wrap"><div class="w-bar" style="height:'+h+'px;background:linear-gradient(to top,#ff6b6b,#ff922b)"></div><div class="w-bar-label">'+dk+'</div><div class="w-bar-val">'+v+'</div></div>';
      });
    }

    var rl = document.getElementById("recent-list");
    if(rl) {
      if(!s.recentLogs.length) { rl.innerHTML='<div class="empty-msg">还没有训练记录</div>'; return; }
      var lh = "";
      s.recentLogs.forEach(function(l){
        var d = new Date(l.date);
        var ds = (d.getMonth()+1)+"/"+d.getDate() + " · " + DATA.DAYS[d.getDay()];
        var m = Math.round((l.durationSeconds||0)/60);
        lh += '<div class="recent-row"><span>'+ds+'</span><span>'+l.planName+'</span><span>'+m+'min</span></div>';
      });
      rl.innerHTML = lh;
    }
  });
}

// ====== SETTINGS VIEW ======
var SETTINGS_FIELDS = [
  {id:"s-weight", key:"weight",  parse:function(v){return parseInt(v)||70},  def:70},
  {id:"s-height", key:"height",  parse:function(v){return parseInt(v)||170}, def:170},
  {id:"s-age",    key:"age",     parse:function(v){return parseInt(v)||25},  def:25},
  {id:"s-rest",   key:"restSeconds", parse:function(v){return parseInt(v)||60}, def:60},
  {id:"s-diff",   key:"diff",    parse:function(v){return v||"中级"},        def:"中级"},
  {id:"s-knee",   key:"knee",    parse:function(v){return v!==false},        def:true},
  {id:"s-wrist",  key:"wrist",   parse:function(v){return v!==false},        def:true}
];

function renderSettings() {
  var c = document.getElementById("settings-content");
  if(!c) return;
  var html = "";

  html += '<div class="card">';
  html += '<h3 class="section-h">个人信息</h3>';
  html += '<div class="s-row"><label>体重 (kg)</label><input type="number" id="s-weight" value="70" class="s-input"></div>';
  html += '<div class="s-row"><label>身高 (cm)</label><input type="number" id="s-height" value="170" class="s-input"></div>';
  html += '<div class="s-row"><label>年龄</label><input type="number" id="s-age" value="25" class="s-input"></div>';
  html += '</div>';

  html += '<div class="card">';
  html += '<h3 class="section-h">训练设置</h3>';
  html += '<div class="s-row"><label>组间休息 (秒)</label><input type="number" id="s-rest" value="60" class="s-input"></div>';
  html += '<div class="s-row"><label>难度级别</label><select id="s-diff" class="s-input"><option>初级</option><option selected>中级</option><option>进阶</option></select></div>';
  html += '</div>';

  html += '<div class="card">';
  html += '<h3 class="section-h">膝盖保护</h3>';
  html += '<div class="s-row s-toggle-row"><label>膝盖保护模式</label><label class="ts"><input type="checkbox" id="s-knee" checked><span class="ts-sl"></span></label></div>';
  html += '<p class="s-help">开启后将只显示膝盖友好的动作</p>';
  html += '</div>';

  html += '<div class="card">';
  html += '<h3 class="section-h">手腕保护</h3>';
  html += '<div class="s-row s-toggle-row"><label>手腕保护模式</label><label class="ts"><input type="checkbox" id="s-wrist" checked><span class="ts-sl"></span></label></div>';
  html += '<p class="s-help">开启后将只显示对手腕友好的动作（排除手掌撑地类）</p>';
  html += '</div>';

  html += '<div class="card">';
  html += '<h3 class="section-h">语音设置</h3>';
  html += '<div class="s-row s-toggle-row"><label>语音播报</label><label class="ts"><input type="checkbox" id="s-voice" checked><span class="ts-sl"></span></label></div>';
  html += '<p class="s-help">训练时自动播报动作信息</p>';
  html += '<div class="s-row"><button class="btn-save" style="width:100%;margin:0" onclick="testVoiceBtn()">🔊 点击测试语音</button></div>';
  html += '<p class="s-help" style="margin-top:4px">如果没声音，请检查手机音量是否打开</p>';
  html += '</div>';

  html += '<div class="card">';
  html += '<h3 class="section-h">营养参考</h3>';
  html += '<div class="nutri-grid">';
  html += '<div class="nutri-item"><span class="nutri-l">每日热量</span><span class="nutri-v">—</span></div>';
  html += '<div class="nutri-item"><span class="nutri-l">蛋白质</span><span class="nutri-v">—</span></div>';
  html += '</div>';
  html += '</div>';

  html += '<button class="btn-save" onclick="saveSettings()">💾 保存设置</button>';
  html += '<div class="card" style="margin-top:16px">';
  html += '<h3 class="section-h">数据管理</h3>';
  html += '<button class="btn-clear" onclick="clearData()">清除所有数据</button>';
  html += '</div>';

  c.innerHTML = html;

  // Load saved settings
  DB.getSettings().then(function(saved) {
    SETTINGS_FIELDS.forEach(function(f) {
      var el = document.getElementById(f.id);
      if(el && saved[f.key] !== undefined) {
        if(f.id === "s-diff") el.value = saved[f.key];
        else if(f.id === "s-knee") el.checked = saved[f.key];
        else if(f.id === "s-wrist") el.checked = saved[f.key];
        else el.value = saved[f.key];
      }
    });
    // Voice toggle
    var voiceEl = document.getElementById("s-voice");
    if(voiceEl) voiceEl.checked = saved.voice !== false;

    // Update nutrition info
    var w = saved.weight || 70;
    var protein = Math.round(w * 1.8);
    var cal = Math.round(w * 35 + 400);
    var ni = c.querySelector(".nutri-grid");
    if(ni) {
      ni.innerHTML = '<div class="nutri-item"><span class="nutri-l">每日热量</span><span class="nutri-v">'+cal+' 大卡</span></div><div class="nutri-item"><span class="nutri-l">蛋白质</span><span class="nutri-v">'+protein+' g</span></div>';
    }
  });
}

window.saveSettings = function() {
  var obj = {};
  SETTINGS_FIELDS.forEach(function(f) {
    var el = document.getElementById(f.id);
    if(!el) { obj[f.key] = f.def; return; }
    if(f.id === "s-knee") obj[f.key] = el.checked;
    else if(f.id === "s-wrist") obj[f.key] = el.checked;
    else if(f.id === "s-diff") obj[f.key] = el.value;
    else obj[f.key] = f.parse(el.value);
  });
  // Voice toggle
  var voiceEl = document.getElementById("s-voice");
  obj.voice = voiceEl ? voiceEl.checked : true;
  DB.saveSettings(obj).then(function(){
    alert("✅ 设置已保存！");
  });
};

window.testVoiceBtn = function() {
  ST.soundOn = true;
  var btn = document.getElementById("sound-toggle");
  if(btn) btn.textContent = "🔊";
  // 先播语音，失败后自动 fallback 到提示音
  speak("测试语音", function() {
    playBeep(1000, 300);
  });
};

window.clearData = function() {
  if(!confirm("确定清除所有数据？此操作不可恢复！")) return;
  if(!confirm("再次确认：清除所有训练记录和设置？")) return;
  var req = indexedDB.deleteDatabase("FitnessApp");
  req.onsuccess = function() { location.reload(); };
};

// ====== INIT ======
function init() {
  ST.filter = "all";
  ST.wristOn = true;
  DB.getSettings().then(function(saved) {
    Object.keys(saved).forEach(function(k){ ST.settings[k]=saved[k]; });
    if(saved.wrist !== undefined) ST.wristOn = saved.wrist;
    navigateTo("plan");
  }).catch(function(){ navigateTo("plan"); });
}
