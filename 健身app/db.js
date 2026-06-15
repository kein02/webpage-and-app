var DB = {
  _db: null,
  _open: function() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise(function(ok, no) {
      var r = indexedDB.open("FitnessApp", 1);
      r.onerror = function() { no(r.error); };
      r.onsuccess = function() { DB._db = r.result; ok(DB._db); };
      r.onupgradeneeded = function(e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains("logs")) {
          var s = d.createObjectStore("logs", {keyPath:"id", autoIncrement:true});
          s.createIndex("date","date",{unique:false});
        }
        if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings",{keyPath:"key"});
        if (!d.objectStoreNames.contains("progress")) {
          var ps = d.createObjectStore("progress",{keyPath:"id"});
          ps.createIndex("exerciseId","exerciseId",{unique:false});
          ps.createIndex("date","date",{unique:false});
        }
      };
    });
  },
  saveLog: function(log) {
    return this._open().then(function(d) {
      return new Promise(function(ok, no) {
        var tx = d.transaction("logs","readwrite");
        var r = tx.objectStore("logs").add(log);
        r.onsuccess = function() { ok({id:r.result, ...log}); };
        r.onerror = function() { no(r.error); };
      });
    });
  },
  getLogs: function() {
    return this._open().then(function(d) {
      return new Promise(function(ok) {
        var tx = d.transaction("logs","readonly");
        var r = tx.objectStore("logs").getAll();
        r.onsuccess = function() {
          var arr = (r.result || []).sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
          ok(arr);
        };
      });
    });
  },
  getSettings: function() {
    return this._open().then(function(d) {
      return new Promise(function(ok) {
        var tx = d.transaction("settings","readonly");
        var r = tx.objectStore("settings").getAll();
        r.onsuccess = function() {
          var o = {};
          (r.result || []).forEach(function(i) { o[i.key] = i.value; });
          ok(o);
        };
      });
    });
  },
  saveSettings: function(obj) {
    return this._open().then(function(d) {
      return new Promise(function(ok, no) {
        var tx = d.transaction("settings","readwrite");
        Object.keys(obj).forEach(function(k) { tx.objectStore("settings").put({key:k, value:obj[k]}); });
        tx.oncomplete = function() { ok(true); };
        tx.onerror = function() { no(tx.error); };
      });
    });
  },
  saveProgress: function(exId, date, reps, completed) {
    return this._open().then(function(d) {
      return new Promise(function(ok) {
        var tx = d.transaction("progress","readwrite");
        tx.objectStore("progress").add({
          id: exId + "_" + date + "_" + Date.now(),
          exerciseId: exId,
          date: date,
          reps: reps,
          completed: completed
        });
        tx.oncomplete = function() { ok(true); };
      });
    });
  },
  getHistory: function(exId, days) {
    return this._open().then(function(d) {
      return new Promise(function(ok) {
        var tx = d.transaction("progress","readonly");
        var idx = tx.objectStore("progress").index("exerciseId");
        var r = idx.getAll(exId);
        r.onsuccess = function() {
          var cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - (days || 30));
          var arr = (r.result || []).filter(function(h) { return new Date(h.date) >= cutoff; })
            .sort(function(a,b) { return new Date(a.date) - new Date(b.date); });
          ok(arr);
        };
      });
    });
  },
  getStats: function() {
    return this.getLogs().then(function(logs) {
      var totalW = logs.length;
      var totalD = logs.reduce(function(s,l) { return s + (l.durationSeconds || 0); }, 0);
      var totalV = logs.reduce(function(s,l) { return s + (l.totalVolume || 0); }, 0);
      var weekly = {};
      var now = new Date();
      for (var i = 0; i < 12; i++) {
        var ws = new Date(now); ws.setDate(ws.getDate() - i*7);
        var we = new Date(ws); we.setDate(we.getDate() + 6);
        var key = ws.toISOString().split("T")[0];
        var cnt = logs.filter(function(l) { var d = new Date(l.date); return d >= ws && d <= we; }).length;
        weekly[key] = cnt;
      }
      return {totalWorkouts:totalW, totalDuration:totalD, totalVolume:totalV, weeklyData:weekly, recentLogs:logs.slice(0,7)};
    });
  }
};
