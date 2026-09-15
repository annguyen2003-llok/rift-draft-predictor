'use strict';
/* Parser for gol.gg /game/stats/<id>/page-game/ pages.
   Extracts exact data from static HTML. No inference except role-by-row-order,
   which is validated separately (picks-set match + player row consistency). */

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&nbsp;/g, ' ').trim();
}

function parseGame(html, gameId) {
  const err = [];
  // Drop scripts to avoid matching JS strings
  const h = html.replace(/<script[\s\S]*?<\/script>/gi, '');

  // ---- Game time & patch ----
  const timeM = h.match(/Game Time<br\/>\s*<h1>([0-9]+:[0-9]{2})<\/h1>/i);
  const patchM = h.match(/<div class="col-3 text-right">\s*v([0-9.]+)<\/div>/i);
  /* Trang từng trận cũng tự mang ngày + giải + tuần (không chỉ matchlist mới có) —
     dùng làm phương án dự phòng cho lối quét theo ĐỘI (team-matchlist), nơi không
     đi qua trang matchlist của giải nên không có sẵn các trường này. */
  const dateM = h.match(/<div class="col-12 col-sm-5 text-right">\s*(\d{4}-\d{2}-\d{2})\s*\(([^)]*)\)/i);
  const tourM = h.match(/<a href='\.\.\/tournament\/tournament-stats\/[^']*'>([^<]*)<\/a>/i);

  // ---- Team header blocks (side + name + result) ----
  const blueHdr = h.match(/<div class="col-12 blue-line-header">\s*<a[^>]*title='([^']*?) stats'[^>]*>([^<]*)<\/a>\s*-\s*(WIN|LOSS)/i);
  const redHdr  = h.match(/<div class="col-12 red-line-header">\s*<a[^>]*title='([^']*?) stats'[^>]*>([^<]*)<\/a>\s*-\s*(WIN|LOSS)/i);
  if (!blueHdr || !redHdr) return { ok: false, gameId, error: 'team headers not found' };

  const iBlue = h.indexOf(blueHdr[0]);
  const iRed  = h.indexOf(redHdr[0]);
  if (iBlue < 0 || iRed < 0 || iRed < iBlue) return { ok: false, gameId, error: 'unexpected header order' };

  // ---- Objective score boxes, scoped per side by CSS class ----
  const num = (seg, alt) => {
    const re = new RegExp("score-box\\s+" + seg + "_line\"><img src=\"[^\"]*\" alt='" + alt + "'\\/>\\s*([0-9.]+k?)", 'i');
    const m = h.match(re);
    return m ? m[1] : null;
  };
  const toNum = v => v == null ? null : (/k$/i.test(v) ? Math.round(parseFloat(v) * 1000) : parseInt(v, 10));

  // ---- Bans & picks, scoped to each team's column block ----
  // Blue block = [iBlue, iRed); Red block = [iRed, start of player tables)
  const iPlayers = h.indexOf("playersInfosLine");
  const blueBlock = h.slice(iBlue, iRed);
  const redBlock  = h.slice(iRed, iPlayers > iRed ? iPlayers : h.length);

  function champsIn(block, label) {
    // Grab the col-10 div that follows the "Bans"/"Picks" label
    const re = new RegExp("<div class=\"col-2\">" + label + "[\\s\\S]*?<div class=\"col-10\">([\\s\\S]*?)<\\/div>", 'i');
    const m = block.match(re);
    if (!m) return null;
    // gol.gg renders an unused ban slot as a "void.png" placeholder with
    // alt='No ban' — it's not a champion, it means the team skipped that ban.
    return [...m[1].matchAll(/alt='([^']+)'\s+src='\.\.\/_img\/champions_icon\/([^']*)'/g)]
      .filter(x => !/void\.png$/i.test(x[2]))
      .map(x => decode(x[1]));
  }

  const blueBans = champsIn(blueBlock, 'Bans');
  const redBans  = champsIn(redBlock, 'Bans');
  const bluePicks = champsIn(blueBlock, 'Picks');
  const redPicks  = champsIn(redBlock, 'Picks');

  // ---- Player scoreboard cells (document order; row order = TOP, JGL, MID, ADC, SUP) ----
  // Nested <table> tooltips make outer-table matching unsafe, so match the
  // champion-icon + player-link cell directly and assign side by nearest
  // preceding blue-/red-line-header.
  const cellRe = /alt='([^']+)' src='\.\.\/_img\/champions_icon\/[^']*'\/><\/a>&nbsp;<a class='link-blanc' href='\.\.\/players\/player-stats\/(\d+)\/[^']*' title='([^']*?) stats'>([^<]*)<\/a>/g;
  const cells = [...h.matchAll(cellRe)];
  if (cells.length !== 10) return { ok: false, gameId, error: 'expected 10 player cells, got ' + cells.length };

  const headers = [...h.matchAll(/(blue|red)-line-header/g)].map(m => ({ side: m[1], idx: m.index }));
  const sideOf = idx => {
    let side = null;
    for (const hd of headers) { if (hd.idx < idx) side = hd.side; else break; }
    return side;
  };

  const bluePlayers = [], redPlayers = [];
  cells.forEach((m, i) => {
    const tail = h.slice(m.index, cells[i + 1] ? cells[i + 1].index : m.index + 40000);
    const kda = tail.match(/>(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)</);
    const rec = {
      champion: decode(m[1]),
      playerId: m[2],
      player: decode(m[4] || m[3]),
      k: kda ? +kda[1] : null, d: kda ? +kda[2] : null, a: kda ? +kda[3] : null,
    };
    (sideOf(m.index) === 'red' ? redPlayers : bluePlayers).push(rec);
  });

  if (bluePlayers.length !== 5 || redPlayers.length !== 5) {
    return { ok: false, gameId, error: `player count ${bluePlayers.length}/${redPlayers.length}` };
  }

  // ---- INTEGRITY CHECK: picks list (draft order) must equal player-table champion set ----
  const setEq = (a, b) => a && b && a.length === b.length &&
    [...a].sort().join('|') === [...b].sort().join('|');
  const blueOk = setEq(bluePicks, bluePlayers.map(p => p.champion));
  const redOk  = setEq(redPicks, redPlayers.map(p => p.champion));
  if (!blueOk) err.push('blue picks/scoreboard mismatch');
  if (!redOk) err.push('red picks/scoreboard mismatch');

  const mkSide = (hdr, seg, players, bans, picks) => ({
    team: decode(hdr[2] || hdr[1]),
    teamFull: decode(hdr[1]),
    win: hdr[3].toUpperCase() === 'WIN',
    kills: toNum(num(seg, 'Kills')),
    towers: toNum(num(seg, 'Towers')),
    dragons: toNum(num(seg, 'Dragons')),
    barons: toNum(num(seg, 'Nashor')),
    gold: toNum(num(seg, 'Team Gold')),
    bans: bans || [],
    picksDraftOrder: picks || [],
    comp: Object.fromEntries(players.map((p, i) => [ROLES[i], p])),
  });

  const durStr = timeM ? timeM[1] : null;
  const durMin = durStr ? (+durStr.split(':')[0] + (+durStr.split(':')[1]) / 60) : null;

  return {
    ok: true,
    gameId,
    duration: durStr,
    durationMin: durMin ? Math.round(durMin * 100) / 100 : null,
    patch: patchM ? patchM[1] : null,
    dateFromPage: dateM ? dateM[1] : null,
    weekFromPage: dateM ? dateM[2] : null,
    tournamentFromPage: tourM ? decode(tourM[1]) : null,
    blue: mkSide(blueHdr, 'blue', bluePlayers, blueBans, bluePicks),
    red: mkSide(redHdr, 'red', redPlayers, redBans, redPicks),
    warnings: err,
  };
}

module.exports = { parseGame, ROLES };

if (require.main === module) {
  const fs = require('fs');
  const file = process.argv[2];
  const r = parseGame(fs.readFileSync(file, 'utf8'), process.argv[3] || '?');
  console.log(JSON.stringify(r, null, 2));
}
