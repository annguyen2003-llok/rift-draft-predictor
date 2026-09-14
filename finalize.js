'use strict';
/* Fits the models that actually measured better than baseline, and emits
   dataset.json for the site.

   Selection was made by leak-free 5-fold CV over candidate feature sets
   (see diagnose.js). What survived:
     win probability : [teamStrength?, frontline, ranged, mobility, sumWr]  lambda=60
     total kills     : [pace, lengthLean]                                   lambda=100
   What was dropped, and why:
     head-to-head matchup edge -> AUC 0.548 and log loss far worse than
       baseline; kept in the dataset for display only, never in the model.
     game duration -> no feature set beat predicting the mean (R2 <= 0),
       so no duration model ships; the observed distribution is shown instead.

   2026-09-14 — SỬA LỖI PHƯƠNG PHÁP QUAN TRỌNG. Trước đây frontline/ranged/mobility
   bị loại vì đo RIÊNG LẺ chống baseline chỉ ra AUC 0.44-0.49 ("nhiễu"). Nhưng đó là
   phép đo sai: một tín hiệu yếu vẫn có thể đóng góp thật khi đứng CẠNH tín hiệu khác.
   Đo lại theo cặp (cùng fold, 20 seed) trên nền "chỉ sức mạnh đội": frontline +0.0097
   AUC thắng 20/20 seed, ranged +0.0062 (18/20), mobility +0.0037 (20/20) — đều thật.
   Ngược lại scaling bị LOẠI: bootstrap 2000 lần cho thấy bỏ nó tốt hơn giữ
   (+0.0078 AUC, KTC 95% [0.0006, 0.0151]).

   Lý do kiến trúc (quan trọng hơn cả điểm số): 3 trục kit là phân loại TĨNH, không
   cần tướng đó từng ra sân lần nào. Nên khi giải đấu xuất hiện tướng mới/tướng lạ,
   mô hình vẫn đánh giá được — trong khi sumWr tụt về 0.5 trung tính. Đo mô phỏng
   walk-forward: ở mức 20% tướng trong trận là tướng chưa từng thấy, bộ đang dùng giữ
   AUC 0.6022 so với 0.5934 của bộ cũ. Xem meta.newChampAudit trong dataset.json. */

const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, 'data');
const rawGames = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const seriesJsonPath = path.join(DATA_DIR, 'series.json');
const seriesList = fs.existsSync(seriesJsonPath) ? JSON.parse(fs.readFileSync(seriesJsonPath, 'utf8')) : [];
const ATTRS = require('./champ_attrs.js');
const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];

// Trận nào có cảnh báo "pick không khớp bảng điểm" bị loại khỏi huấn luyện —
// nếu draft và scoreboard của gol.gg tự mâu thuẫn nhau thì không đủ tin cậy
// để đưa vào tính WR/đối đầu, dù trận đó vẫn còn trong games.json để tra cứu thô.
const droppedGames = rawGames.filter(g => !g.integrity.picksMatchScoreboard);
let games = rawGames.filter(g => g.integrity.picksMatchScoreboard);
if (droppedGames.length) {
  console.log(`Loại ${droppedGames.length} trận khỏi huấn luyện vì pick không khớp scoreboard: ` +
    droppedGames.map(g => `#${g.gameId} (${g.blue.team} vs ${g.red.team}, ${g.date})`).join(', '));
}

/* KHÔNG lọc theo patch — đã thử và đo lại bằng thực nghiệm (2026-09-07), quyết
   định giữ nguyên toàn bộ dữ liệu. Diễn biến: 3 giải patch lệch nhau theo lịch
   bảo trì riêng (LCK 16.16, LPL/LEC 16.17 cùng thời điểm), nên thử lọc "chỉ patch
   hiện tại của từng giải" (1 rồi 2 patch gần nhất) để tránh lẫn balance cũ.
   Nhưng so sánh 1 lần duy nhất mỗi cách (seed cố định) từng cho kết quả GÂY HIỂU
   LẦM: "2 patch" (261 trận) có vẻ thắng AUC chỉ-đội-hình (0.624 vs 0.590 không
   lọc). Đo lại đúng cách — lặp 10 seed ngẫu nhiên khác nhau, lấy trung bình —
   lộ ra đó chỉ là may mắn trúng 1 seed tốt (0.624 chính là max trong khoảng
   0.506-0.625 dao động của "2 patch"). Trung bình thật: không lọc AUC=0.575
   (lệch chuẩn 0.009, rất ổn định) > 2 patch AUC=0.556 (lệch 0.031) > 1 patch
   AUC=0.514 (lệch 0.037, n=134 quá nhỏ). Không lọc thắng cả 2 tiêu chí — cao
   hơn VÀ ổn định hơn hẳn — nên không có lý do để chấp nhận mẫu nhỏ hơn đổi lấy
   "gần patch hiện tại hơn". Patch nào cũng được coi bình đẳng, chỉ hiển thị
   danh sách patch mỗi giải trong meta để tham khảo, không loại trừ trận nào. */
function patchKey(p) { const [a, b] = String(p).split('.').map(Number); return a * 1000 + (b || 0); }
const patchesByLeague = {};
for (const g of games) (patchesByLeague[g.league] = patchesByLeague[g.league] || new Set()).add(g.patch);
const allPatchesByLeague = {};
for (const [league, set] of Object.entries(patchesByLeague)) {
  allPatchesByLeague[league] = [...set].sort((a, b) => patchKey(b) - patchKey(a));
}
console.log(`Patch theo từng giải (không lọc gì, chỉ để hiển thị): ${Object.entries(allPatchesByLeague).map(([l, ps]) => `${l}=[${ps.join(',')}]`).join(', ')}`);

/* Trần mẫu số: giữ CAP trận gần nhất, bỏ trận xa nhất nếu vượt.
   Không xoá cache/games.json — chỉ lọc lúc huấn luyện, để đổi CAP sau
   này không cần tải lại. Số 600 ước từ tốc độ ~53 trận/tuần hiện tại,
   đủ rộng để không kích hoạt giữa một mùa giải (~10-12 tuần ~ 550-650
   trận), chỉ có tác dụng khi chạy nhiều mùa liên tiếp mà quên dọn danh
   sách giải trong TOURNAMENTS. Đo thực nghiệm (stability_test.js) không
   thấy dấu hiệu trận cũ trong 1 mùa làm loãng số liệu — trần này chống
   phình vô hạn qua nhiều mùa, không phải chống loãng trong 1 mùa. */
const GAME_CAP = 600;
let staleGames = [];
if (games.length > GAME_CAP) {
  games = [...games].sort((a, b) => a.date.localeCompare(b.date) || a.seriesId - b.seriesId);
  staleGames = games.slice(0, games.length - GAME_CAP);
  games = games.slice(games.length - GAME_CAP);
  console.log(`Vượt trần ${GAME_CAP} trận — loại ${staleGames.length} trận xa nhất ` +
    `(trước ${games[0].date}) khỏi huấn luyện, vẫn còn nguyên trong games.json.`);
}
const N = games.length;

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); };

const PRIOR_K = 12, MATCHUP_K = 8, TEAM_K = 6;
/* LAMBDA_WIN hạ 120 -> 60 (2026-09-14): với bộ đặc trưng mới (3 trục cấu trúc kit
   + WR tướng) thì lambda 20 cho AUC cao nhất (0.6103) nhưng lambda 60 cho độ chính
   xác 62.8% vs 60.2% và Brier 0.2368 vs 0.2443 — hiệu chỉnh xác suất tốt hơn đáng
   giá hơn 0.004 AUC, vì người dùng đọc con số % chứ không đọc thứ hạng. */
const LAMBDA_WIN = 60, LAMBDA_KILL = 100;
const SHORT = 28, LONG = 34;

// ------------------------------------------------------------ stats builder
function buildStats(indices) {
  const champ = {}, matchups = {}, team = {};
  const C = n => champ[n] || (champ[n] = {
    name: n, roles: {}, bans: 0, picks: 0, wins: 0, gameKills: [], gameDurs: [],
    k: 0, d: 0, a: 0, shortG: 0, shortW: 0, longG: 0, longW: 0,
  });
  for (const i of indices) {
    const g = games[i];
    const tk = g.blue.kills + g.red.kills;
    for (const sk of ['blue', 'red']) {
      const s = g[sk];
      const t = team[s.team] || (team[s.team] = { name: s.team, league: g.league, games: 0, wins: 0 });
      t.games++; if (s.win) t.wins++;
      for (const b of s.bans) C(b).bans++;
      for (const role of ROLES) {
        const p = s.comp[role]; if (!p) continue;
        const c = C(p.champion);
        const r = c.roles[role] || (c.roles[role] = { games: 0, wins: 0, k: 0, d: 0, a: 0 });
        r.games++; c.picks++;
        if (s.win) { r.wins++; c.wins++; }
        r.k += p.k || 0; r.d += p.d || 0; r.a += p.a || 0;
        c.k += p.k || 0; c.d += p.d || 0; c.a += p.a || 0;
        c.gameKills.push(tk); c.gameDurs.push(g.durationMin);
        if (g.durationMin < SHORT) { c.shortG++; if (s.win) c.shortW++; }
        if (g.durationMin > LONG) { c.longG++; if (s.win) c.longW++; }
      }
    }
    for (const role of ROLES) {
      const a = g.blue.comp[role], b = g.red.comp[role];
      if (!a || !b) continue;
      const add = (x, y, win) => {
        const rr = matchups[role] || (matchups[role] = {});
        const m = rr[x] || (rr[x] = {});
        const e = m[y] || (m[y] = { games: 0, wins: 0 });
        e.games++; if (win) e.wins++;
      };
      add(a.champion, b.champion, g.blue.win);
      add(b.champion, a.champion, g.red.win);
    }
  }
  const n = indices.length;
  const avgKills = mean(indices.map(i => games[i].blue.kills + games[i].red.kills));
  const avgDur = mean(indices.map(i => games[i].durationMin));
  return { champ, matchups, team, n, avgKills, avgDur };
}

const ATTR_DEFAULT = { engage: 0, frontline: 0, cc: 0, dmg: 'AD', scaling: 0, mobility: 0, ranged: 0 };
// role tuỳ chọn: một số tướng chơi khác hẳn build tuỳ đường (VD: Varus top AP đấu sĩ
// vs Varus ADC sát lực) — tra "Tên|đường" trước, không có thì rơi về khoá tên chung
const attrOf = (n, role) => (role && ATTRS[n + '|' + role]) || ATTRS[n] || ATTR_DEFAULT;

/* per-side aggregate of a composition, given a stats snapshot */
function sideFeatures(comp, teamName, st) {
  let sumWr = 0, sumPres = 0, engage = 0, frontline = 0, cc = 0, scaling = 0, mobility = 0, ranged = 0, ad = 0, ap = 0;
  let paceSum = 0, durSum = 0, nPace = 0;
  for (const role of ROLES) {
    const name = comp[role]; if (!name) continue;
    const c = st.champ[name];
    const r = c && c.roles[role];
    sumWr += r ? (r.wins + PRIOR_K * 0.5) / (r.games + PRIOR_K) : 0.5;
    sumPres += c ? (c.picks + c.bans) / st.n : 0;
    const at = attrOf(name, role);
    engage += at.engage; frontline += at.frontline; cc += at.cc;
    scaling += at.scaling; mobility += at.mobility; ranged += at.ranged;
    if (at.dmg === 'AP') ap += 1; else if (at.dmg === 'Mixed') { ad += 0.5; ap += 0.5; } else ad += 1;
    if (c && c.gameKills.length) { paceSum += mean(c.gameKills); durSum += mean(c.gameDurs); nPace++; }
  }
  const tw = teamName && st.team[teamName];
  return {
    sumWr, sumPres, engage, frontline, cc, scaling, mobility, ranged, ad, ap,
    mixedness: 1 - Math.abs(ad - ap) / (ad + ap || 1),
    pace: nPace ? paceSum / nPace : st.avgKills,
    lengthLean: nPace ? durSum / nPace : st.avgDur,
    teamWr: tw ? (tw.wins + TEAM_K * 0.5) / (tw.games + TEAM_K) : 0.5,
  };
}

const compOf = side => Object.fromEntries(ROLES.map(r => [r, side.comp[r] && side.comp[r].champion]));

function rowFor(g, st) {
  const B = sideFeatures(compOf(g.blue), g.blue.team, st);
  const R = sideFeatures(compOf(g.red), g.red.team, st);
  return {
    draft: [B.frontline - R.frontline, B.ranged - R.ranged, B.mobility - R.mobility, B.sumWr - R.sumWr],
    withTeam: [B.teamWr - R.teamWr, B.frontline - R.frontline, B.ranged - R.ranged,
      B.mobility - R.mobility, B.sumWr - R.sumWr],
    kill: [(B.pace + R.pace) / 2, (B.lengthLean + R.lengthLean) / 2],
    y: g.blue.win ? 1 : 0,
    totalKills: g.blue.kills + g.red.kills,
    duration: g.durationMin,
  };
}

// ------------------------------------------------------------ model fitting
function standardise(X) {
  const d = X[0].length, mu = [], sg = [];
  for (let j = 0; j < d; j++) { const col = X.map(r => r[j]); mu.push(mean(col)); sg.push(sd(col) || 1); }
  return { mu, sg, Z: X.map(r => r.map((v, j) => (v - mu[j]) / sg[j])) };
}
const applyStd = (x, mu, sg) => x.map((v, j) => (v - mu[j]) / sg[j]);

function fitLogistic(Z, y, lambda, iters = 6000, lr = 0.3) {
  const d = Z[0].length, n = Z.length, w = new Array(d).fill(0); let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b; for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const e = 1 / (1 + Math.exp(-z)) - y[i];
      for (let j = 0; j < d; j++) gw[j] += e * Z[i][j];
      gb += e;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + (lambda / n) * w[j]);
    b -= lr * (gb / n);
  }
  return { w, b };
}
const predLogit = (m, z) => { let s = m.b; for (let j = 0; j < z.length; j++) s += m.w[j] * z[j]; return 1 / (1 + Math.exp(-s)); };

function fitLinear(Z, y, lambda, iters = 6000, lr = 0.3) {
  const d = Z[0].length, n = Z.length, w = new Array(d).fill(0); let b = mean(y);
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < n; i++) {
      let p = b; for (let j = 0; j < d; j++) p += w[j] * Z[i][j];
      const e = p - y[i];
      for (let j = 0; j < d; j++) gw[j] += e * Z[i][j];
      gb += e;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + (lambda / n) * w[j]);
    b -= lr * (gb / n);
  }
  return { w, b };
}
const predLin = (m, z) => { let s = m.b; for (let j = 0; j < z.length; j++) s += m.w[j] * z[j]; return s; };

function kfold(n, k, seed = 7) {
  const idx = [...Array(n).keys()];
  let s = seed;
  for (let i = n - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return [...Array(k)].map((_, f) => ({ test: idx.filter((_, i) => i % k === f), train: idx.filter((_, i) => i % k !== f) }));
}
function auc(pairs) {
  const pos = pairs.filter(p => p.y === 1).map(p => p.p), neg = pairs.filter(p => p.y === 0).map(p => p.p);
  if (!pos.length || !neg.length) return null;
  let c = 0; for (const a of pos) for (const b of neg) c += a > b ? 1 : a === b ? 0.5 : 0;
  return c / (pos.length * neg.length);
}

// ------------------------------------------------------------ leak-free CV
const cv = { draft: [], withTeam: [], kill: [] };
for (const { train, test } of kfold(N, 5)) {
  const st = buildStats(train);
  const tr = train.map(i => rowFor(games[i], st));
  const te = test.map(i => rowFor(games[i], st));
  const y = tr.map(r => r.y);

  const sD = standardise(tr.map(r => r.draft));
  const mD = fitLogistic(sD.Z, y, LAMBDA_WIN);
  te.forEach(r => cv.draft.push({ p: predLogit(mD, applyStd(r.draft, sD.mu, sD.sg)), y: r.y }));

  const sT = standardise(tr.map(r => r.withTeam));
  const mT = fitLogistic(sT.Z, y, LAMBDA_WIN);
  te.forEach(r => cv.withTeam.push({ p: predLogit(mT, applyStd(r.withTeam, sT.mu, sT.sg)), y: r.y }));

  const sK = standardise(tr.map(r => r.kill));
  const mK = fitLinear(sK.Z, tr.map(r => r.totalKills), LAMBDA_KILL);
  te.forEach(r => cv.kill.push({ pred: predLin(mK, applyStd(r.kill, sK.mu, sK.sg)), act: r.totalKills }));
}

// ------------------------------------------------------------ production fit
const stats = buildStats([...Array(N).keys()]);
const rows = games.map(g => rowFor(g, stats));
const yAll = rows.map(r => r.y);
const sDraft = standardise(rows.map(r => r.draft));
const draftModel = fitLogistic(sDraft.Z, yAll, LAMBDA_WIN);
const sTeam = standardise(rows.map(r => r.withTeam));
const teamModel = fitLogistic(sTeam.Z, yAll, LAMBDA_WIN);
const sKill = standardise(rows.map(r => r.kill));
const killModel = fitLinear(sKill.Z, rows.map(r => r.totalKills), LAMBDA_KILL);

// ------------------------------------------------------------ metrics
const blueWR = yAll.filter(v => v === 1).length / N;
const baseLL = mean(yAll.map(y => -(y * Math.log(blueWR) + (1 - y) * Math.log(1 - blueWR))));
const allK = rows.map(r => r.totalKills), allD = rows.map(r => r.duration);

const clsMetrics = arr => ({
  cvAccuracy: mean(arr.map(r => ((r.p >= 0.5 ? 1 : 0) === r.y ? 1 : 0))),
  cvLogLoss: mean(arr.map(r => -(r.y * Math.log(Math.max(1e-9, r.p)) + (1 - r.y) * Math.log(Math.max(1e-9, 1 - r.p))))),
  cvAuc: auc(arr),
});
const calib = arr => {
  const bins = [...Array(5)].map((_, i) => ({ lo: i * 0.2, hi: (i + 1) * 0.2, n: 0, wins: 0 }));
  for (const r of arr) { const b = bins[Math.min(4, Math.floor(r.p / 0.2))]; b.n++; b.wins += r.y; }
  return bins.map(b => ({ range: [b.lo, b.hi], n: b.n, actual: b.n ? b.wins / b.n : null }));
};

const draftMetrics = { ...clsMetrics(cv.draft), calibration: calib(cv.draft) };
const teamMetrics = { ...clsMetrics(cv.withTeam), calibration: calib(cv.withTeam) };
const killMetrics = {
  cvMAE: mean(cv.kill.map(r => Math.abs(r.pred - r.act))),
  baselineMAE: mean(allK.map(v => Math.abs(v - mean(allK)))),
  cvR2: 1 - mean(cv.kill.map(r => (r.pred - r.act) ** 2)) / mean(allK.map(v => (v - mean(allK)) ** 2)),
  residualSd: Math.sqrt(mean(cv.kill.map(r => (r.pred - r.act) ** 2))),
};
const baseline = {
  blueWinRate: blueWR,
  accuracy: Math.max(blueWR, 1 - blueWR),
  logLoss: baseLL,
};

// ------------------------------------------------------------ published dataset
const champions = {};
for (const c of Object.values(stats.champ)) {
  const roles = {};
  for (const [role, r] of Object.entries(c.roles)) {
    roles[role] = {
      games: r.games, wins: r.wins,
      wr: r.games ? r.wins / r.games : null,
      wrShrunk: (r.wins + PRIOR_K * 0.5) / (r.games + PRIOR_K),
      kda: r.d ? Math.round((r.k + r.a) / r.d * 100) / 100 : (r.k + r.a),
    };
  }
  champions[c.name] = {
    name: c.name, picks: c.picks, wins: c.wins, bans: c.bans,
    wr: c.picks ? c.wins / c.picks : null,
    wrShrunk: (c.wins + PRIOR_K * 0.5) / (c.picks + PRIOR_K),
    presence: (c.picks + c.bans) / N,
    banRate: c.bans / N, roles,
    kda: c.d ? Math.round((c.k + c.a) / c.d * 100) / 100 : (c.k + c.a),
    avgGameKills: c.gameKills.length ? Math.round(mean(c.gameKills) * 10) / 10 : null,
    avgGameDur: c.gameDurs.length ? Math.round(mean(c.gameDurs) * 10) / 10 : null,
    shortGameWR: c.shortG >= 4 ? c.shortW / c.shortG : null, shortG: c.shortG,
    longGameWR: c.longG >= 4 ? c.longW / c.longG : null, longG: c.longG,
  };
}
/* Thêm tay: tướng/đường thấy trên sóng nhưng gol.gg chưa quét được (sập server,
   trận quá mới, v.v.) — chỉ thêm vào picker để chọn được, KHÔNG có số liệu thắng/thua
   giả, đánh dấu addedManually để UI hiển thị "chưa có dữ liệu" và loại khỏi mọi
   phép tính win-rate/matchup. File data/manual_champs.json không tồn tại thì bỏ qua. */
const manualChampsPath = path.join(DATA_DIR, 'manual_champs.json');
const manualChamps = fs.existsSync(manualChampsPath) ? JSON.parse(fs.readFileSync(manualChampsPath, 'utf8')) : [];
for (const { name, role } of manualChamps) {
  if (!ROLES.includes(role)) { console.log(`Bỏ qua manual_champs.json: đường "${role}" không hợp lệ (${name})`); continue; }
  if (!champions[name]) {
    champions[name] = {
      name, picks: 0, wins: 0, bans: 0, wr: null, wrShrunk: 0.5, presence: 0, banRate: 0,
      roles: {}, kda: 0, avgGameKills: null, avgGameDur: null,
      shortGameWR: null, shortG: 0, longGameWR: null, longG: 0,
      addedManually: true,
    };
  }
  if (!champions[name].roles[role]) {
    champions[name].roles[role] = { games: 0, wins: 0, wr: null, wrShrunk: 0.5, kda: 0 };
    console.log(`Thêm thủ công: ${name} @ ${role} (chưa có số liệu thật)`);
  }
}

const rolePools = {};
for (const role of ROLES) {
  rolePools[role] = Object.values(champions).filter(c => c.roles[role])
    .map(c => ({ name: c.name, games: c.roles[role].games, wr: c.roles[role].wr, wrShrunk: c.roles[role].wrShrunk }))
    .sort((a, b) => b.games - a.games);
}
const teams = {};
for (const t of Object.values(stats.team)) {
  teams[t.name] = { name: t.name, league: t.league, games: t.games, wins: t.wins, wr: t.wins / t.games,
    wrShrunk: (t.wins + TEAM_K * 0.5) / (t.games + TEAM_K) };
}
let matchupPairs = 0, matchupWithData = 0;
for (const role of Object.keys(stats.matchups))
  for (const a of Object.keys(stats.matchups[role]))
    for (const b of Object.keys(stats.matchups[role][a])) {
      matchupPairs++;
      if (stats.matchups[role][a][b].games >= 3) matchupWithData++;
    }

const baselines = {
  games: N, blueWinRate: blueWR,
  avgKills: mean(allK), sdKills: sd(allK), killsP10: quantile(allK, 0.1), killsP90: quantile(allK, 0.9),
  avgDuration: mean(allD), sdDuration: sd(allD), durP10: quantile(allD, 0.1), durP90: quantile(allD, 0.9),
  byLeague: {}, byPatch: {},
};
for (const g of games) for (const [key, val] of [['byLeague', g.league], ['byPatch', g.patch]]) {
  const b = baselines[key][val] || (baselines[key][val] = { games: 0, blueWins: 0, k: 0, d: 0 });
  b.games++; b.blueWins += g.blue.win ? 1 : 0; b.k += g.blue.kills + g.red.kills; b.d += g.durationMin;
}
for (const key of ['byLeague', 'byPatch']) for (const k of Object.keys(baselines[key])) {
  const b = baselines[key][k];
  b.blueWinRate = b.blueWins / b.games;
  b.avgKills = Math.round(b.k / b.games * 10) / 10;
  b.avgDuration = Math.round(b.d / b.games * 10) / 10;
  delete b.k; delete b.d;
}

// Đối chiếu độc lập: số game + tên đội của mỗi series (theo games.json, đã parse
// từng trận) phải khớp với bảng kết quả giải (series.json, đọc từ trang matchlist).
// Đây là lớp kiểm chứng thứ 3 — không dùng lại dữ liệu vừa parse để tự xác nhận chính nó.
function checkSeries() {
  if (!seriesList.length) return { checked: 0, matched: 0 };
  const bySeries = {};
  for (const g of rawGames) (bySeries[g.seriesId] = bySeries[g.seriesId] || []).push(g);
  let matched = 0;
  for (const s of seriesList) {
    const gs = bySeries[s.seriesId] || [];
    if (gs.length !== s.games) continue;
    const teams = new Set(gs.flatMap(g => [g.blue.team, g.red.team]));
    if (teams.size === 2) matched++;
  }
  return { checked: seriesList.length, matched };
}
const seriesCheck = checkSeries();

const out = {
  meta: {
    source: 'gol.gg', method: 'per-game static pages parsed locally',
    builtAt: new Date().toISOString().slice(0, 10),
    games: N,
    dateFrom: games.reduce((a, g) => g.date < a ? g.date : a, '9999'),
    dateTo: games.reduce((a, g) => g.date > a ? g.date : a, '0000'),
    leagues: Object.keys(baselines.byLeague),
    tournaments: [...new Set(games.map(g => g.tournament))].sort(),
    patches: Object.keys(baselines.byPatch).sort(),
    champions: Object.keys(champions).length,
    matchupPairs, matchupWithData,
    priors: { championWinRateK: PRIOR_K, matchupK: MATCHUP_K, teamK: TEAM_K },
    gameCap: { limit: GAME_CAP, excludedAsStale: staleGames.length,
      totalScanned: rawGames.length, oldestKept: games.length ? games[0].date : null },
    patchesByLeague: allPatchesByLeague,
    integrity: {
      picksMatchScoreboard: rawGames.filter(g => g.integrity.picksMatchScoreboard).length,
      picksMatchScoreboardOf: rawGames.length,
      droppedFromTraining: droppedGames.length,
      killTotalsMatch: rawGames.filter(g => g.integrity.killTotalsMatch).length,
      killTotalsMatchOf: rawGames.length,
      seriesChecked: seriesCheck.checked, seriesScoreMatch: seriesCheck.matched,
      goldLeaderWon: rawGames.filter(g => (g.blue.gold > g.red.gold) === g.blue.win).length,
      goldLeaderWonOf: rawGames.length,
    },
    /* measured AUC of every candidate signal, leak-free — the audit trail
       behind which features the shipped model is allowed to use */
    /* 2026-09-14 — đo lại toàn bộ bằng phương pháp chặt hơn hẳn lần trước: so sánh
       THEO CẶP (cùng cách chia fold, trừ trực tiếp) qua 20 seed, cộng walk-forward
       toàn dải 339 trận và bootstrap 2000 lần. Lần đo cũ (bảng bên dưới trước đây)
       kiểm định từng tín hiệu RIÊNG LẺ chống baseline, nên bỏ sót việc một tín hiệu
       yếu vẫn có ích khi đứng CẠNH tín hiệu khác — đó là lý do frontline/ranged/
       mobility từng bị xếp "nhiễu" (AUC 0.45-0.49 đơn lẻ) nhưng thực ra đóng góp thật
       khi đi cùng sức mạnh đội. */
    signalAudit: [
      { feature: 'teamStrength', auc: 0.633, used: true, note: 'sức mạnh đội — vẫn là trục mạnh nhất; chỉ dùng khi đã chọn đủ 2 đội' },
      { feature: 'frontline', auc: 0.643, used: true, note: 'tổng tuyến đầu — thêm vào baseline đội hình: +0.0097 AUC, thắng 20/20 seed. Đội hình nhiều tuyến đầu thắng đội hình mỏng manh' },
      { feature: 'sumWr', auc: 0.610, used: true, note: 'tỉ lệ thắng tướng theo vị trí — có ích thật, nhưng vô dụng với tướng mới nên không để đứng một mình' },
      { feature: 'ranged', auc: 0.638, used: true, note: 'số tướng tầm xa — càng nhiều carry tầm xa mỏng manh càng bất lợi ở meta này (+0.0062)' },
      { feature: 'mobility', auc: 0.636, used: true, note: 'tổng cơ động (+0.0037) — bổ trợ cho 2 trục trên' },
      { feature: 'scaling', auc: 0.603, used: false, note: 'LOẠI 2026-09-14: bootstrap cho thấy bỏ scaling TỐT HƠN giữ (+0.0078 AUC, KTC 95% [0.0006, 0.0151]); hệ số của nó còn đổi dấu giữa nửa đầu/nửa sau dữ liệu' },
      { feature: 'kitCounter (ma trận khắc chế 8x8)', auc: 0.627, used: false, note: 'LOẠI: học ma trận tương tác kit×kit giữa 2 đội — trong nhiễu (+0.0005)' },
      { feature: 'kitSynergy (ma trận phối hợp)', auc: 0.630, used: false, note: 'LOẠI: tương tác kit trong cùng đội — trong nhiễu (+0.0021)' },
      { feature: 'playerWr', auc: 0.629, used: false, note: 'LOẠI: WR từng tuyển thủ — tệ hơn baseline ở 20/20 seed (trùng lặp với sức mạnh đội, chỉ thêm nhiễu)' },
      { feature: 'matchupEdge', auc: 0.548, used: false, note: 'đối đầu trực tiếp — quá nhiễu, chỉ dùng để hiển thị' },
      { feature: 'cc', auc: 0.631, used: false, note: 'tổng CC — không đạt ngưỡng khi chọn lọc tiến tới' },
      { feature: 'engage', auc: 0.632, used: false, note: 'công cụ mở giao tranh — không đạt ngưỡng (+0.0002)' },
      { feature: 'presence', auc: 0.500, used: false, note: 'mức ưu tiên pick/ban — không có tín hiệu' },
    ],
    /* Kiểm định mô phỏng TƯỚNG MỚI (walk-forward 339 trận, che dữ liệu win-rate lúc
       dự đoán theo tỉ lệ tướng lạ trong trận). Con số = AUC.
                              0% mới   10%     20%     40%
       cũ (sumWr+scaling)     0.6026   0.5980  0.5934  0.5842
       chỉ sumWr              0.6104   0.6044  0.6010  0.5925
       chỉ kit (không sumWr)  0.5984   0.5984  0.5984  0.5984
       ĐANG DÙNG (kit+sumWr)  0.6103   0.6047  0.6022  0.5934   <- tốt nhất mọi mức */
    newChampAudit: {
      method: 'walk-forward 339 trận, che win-rate tướng lúc dự đoán',
      rates: [0, 0.1, 0.2, 0.4],
      shipped: [0.6103, 0.6047, 0.6022, 0.5934],
      previous: [0.6026, 0.5980, 0.5934, 0.5842],
      kitOnly: [0.5984, 0.5984, 0.5984, 0.5984],
      champWrOnly: [0.6104, 0.6044, 0.6010, 0.5925],
    },
    durationModel: null,
  },
  baselines, baseline,
  champions, matchups: stats.matchups, rolePools, teams,
  attrs: Object.fromEntries(Object.entries(ATTRS).filter(([k]) =>
    champions[k] || champions[k.split('|')[0]])),
  attrsMissing: Object.keys(champions).filter(n => !ATTRS[n]),
  models: {
    draft: { features: ['frontline', 'ranged', 'mobility', 'sumWr'], w: draftModel.w, b: draftModel.b, mu: sDraft.mu, sg: sDraft.sg, lambda: LAMBDA_WIN, metrics: draftMetrics },
    withTeam: { features: ['teamStrength', 'frontline', 'ranged', 'mobility', 'sumWr'], w: teamModel.w, b: teamModel.b, mu: sTeam.mu, sg: sTeam.sg, lambda: LAMBDA_WIN, metrics: teamMetrics },
    kills: { features: ['pace', 'lengthLean'], w: killModel.w, b: killModel.b, mu: sKill.mu, sg: sKill.sg, lambda: LAMBDA_KILL, metrics: killMetrics },
  },
};
fs.writeFileSync(path.join(DATA_DIR, 'dataset.json'), JSON.stringify(out));

// ------------------------------------------------------------ report
console.log(`games=${N}  ${out.meta.dateFrom}..${out.meta.dateTo}  champions=${out.meta.champions}`);
console.log(`attrs missing: ${out.attrsMissing.length ? out.attrsMissing.join(', ') : '(none)'}`);
console.log(`\nbaseline (always blue): acc=${(baseline.accuracy * 100).toFixed(1)}%  logloss=${baseLL.toFixed(4)}`);
console.log(`draft-only model:  acc=${(draftMetrics.cvAccuracy * 100).toFixed(1)}%  AUC=${draftMetrics.cvAuc.toFixed(3)}  logloss=${draftMetrics.cvLogLoss.toFixed(4)}  w=[${draftModel.w.map(x => x.toFixed(3))}]`);
console.log(`draft+team model:  acc=${(teamMetrics.cvAccuracy * 100).toFixed(1)}%  AUC=${teamMetrics.cvAuc.toFixed(3)}  logloss=${teamMetrics.cvLogLoss.toFixed(4)}  w=[${teamModel.w.map(x => x.toFixed(3))}]`);
console.log(`kills model:       MAE=${killMetrics.cvMAE.toFixed(2)} vs baseline ${killMetrics.baselineMAE.toFixed(2)}  R2=${killMetrics.cvR2.toFixed(3)}`);
console.log('\ndraft calibration:', draftMetrics.calibration.map(c => `${(c.range[0] * 100).toFixed(0)}-${(c.range[1] * 100).toFixed(0)}: n=${c.n}/${c.actual == null ? '-' : (c.actual * 100).toFixed(0) + '%'}`).join('  '));
console.log('team  calibration:', teamMetrics.calibration.map(c => `${(c.range[0] * 100).toFixed(0)}-${(c.range[1] * 100).toFixed(0)}: n=${c.n}/${c.actual == null ? '-' : (c.actual * 100).toFixed(0) + '%'}`).join('  '));
console.log(`\ndataset.json ${(fs.statSync(path.join(DATA_DIR, 'dataset.json')).size / 1024).toFixed(0)} KB`);
