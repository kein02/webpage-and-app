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
  workoutStart: null
};

// ====== HELPERS ======
function exData(id) { return DATA.EX.find(function(e){return e.id===id;}); }
function mgLabel(mg) { return DATA.LABELS[mg] || "综合"; }
function mgColor(mg) { return DATA.COLORS[mg] || "#4d96ff"; }
function dayRest(s) { if(s<=30) return "快休"; if(s<=45) return "中休"; return s+"秒"; }

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
  if(view==="progress") renderProgress();
  if(view==="settings") renderSettings();
}

// ====== PLAN VIEW ======
function renderPlan() {
  var c = document.getElementById("plan-list");
  if(!c) return;
  var today = new Date().getDay();
  var plan = DATA.PLANS.find(function(p){return p.day===today;});
  if(!plan) plan = DATA.PLANS[0];
  var totalSets = 0;
  plan.ex.forEach(function(e){totalSets+=e.s;});

  var html = "";
  // Today header
  html += '<div class="card today-card">';
  html += '<div class="today-tag">今天 · ' + DATA.DAYS[today] + '</div>';
  html += '<h2 class="today-name">' + plan.name + '</h2>';
  html += '<div class="today-meta">' + totalSets + '组 · 约30分钟</div>';
  html += '<div class="ex-cards">';

  plan.ex.forEach(function(ex,i) {
    var ed = exData(ex.eid);
    var col = ed ? mgColor(ed.mg) : "#4d96ff";
    html += '<div class="ex-card" onclick="startWorkout(\''+plan.id+'\',0)">';
    html += '<div class="ex-num" style="border-color:'+col+'">'+(i+1)+'</div>';
    html += '<div class="ex-info">';
    html += '<div class="ex-name">'+ex.n+'</div>';
    html += '<div class="ex-detail">'+ex.s+'组 × '+ex.r+'次 · '+dayRest(ex.rest)+'</div>';
    html += '</div>';
    html += '<div class="ex-arrow">›</div>';
    html += '</div>';
  });

  html += '</div>';
  html += '<button class="btn-start" onclick="startWorkout(\''+plan.id+'\',0)">▶ 开始训练</button>';
  html += '</div>';

  // Week preview
  html += '<div class="card">';
  html += '<h3 class="section-h">本周计划</h3>';
  DATA.PLANS.forEach(function(p) {
    var isToday = p.day === today;
    html += '<div class="day-row' + (isToday?' day-today':'') + '">';
    html += '<span class="day-label">' + DATA.DAYS[p.day] + '</span>';
    html += '<span>' + p.name + '</span>';
    if(isToday) html += '<span class="today-dot"></span>';
    html += '</div>';
  });
  html += '</div>';

  c.innerHTML = html;
}

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
}

// ====== WORKOUT VIEW ======
function renderWorkout() {
  var c = document.getElementById("workout-content");
  if(!c || !ST.workout) return;
  var plan = ST.workout;
  var exArr = plan.ex;
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
  if(ST.curSet < ex.s - 1) {
    html += '<button class="btn-done" onclick="doCompleteSet()">✓ 完成这组</button>';
  } else {
    html += '<button class="btn-done" onclick="doCompleteEx()">✓ 完成动作</button>';
  }

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

window.doCompleteSet = function() {
  var ex = ST.workout.ex[ST.curEx];
  var ed = exData(ex.eid);
  var rv = parseInt(document.getElementById("rep-val")?.textContent || ex.r);
  var today = new Date().toISOString().split("T")[0];
  if(ed) DB.saveProgress(ed.id, today, rv, true);
  ST.curSet++;
  startRest(ex.rest);
  renderWorkout();
};

window.doCompleteEx = function() {
  var ex = ST.workout.ex[ST.curEx];
  var ed = exData(ex.eid);
  var rv = parseInt(document.getElementById("rep-val")?.textContent || ex.r);
  var today = new Date().toISOString().split("T")[0];
  if(ed) DB.saveProgress(ed.id, today, rv, true);
  doNextEx();
};

window.doPrevEx = function() {
  if(ST.curEx > 0) { ST.curEx--; ST.curSet = 0; renderWorkout(); }
};

window.doNextEx = function() {
  var exArr = ST.workout.ex;
  if(ST.curEx < exArr.length - 1) {
    ST.curEx++; ST.curSet = 0; clearRest(); renderWorkout();
  }
};

function startRest(sec) {
  clearRest();
  ST.restLeft = sec;
  showRestTimer(sec);
  ST.restTimer = setInterval(function() {
    ST.restLeft--;
    if(ST.restLeft <= 0) { clearRest(); onRestDone(); return; }
    var n = document.getElementById("rt-num");
    if(n) n.textContent = ST.restLeft;
  }, 1000);
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

function onRestDone() {
  var a = document.getElementById("rest-overlay");
  if(a) { a.style.display = "none"; a.querySelector("span").textContent = ST.restLeft; }
  var flash = document.getElementById("rest-flash");
  if(flash) { flash.classList.add("flash"); setTimeout(function(){flash.classList.remove("flash");}, 2000); }
}

window.doSkipRest = function() {
  clearRest();
  var a = document.getElementById("rest-overlay");
  if(a) a.style.display = "none";
};

window.doFinish = function() {
  if(!confirm("确定结束本次训练？")) return;
  var st = new Date(ST.workoutStart);
  var now = new Date();
  var dur = Math.round((now-st)/1000);
  var vol = 0;
  ST.workout.ex.forEach(function(e){vol += e.s * e.r;});
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
  var term = (document.getElementById("ex-search")?.value||"").toLowerCase();
  var grp = ST.filter || "all";

  var filtered = DATA.EX.filter(function(ex) {
    var ms = !term || ex.name.toLowerCase().includes(term);
    var mg = grp==="all" || ex.mg === grp;
    return ms && mg;
  });

  var html = "";
  // Search
  html += '<div class="search-wrap">';
  html += '<input type="text" id="ex-search" placeholder="🔍 搜索动作名称..." oninput="renderExLibrary()" class="search-input">';
  html += '</div>';

  // Filter buttons
  html += '<div class="filter-row">';
  html += '<button class="filter-btn'+(grp==="all"?" filter-active":"")+'" onclick="setFilter(\'all\')">全部</button>';
  Object.keys(DATA.LABELS).forEach(function(g) {
    var col = mgColor(g);
    var cls = grp===g ? "filter-active":"";
    html += '<button class="filter-btn '+cls+'" data-mg="'+g+'" style="'+(grp===g?'background:'+col+';color:#fff;border-color:'+col:'')+'" onclick="setFilter(\''+g+'\')">'+DATA.LABELS[g]+'</button>';
  });
  html += '</div>';

  // Ex cards
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
    html += '<span class="tag" style="background:'+col+'22;color:'+col+'">'+mgLabel(ex.mg)+'</span>';
    html += '<span class="tag" style="background:'+col+'22;color:'+col+'">'+ex.diff+'</span>';
    html += '<span class="knee-tag">🛡️ 膝盖友好</span>';
    html += '</div>';
    html += '<div class="ex-d-desc">'+ex.desc+'</div>';
    html += '</div>';
  });

  c.innerHTML = html;
}

window.setFilter = function(g) { ST.filter = g; renderExLibrary(); };

window.showExDetail = function(id) {
  var ex = exData(id);
  if(!ex) return;
  var col = mgColor(ex.mg);
  var html = "";
  html += '<div class="ex-back-btn" onclick="navigateTo(\'exercise\')">← 返回动作库</div>';
  html += '<div class="ex-d-header">';
  html += '<span class="mg-tag" style="background:'+col+'22;color:'+col+'">'+mgLabel(ex.mg)+'</span>';
  html += '<span class="tag">'+ex.diff+'</span>';
  html += '</div>';
  html += '<h2 class="ex-d-name">'+ex.name+'</h2>';
  html += '<span class="knee-tag">🛡️ 膝盖友好</span>';

  html += '<div class="detail-block"><h3>💡 动作说明</h3><p>'+ex.desc+'</p></div>';
  html += '<div class="detail-block"><h3>✅ 要点提示</h3><ul>';
  ex.tips.forEach(function(t){html+='<li>'+t+'</li>';});
  html += '</ul></div>';
  html += '<div class="detail-block"><h3>❌ 常见错误</h3><ul>';
  ex.mistakes.forEach(function(m){html+='<li class="err-li">'+m+'</li>';});
  html += '</ul></div>';
  if(ex.prog && ex.prog.length>0) {
    html += '<div class="detail-block"><h3>📈 进阶方向</h3><div class="prog-list">';
    ex.prog.forEach(function(p){html+='<div class="prog-item">→ '+p+'</div>';});
    html += '</div></div>';
  }

  // History
  html += '<div class="detail-block"><h3>📊 最近30天记录</h3><div id="ex-chart-'+id+'">加载中...</div></div>';

  var dc = document.getElementById("ex-detail-container");
  if(dc) dc.innerHTML = html;

  // Load history
  DB.getHistory(id, 30).then(function(hist) {
    var ce = document.getElementById("ex-chart-"+id);
    if(!ce) return;
    if(hist.length === 0) { ce.innerHTML = '<div class="empty-msg">暂无记录</div>'; return; }
    ce.innerHTML = '<div class="mini-chart">';
    hist.slice(-7).forEach(function(h) {
      var h2 = Math.min(100, (h.reps/30)*100);
      ce.innerHTML += '<div class="m-bar" style="height:'+h2+'%;background:'+col+'"><span class="m-val">'+h.reps+'</span></div>';
    });
    ce.innerHTML += '</div>';
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
      var max = Math.max(1, Math.max.apply(null, Object.values(s.weeklyData)));
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
function renderSettings() {
  var c = document.getElementById("settings-content");
  if(!c) return;
  html = "";

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
    if(saved.weight) document.getElementById("s-weight").value = saved.weight;
    if(saved.height) document.getElementById("s-height").value = saved.height;
    if(saved.age) document.getElementById("s-age").value = saved.age;
    if(saved.restSeconds) document.getElementById("s-rest").value = saved.restSeconds;
    if(saved.diff) document.getElementById("s-diff").value = saved.diff;
    if(saved.knee !== undefined) document.getElementById("s-knee").checked = saved.knee;

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
  var obj = {
    weight: parseInt(document.getElementById("s-weight")?.value)||70,
    height: parseInt(document.getElementById("s-height")?.value)||170,
    age: parseInt(document.getElementById("s-age")?.value)||25,
    restSeconds: parseInt(document.getElementById("s-rest")?.value)||60,
    diff: document.getElementById("s-diff")?.value || "中级",
    knee: document.getElementById("s-knee")?.checked !== false
  };
  DB.saveSettings(obj).then(function(){
    alert("✅ 设置已保存！");
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
  DB.getSettings().then(function(saved) {
    Object.keys(saved).forEach(function(k){ ST.settings[k]=saved[k]; });
    navigateTo("plan");
  }).catch(function(){ navigateTo("plan"); });
}
