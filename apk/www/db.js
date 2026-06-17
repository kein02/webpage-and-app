var DB = {
  _prefix: "fitness_",

  _get: function(key) {
    try {
      var v = localStorage.getItem(this._prefix + key);
      return v ? JSON.parse(v) : null;
    } catch(e) { return null; }
  },

  _set: function(key, val) {
    try {
      localStorage.setItem(this._prefix + key, JSON.stringify(val));
      return true;
    } catch(e) { return false; }
  },

  _del: function(key) {
    try { localStorage.removeItem(this._prefix + key); } catch(e) {}
  },

  saveLog: function(log) {
    var logs = this._get("logs") || [];
    var entry = { ...log };
    if (!entry.id) entry.id = Date.now();
    logs.push(entry);
    this._set("logs", logs);
    return Promise.resolve(entry);
  },

  getLogs: function() {
    var logs = this._get("logs") || [];
    return Promise.resolve(
      logs.sort(function(a,b) { return new Date(b.date) - new Date(a.date); })
    );
  },

  getSettings: function() {
    var raw = this._get("settings");
    if (!raw) return Promise.resolve({});
    if (Array.isArray(raw)) {
      var obj = {};
      raw.forEach(function(i) { obj[i.key] = i.value; });
      return Promise.resolve(obj);
    }
    return Promise.resolve(raw);
  },

  saveSettings: function(obj) {
    this._set("settings", obj);
    return Promise.resolve(true);
  },

  saveProgress: function(exId, date, reps, completed) {
    var items = this._get("progress") || [];
    items.push({
      id: exId + "_" + date + "_" + Date.now(),
      exerciseId: exId,
      date: date,
      reps: reps,
      completed: completed
    });
    this._set("progress", items);
    return Promise.resolve(true);
  },

  getHistory: function(exId, days) {
    var items = this._get("progress") || [];
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days || 30));
    var filtered = items
      .filter(function(h) { return h.exerciseId === exId && new Date(h.date) >= cutoff; })
      .sort(function(a,b) { return new Date(a.date) - new Date(b.date); });
    return Promise.resolve(filtered);
  },

  getStats: function() {
    var logs = this._get("logs") || [];
    var totalW = logs.length;
    var totalD = logs.reduce(function(s,l) { return s + (l.durationSeconds || 0); }, 0);
    var totalV = logs.reduce(function(s,l) { return s + (l.totalVolume || 0); }, 0);
    var weekly = {};
    var now = new Date();
    for (var i = 0; i < 12; i++) {
      var ws = new Date(now); ws.setDate(ws.getDate() - i*7);
      var we = new Date(ws); we.setDate(we.getDate() + 6);
      var key = ws.toISOString().split("T")[0];
      weekly[key] = 0;
    }
    // Single-pass bucket: assign each log to its week
    logs.forEach(function(l) {
      var d = new Date(l.date);
      var weekStart = new Date(d);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      var k = weekStart.toISOString().split("T")[0];
      if (k in weekly) weekly[k]++;
    });
    return Promise.resolve({totalWorkouts:totalW, totalDuration:totalD, totalVolume:totalV, weeklyData:weekly, recentLogs:logs.slice(0,7)});
  },

  clearAll: function() {
    var keys = ["logs", "settings", "progress"];
    keys.forEach(function(k) { this._del(k); }.bind(this));
    return Promise.resolve(true);
  }
};
