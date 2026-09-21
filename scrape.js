'use strict';
const fs = require('fs');
const path = require('path');
const { parseGame } = require('./parse.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
// Cache HTML cục bộ: chỉ để tăng tốc khi chạy trên máy có ổ đĩa bền (không mất giữa
// các lần chạy). Trên GitHub Actions, mỗi lần chạy là một máy ảo sạch — cache này
// trống, nên tính năng "bỏ qua trận đã có trong games.json" (bên dưới) mới là cơ chế
// tăng tiến THẬT SỰ, không phụ thuộc cache có sống sót giữa các lần chạy hay không.
const CACHE = path.join(__dirname, 'cache');
fs.mkdirSync(CACHE, { recursive: true });

const CUTOFF = process.env.CUTOFF || "2026-08-06";   // đổi bằng config.js hoặc biến môi trường

/* tier:
     'major'         — giải khu vực lớn, nguồn chính cho thống kê tướng
     'international' — giải LIÊN KHU VỰC. Đây là loại trận DUY NHẤT cho phép so sánh
                       sức mạnh giữa các khu vực với nhau. Không có chúng, đồ thị đối
                       đầu rời thành các cụm không nối nhau và "Gen.G 70% (LCK)" với
                       "Karmine Corp 79% (LEC)" là hai con số đo bằng hai thước khác
                       nhau, về nguyên tắc không so sánh được.
     'minor'         — giải khu vực nhỏ; thêm khi cần đội đó cho CKTG.
   from: mốc ngày riêng, ghi đè CUTOFF. Giải quốc tế diễn ra tháng 3-7/2026, nằm
   NGOÀI cửa sổ 8 tuần gần đây, nên nếu dùng CUTOFF chung thì bị loại sạch. */
const TOURNAMENTS = [
  { league: 'LCK', name: 'LCK 2026 Rounds 3-4', tier: 'major' },
  { league: 'LCK', name: 'LCK 2026 Season Play-In', tier: 'major' },
  { league: 'LCK', name: 'LCK 2026 Season Playoffs', tier: 'major' },
  { league: 'LPL', name: 'LPL 2026 Split 3', tier: 'major' },
  { league: 'LPL', name: 'LPL 2026 Grand Finals', tier: 'major' },
  { league: 'LEC', name: 'LEC 2026 Summer Season', tier: 'major' },
  { league: 'LEC', name: 'LEC 2026 Summer Playoffs', tier: 'major' },

  // 'minor': thêm để có dữ liệu khu vực nhà cho đội dự CKTG (xem data/worlds_teams.json)
  // 2026-09-21: pool giải CHỈ gồm LCK/LPL/LEC/LCP/LCS theo yêu cầu người dùng —
  // đã thử thêm CBLOL/LJL/TCL/PCS/VCS rồi bỏ lại (quá yếu, không cần theo dõi).
  { league: 'LCP', name: 'LCP 2026 Split 3', tier: 'minor' },
  { league: 'LCS', name: 'LCS 2026 Summer', tier: 'minor' },
  { league: 'LCS', name: 'LCS 2026 Summer Playoffs', tier: 'minor' },

  { league: 'INT', name: 'MSI 2026', tier: 'international', from: '2026-01-01' },
  { league: 'INT', name: 'Esports World Cup 2026', tier: 'international', from: '2026-01-01' },
  { league: 'INT', name: '2026 First Stand', tier: 'international', from: '2026-01-01' },
];

/* ============================================================================
   QUÉT NHẸ THEO ĐỘI — thay thế cho quét cả giải (TOURNAMENTS ở trên) khi chỉ
   cần vài đội cụ thể của 1 khu vực (VD: 3-4 đội dự CKTG) mà không cần cả 60-100
   trận của toàn giải. Lấy game ID trực tiếp từ trang riêng của đội trên gol.gg
   (team-matchlist) rồi tải từng trận như bình thường — parse.js tự đọc ngày,
   patch, tên giải NGAY TRÊN trang trận, không cần matchlist cung cấp.

   ĐÁNH ĐỔI: chỉ thấy các trận CÓ đội trong watchlist tham gia, nên hiệu ứng khu
   vực (rating phân cấp) được ước lượng từ mẫu hẹp hơn — chỉ những đối thủ mà
   đội watchlist từng gặp, không phải toàn bộ vòng tròn của giải. Dùng
   TOURNAMENTS nếu cần độ chính xác cao nhất cho 1 khu vực; dùng cách này khi
   chỉ cần đủ dữ liệu tối thiểu để đội đó có mặt trong rating.

   Cách lấy teamId: mở https://gol.gg/teams/list/season-S16/split-Summer/tournament-ALL/
   rồi tìm link "team-stats/<ID>/..." cạnh tên đội (tên trong link phải khớp
   CHÍNH XÁC tên trên gol.gg, không phải tên viết tắt — xem teamName bên dưới). */
const TEAM_WATCHLIST = [
  // { teamId: 1234, teamName: 'Tên đúng như gol.gg hiển thị', league: 'LCS', tier: 'minor' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Dùng fetch() gốc của Node thay vì shell ra curl.exe. Lý do (2026-09-07):
   execFileSync('curl.exe', ['-o', cf, ...]) từng âm thầm hỏng khi cf nằm trong
   đường dẫn có ký tự Unicode dấu tiếng Việt ("Thư mục") — curl trả HTTP 200 nhưng
   ghi file 0 byte (exit code 23 = CURLE_WRITE_ERROR), vì tham số -o bị lệch mã hoá
   khi truyền qua subprocess. fetch() + fs.writeFileSync chạy hoàn toàn trong tiến
   trình Node bằng chuỗi UTF-16 nội bộ, không qua subprocess nào nên không còn nguy
   cơ đó — và cũng portable sang Linux nếu sau này chuyển sang chạy trên máy chủ. */
async function fetchUrl(url, cacheKey, forceFresh) {
  const cf = path.join(CACHE, cacheKey);
  if (!forceFresh && fs.existsSync(cf) && fs.statSync(cf).size > 10000) return fs.readFileSync(cf, 'utf8');
  const oldSize = fs.existsSync(cf) ? fs.statSync(cf).size : 0;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; await sleep(1500); continue; }
      const text = await res.text();
      if (text.length > 10000) { fs.writeFileSync(cf, text, 'utf8'); return text; }
      lastErr = `body quá ngắn (${text.length} byte)`;
    } catch (e) { lastErr = e.message; }
    await sleep(1500);
  }
  // Tải mới thất bại sau 3 lần thử — dùng tạm bản cache cũ để không bỏ trắng cả giải
  // hôm đó, NHƯNG phải la lớn ra console: im lặng ở đây từng khiến quét tự động không
  // phát hiện trận mới suốt nhiều ngày mà không ai biết (xem CHANGELOG 2026-09-07).
  if (forceFresh && fs.existsSync(cf) && fs.statSync(cf).size > 10000) {
    console.error(`  !! CẢNH BÁO: tải mới "${cacheKey}" thất bại sau 3 lần thử (${lastErr}), đang DÙNG TẠM ` +
      `bản cache cũ (size cũ=${oldSize}) — danh sách trận của giải này có thể ĐANG THIẾU trận mới nhất.`);
    return fs.readFileSync(cf, 'utf8');
  }
  if (lastErr) console.error(`  !! Không tải được "${cacheKey}": ${lastErr}`);
  return null;
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
          .replace(/&nbsp;/g, ' ').trim();
}

// ---------- 1. Match lists ----------
function parseMatchlist(html, tour) {
  const h = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const body = h.slice(h.indexOf('results</caption>'));
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
  const out = [];
  for (const r of rows) {
    const link = r.match(/game\/stats\/(\d+)\/page-summary\/'\s+title='([^']*?) summary'/);
    if (!link) continue;
    const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => decode(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' '));
    // cells: [matchup, teamA, score, teamB, week, patch, date]
    const score = (cells[2] || '').match(/(\d+)\s*-\s*(\d+)/);
    const date = (cells[6] || '').match(/\d{4}-\d{2}-\d{2}/);
    if (!score || !date) continue;
    out.push({
      league: tour.league,
      tier: tour.tier || 'major',
      tournament: tour.name,
      seriesId: +link[1],
      matchup: decode(link[2]),
      teamRight: cells[1] || null,   // right-aligned team column
      teamLeft: cells[3] || null,
      games: +score[1] + +score[2],
      week: cells[4] || null,
      patch: cells[5] || null,
      date: date[0],
    });
  }
  return out;
}

/* Trả về danh sách {gameId, seriesId, gameInSeries} lấy từ trang riêng của 1 đội.
   Không có ngày/giải kèm theo — parse.js sẽ tự đọc từ trang trận lúc tải. */
async function fetchTeamGameRefs(entry) {
  const url = `https://gol.gg/teams/team-matchlist/${entry.teamId}/split-Summer/tournament-ALL/`;
  const html = await fetchUrl(url, `tm_${entry.teamId}.html`, true);
  if (!html) { console.error('FAILED team-matchlist', entry.teamName); return []; }
  const capIdx = html.indexOf(`${entry.teamName} results</caption>`);
  if (capIdx < 0) {
    console.error(`  !! CẢNH BÁO: không thấy "${entry.teamName} results</caption>" trên trang team-matchlist/${entry.teamId} — ` +
      `tên đội có thể không khớp gol.gg, hoặc split "Summer" trống cho đội này. Bỏ qua.`);
    return [];
  }
  const rows = [...html.slice(capIdx).matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
  const out = [];
  for (const r of rows) {
    const link = r.match(/href='\.\.\/game\/stats\/(\d+)\/page-game\/'[^>]*>[^<]*\((\d+)\)<\/a>/);
    if (!link) continue;
    const gameId = +link[1], gameInSeries = +link[2];
    out.push({ gameId, seriesId: gameId - (gameInSeries - 1), gameInSeries });
  }
  console.error(`${entry.teamName} (${entry.league}): ${out.length} trận tìm thấy trên trang riêng của đội`);
  return out;
}

async function main() {
  // Nếu 1 giải fetch thất bại HOÀN TOÀN (không còn cache nào dùng tạm được), giữ lại
  // các series cũ của đúng giải đó từ series.json thay vì để trống — tránh lặp lại sự
  // cố 2026-09-14: gol.gg sập toàn bộ khiến file bị ghi đè bằng danh sách rỗng.
  const oldSeriesPath = path.join(DATA_DIR, 'series.json');
  const oldSeries = fs.existsSync(oldSeriesPath) ? JSON.parse(fs.readFileSync(oldSeriesPath, 'utf8')) : [];
  const allSeries = [];
  let anyHardFail = false;
  for (const t of TOURNAMENTS) {
    const url = 'https://gol.gg/tournament/tournament-matchlist/' + encodeURIComponent(t.name) + '/';
    const html = await fetchUrl(url, 'ml_' + t.name.replace(/[^A-Za-z0-9]/g, '_') + '.html', true);
    if (!html) {
      console.error('FAILED matchlist', t.name, '— giữ nguyên series cũ của giải này (nếu có)');
      anyHardFail = true;
      allSeries.push(...oldSeries.filter(s => s.tournament === t.name && s.date >= (t.from || CUTOFF)));
      continue;
    }
    const series = parseMatchlist(html, t);
    const floor = t.from || CUTOFF;          // giải quốc tế có mốc riêng, xem chú thích TOURNAMENTS
    const recent = series.filter(s => s.date >= floor);
    console.error(`${t.name}: ${series.length} series total, ${recent.length} since ${floor}`);
    allSeries.push(...recent);
    await sleep(300);   // lịch sự với gol.gg, tránh dồn dập request
  }

  allSeries.sort((a, b) => a.date.localeCompare(b.date) || a.seriesId - b.seriesId);
  const totalGames = allSeries.reduce((s, x) => s + x.games, 0);
  console.error(`\n=> ${allSeries.length} series / ~${totalGames} games trong cửa sổ thời gian` +
    (anyHardFail ? ' (MỘT SỐ GIẢI DÙNG DỮ LIỆU CŨ vì fetch thất bại hoàn toàn)' : '') + '\n');
  fs.writeFileSync(oldSeriesPath, JSON.stringify(allSeries, null, 1));
  if (process.env.DRY) {
    const byT = allSeries.reduce((a, s) => (a[s.tournament] = (a[s.tournament] || 0) + s.games, a), {});
    console.error('games per tournament:', JSON.stringify(byT, null, 1));
    console.error('date range:', allSeries[0] && allSeries[0].date, '->', allSeries[allSeries.length - 1] && allSeries[allSeries.length - 1].date);
    return;
  }

  // ---------- 2. Games ----------
  // Tăng tiến thật sự: nạp games.json đã có sẵn (nếu có) và CHỈ tải/parse những
  // game ID chưa từng thấy. Quan trọng cho GitHub Actions vì mỗi lần chạy là một
  // máy ảo sạch — không có cache/ sống sót giữa các lần — nên nếu không có cơ chế
  // này, mỗi lần chạy sẽ tải lại TOÀN BỘ ~500 trận từ đầu, vừa chậm vừa làm phiền gol.gg.
  const gamesPath = path.join(DATA_DIR, 'games.json');
  const existingGames = fs.existsSync(gamesPath) ? JSON.parse(fs.readFileSync(gamesPath, 'utf8')) : [];
  const knownIds = new Set(existingGames.map(g => g.gameId));
  console.error(`Đã có sẵn ${existingGames.length} trận trong data/games.json — chỉ tải trận mới.\n`);

  const newGames = [];
  const failures = [];
  const toFetch = [];
  for (const s of allSeries) for (let i = 0; i < s.games; i++) toFetch.push({ s, i, id: s.seriesId + i });
  const pending = toFetch.filter(x => !knownIds.has(x.id));
  console.error(`${toFetch.length} game ID trong cửa sổ, ${pending.length} ID chưa có sẵn cần tải.\n`);

  // Quét nhẹ theo đội (TEAM_WATCHLIST) — mỗi trận đóng gói kèm entry để biết
  // gán league/tier nào; ngày/giải/tuần lấy từ chính trang trận lúc tải.
  const teamPending = [];
  for (const entry of TEAM_WATCHLIST) {
    const refs = await fetchTeamGameRefs(entry);
    for (const ref of refs) if (!knownIds.has(ref.gameId) && !pending.some(p => p.id === ref.gameId)) {
      teamPending.push({ ...ref, entry });
    }
    await sleep(300);
  }
  if (teamPending.length) console.error(`\n${teamPending.length} trận từ TEAM_WATCHLIST chưa có sẵn cần tải.\n`);

  let done = 0;
  for (const { s, i, id } of pending) {
    const url = `https://gol.gg/game/stats/${id}/page-game/`;
    const html = await fetchUrl(url, `g_${id}.html`);
    done++;
    if (!html) { failures.push({ id, series: s.matchup, reason: 'fetch failed' }); continue; }
    const g = parseGame(html, id);
    if (!g.ok) { failures.push({ id, series: s.matchup, reason: g.error }); continue; }
    // integrity: kill totals must equal sum of player kills
    const ksum = side => Object.values(side.comp).reduce((a, p) => a + (p.k || 0), 0);
    const killsMatch = ksum(g.blue) === g.blue.kills && ksum(g.red) === g.red.kills;
    // integrity: parsed teams must match the series matchup
    const teams = [g.blue.team, g.red.team].join('|');
    newGames.push({
      ...g,
      league: s.league, tier: s.tier || 'major', tournament: s.tournament, date: s.date,
      week: s.week, seriesId: s.seriesId, gameInSeries: i + 1,
      integrity: {
        picksMatchScoreboard: g.warnings.length === 0,
        killTotalsMatch: killsMatch,
        teams,
      },
    });
    if (done % 20 === 0) console.error(`  ...${done}/${pending.length} tải xong (${newGames.length} ok)`);
  }

  let teamDone = 0, teamSkippedOld = 0;
  for (const { gameId, seriesId, gameInSeries, entry } of teamPending) {
    const url = `https://gol.gg/game/stats/${gameId}/page-game/`;
    const html = await fetchUrl(url, `g_${gameId}.html`);
    teamDone++;
    if (!html) { failures.push({ id: gameId, series: entry.teamName, reason: 'fetch failed' }); continue; }
    const g = parseGame(html, gameId);
    if (!g.ok) { failures.push({ id: gameId, series: entry.teamName, reason: g.error }); continue; }
    if (!g.dateFromPage) { failures.push({ id: gameId, series: entry.teamName, reason: 'không đọc được ngày trên trang trận' }); continue; }
    const floor = entry.from || CUTOFF;
    if (g.dateFromPage < floor) { teamSkippedOld++; continue; }   // ngoài cửa sổ thời gian, bỏ qua
    const ksum = side => Object.values(side.comp).reduce((a, p) => a + (p.k || 0), 0);
    const killsMatch = ksum(g.blue) === g.blue.kills && ksum(g.red) === g.red.kills;
    newGames.push({
      ...g,
      league: entry.league, tier: entry.tier || 'minor',
      tournament: g.tournamentFromPage || entry.league, date: g.dateFromPage,
      week: g.weekFromPage, seriesId, gameInSeries,
      integrity: { picksMatchScoreboard: g.warnings.length === 0, killTotalsMatch: killsMatch,
        teams: [g.blue.team, g.red.team].join('|') },
    });
    if (teamDone % 20 === 0) console.error(`  ...${teamDone}/${teamPending.length} (team-watchlist) tải xong`);
  }
  if (teamPending.length) console.error(`TEAM_WATCHLIST: +${teamPending.length - teamSkippedOld - failures.filter(f=>teamPending.some(t=>t.gameId===f.id)).length} trận mới, ${teamSkippedOld} bỏ qua vì ngoài cửa sổ thời gian.\n`);

  // Games ngoài cửa sổ CUTOFF (đã cũ) trong games.json cũ vẫn giữ nguyên — chỉ nối
  // thêm trận mới, không xoá lịch sử đã có (trần 600 trận xử lý ở finalize.js).
  const games = [...existingGames, ...newGames];
  fs.writeFileSync(gamesPath, JSON.stringify(games, null, 1));
  fs.writeFileSync(path.join(DATA_DIR, 'failures.json'), JSON.stringify(failures, null, 1));

  const bad = newGames.filter(g => !g.integrity.picksMatchScoreboard || !g.integrity.killTotalsMatch);
  console.error(`\nDONE: +${newGames.length} trận mới (tổng ${games.length}), ${failures.length} lỗi tải, ${bad.length} cảnh báo toàn vẹn`);
  console.error('leagues (trận mới):', JSON.stringify(newGames.reduce((a, g) => (a[g.league] = (a[g.league] || 0) + 1, a), {})));
  console.error('patches (trận mới):', JSON.stringify(newGames.reduce((a, g) => (a[g.patch] = (a[g.patch] || 0) + 1, a), {})));
  if (failures.length) console.error('failures sample:', JSON.stringify(failures.slice(0, 10)));
  if (bad.length) console.error('integrity sample:', JSON.stringify(bad.slice(0, 5).map(g => ({ id: g.gameId, w: g.warnings, k: g.integrity }))));
}

main().catch(e => { console.error('LỖI KHÔNG XỬ LÝ ĐƯỢC:', e); process.exitCode = 1; });
