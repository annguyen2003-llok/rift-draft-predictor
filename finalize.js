'use strict';
/* Fits the models that actually measured better than baseline, and emits
   dataset.json for the site.

   Selection was made by leak-free 5-fold CV over candidate feature sets
   (see diagnose.js). What survived:
     win probability : [teamStrength?, teamRating?, frontline, ranged, mobility]  lambda=60
     total kills     : [pace, lengthLean]                                        lambda=100
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

   2026-09-17 — BỎ sumWr (win rate tướng) KHỎI MÔ HÌNH theo yêu cầu tường minh của
   người dùng, sau khi đã báo trước đầy đủ đánh đổi đo được: giữ sumWr tốt hơn bỏ ở
   mọi mức tướng mới thực tế trong walk-forward (0%: 0.6103 vs 0.5984; 10%: 0.6047
   vs 0.5984; 20%: 0.6022 vs 0.5984), chỉ thua kit thuần ở mức cực đoan 40% tướng lạ
   (0.5934 vs 0.5984 — hiếm khi xảy ra thực tế). Người dùng chọn ưu tiên đánh giá
   theo KIT/CẤU TRÚC ĐỘI HÌNH hơn theo lịch sử thắng-thua của từng tướng, chấp nhận
   đổi lấy độ chính xác thấp hơn ở mức đo được. Xem meta.newChampAudit trong
   dataset.json để đối chiếu — số liệu cũ VẪN giữ nguyên ở đó, không xoá, để không
   ai (kể cả tôi ở tương lai) tưởng nhầm đây là phát hiện mới thay vì lựa chọn có
   chủ đích. wrShrunk của tướng vẫn hiển thị trong UI (giống matchupEdge) — chỉ
   không còn nạp vào mô hình dự đoán.

   2026-09-18 — BỎ TIẾP teamStrength/teamRating KHỎI MÔ HÌNH, cũng theo yêu cầu
   tường minh của người dùng (chuyển hẳn sang đánh giá qua draft, đội chỉ dùng để
   tra dữ liệu tướng/tuyển thủ) — sau khi đã đưa ra bằng chứng phản bác rõ ràng:
     - Walk-forward 5 trận IG vs TES thật (05/09): +đội đúng 3/5, draft-only chỉ
       đúng 1/5 — NGƯỢC với quan sát của người dùng hôm trước (có thể do họ test
       trên 1 đội hình GIẢ ĐỊNH không có kết quả thật để đối chiếu).
     - Draft-only (kit3, không đội, không sumWr) đo AUC 0.468 — dưới ngẫu nhiên.
     - Thí nghiệm tự nhiên (so sánh các ván TRONG CÙNG 1 series, loại sạch yếu tố
       đội): 6 trục kit chỉ giải thích 1.4% biến thiên thắng-thua.
   Người dùng vẫn chọn giữ nguyên hướng draft sau khi nghe đầy đủ, nên tôi tìm
   tín hiệu draft TỐT NHẤT đo được để thay vào chỗ sức mạnh đội:
     - familiarity (độ quen tay: player đã cầm chính con tướng này bao nhiêu lần)
       — mạnh nhất, walk-forward AUC 0.468 -> 0.553 khi thêm vào kit3.
     - poolDepth (số tướng khác nhau player từng cầm — pool rộng thì ít bị dồn
       vào tướng lạ ở ván sau của fearless draft) — +0.004 AUC.
     - pickPriority (thứ tự được pick trong toàn cục draft, quy đổi từ
       picksDraftOrder — được pick sớm = giới chuyên môn đánh giá cao, HOÀN TOÀN
       không dùng kết quả thắng/thua) — +0.005 AUC.
   Tổng: kit3 + familiarity + poolDepth + pickPriority. Đo TRONG chính pipeline
   sản xuất (walk-forward thật, không phải script test riêng — xem cv.draft/
   cv.withTeam bên dưới): withTeam AUC≈0.548-0.551, acc 60.8%, logloss 0.6595
   (lambda=300). Vẫn thấp hơn nhiều so với +đội đã bỏ (AUC ~0.60+) — đã báo
   trước, người dùng chấp nhận. familiarity/poolDepth cần biết ĐÚNG tuyển thủ
   đang cầm, nên vẫn cần chọn 2 đội thật trong UI để tra ra roster hiện tại —
   team KHÔNG còn là trục tính điểm, chỉ còn là chìa khoá tra dữ liệu.

   CẢNH BÁO RÒ RỈ ĐÃ GẶP VÀ SỬA (LẦN 1): đo lần đầu bằng kfold ngẫu nhiên (cách
   đo cũ dùng cho mọi mô hình trước đây) cho AUC ẢO 0.705, vì familiarity/
   pickPriority là BỘ ĐẾM TĂNG DẦN theo thời gian — fold "train" ngẫu nhiên
   chứa cả trận tương lai, khiến trận đầu mùa "biết" độ quen tay mà lúc đó chưa
   hề có. Walk-forward thật (chỉ dùng trận trước đó) đưa AUC về 0.548.

   CẢNH BÁO RÒ RỈ ĐÃ GẶP VÀ SỬA (LẦN 2, 2026-09-18(2)): bản walk-forward "sửa
   xong" ở trên VẪN còn 1 lỗi tinh vi hơn — mỗi bước i gọi buildStats(prior) MỘT
   LẦN rồi dùng CHUNG snapshot đó cho MỌI dòng huấn luyện j<i. Dòng huấn luyện
   của 1 trận từ rất lâu (VD trận thứ 5) vẫn được gán độ quen tay tính đến tận
   thời điểm i-1 — "biết" cả kinh nghiệm player tích luỹ SAU trận đó, dù không
   rò rỉ kết quả trận i (mọi thứ vẫn ≤ i-1) nhưng làm sai lệch quan hệ đặc
   trưng-kết quả của chính dòng đó. Viết lại bằng POINT-IN-TIME arrays (PIT,
   KIT_STATIC ở dưới) — mỗi dòng chỉ mang đúng lịch sử riêng của nó tại đúng
   thời điểm nó xảy ra. Đo lại với cách ĐÚNG, chưa kèm 2 tương tác mới: AUC
   0.528 — thấp hơn 0.548 "cũ" (kiểu sai LẦN 2), chênh 0.02 chính là phần đã
   bị đo lạc quan. Bù lại bằng 2 tương tác nhân đôi MỚI TÌM ĐƯỢC (frontline×poolDepth +0.0199 AUC KTC 95%
   [0.0045,0.0348]; familiarity×poolDepth +0.0110 KTC [0.0026,0.0194] — cả
   hai kiểm chứng bằng bootstrap 3000 lần TRÊN CHÍNH phương pháp point-in-time
   đúng, không phải phương pháp cũ) nên AUC cuối cùng quay lại ≈0.548 — CÙNG
   SỐ nhưng giờ là số thật, không phải số bị đo lạc quan + chưa có 2 tín hiệu
   mới. draft-only (không có poolDepth nên không dùng được 2 tương tác) giảm
   đúng như dự đoán: 0.493 → 0.476.

   Từ giờ draft/withTeam PHẢI đo bằng walk-forward POINT-IN-TIME (mảng PIT/
   KIT_STATIC), không dùng kfold ngẫu nhiên (rò rỉ lần 1) và không dùng
   buildStats(prior) chung cho mọi dòng trong 1 bước walk-forward (rò rỉ lần 2). */

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
/* LỖI PHÁT HIỆN 2026-09-21: games.json KHÔNG được sắp xếp theo ngày — file này
   ghép từ nhiều lượt quét theo giải/theo batch (mỗi giải/loại giải append vào
   cuối lúc quét), nên các khối INT/LCP/LCS nằm SAU khối LPL/LCK/LEC trong file
   dù ngày của chúng SỚM HƠN nhiều (VD: khối INT ở index ~502-656 có ngày từ
   2026-03-16, đứng sau khối LPL/LCK/LEC đã tới 2026-09-13). Một comment cũ ở
   walkForwardEval nói "games đã sort theo ngày ở trên" — SAI, dòng sort đó chỉ
   nằm trong nhánh GAME_CAP hiếm khi kích hoạt (games.length > 2000). Hậu quả:
   PIT/walkForwardEval đi tuần tự theo INDEX, nên với 3 khối bị chèn sai vị trí,
   "lịch sử trước đó" (index nhỏ hơn) thực ra chứa cả trận diễn ra SAU trận đang
   xét theo ngày thật — rò rỉ thời gian vào chính cơ chế được xây để chống rò rỉ.
   Sort tường minh tại đây để cả PIT/KIT_STATIC và walk-forward CV phía dưới đi
   đúng thứ tự thời gian thật; không ảnh hưởng model production cuối (rowFor
   dùng buildStats trên toàn bộ index, không phụ thuộc thứ tự) — chỉ ảnh hưởng
   độ chính xác của số đo CV và các đặc trưng tích luỹ theo thời gian
   (familiarity/poolDepth/pickPriority). */
games.sort((a, b) => a.date.localeCompare(b.date) || (a.seriesId - b.seriesId) || (a.gameId - b.gameId));
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
/* 2026-09-15 — trần nâng 600 -> 900 VÀ trận quốc tế được MIỄN.
   Lý do: trần cũ xoá các trận CŨ NHẤT, mà giải quốc tế (MSI tháng 6-7, First Stand
   tháng 3) chính là những trận cũ nhất — tức là nó sẽ xoá đúng thứ quý nhất, thứ
   DUY NHẤT nối được các khu vực với nhau. Mất chúng thì rating toàn cầu sập về lại
   trạng thái "mỗi giải một thước đo riêng", và điều đó xảy ra âm thầm không báo gì.

   2026-09-21 — trần nâng tiếp 900 -> 2000. Lý do: thử thêm 6 khu vực chuẩn bị
   CKTG (LCS/CBLOL/PCS/TCL/LJL/VCS) khiến tổng vượt 900 NGAY LẦN QUÉT ĐẦU, cắt
   oan 170 trận trong đó có tới 21/37 trận LJL và 55+25+19 trận của chính
   LPL/LCK/LEC — 3 giải THEO DÕI CHÍNH. Sau đó người dùng quyết định rút pool
   giải lại còn LCK/LPL/LEC/LCP/LCS (bỏ CBLOL/LJL/TCL/PCS/VCS vì quá yếu), nên
   quy mô thực tế nhỏ hơn 2000 nhiều — nhưng vẫn giữ trần này làm mức trần AN
   TOÀN nếu sau này mở lại các khu vực khác, không cần hạ xuống. */
const GAME_CAP = 2000;
const isIntl = g => (g.tier || 'major') === 'international';
let staleGames = [];
if (games.length > GAME_CAP) {
  const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date) || a.seriesId - b.seriesId);
  const intl = sorted.filter(isIntl);
  const regional = sorted.filter(g => !isIntl(g));
  const keepRegional = Math.max(0, GAME_CAP - intl.length);
  staleGames = regional.slice(0, Math.max(0, regional.length - keepRegional));
  const stale = new Set(staleGames.map(g => g.gameId));
  games = sorted.filter(g => !stale.has(g.gameId));
  console.log(`Vượt trần ${GAME_CAP} trận — loại ${staleGames.length} trận khu vực xa nhất ` +
    `(giữ nguyên toàn bộ ${intl.length} trận quốc tế vì chúng là cầu nối giữa các khu vực). ` +
    `games.json không bị đụng tới.`);
}
const N = games.length;

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); };

const PRIOR_K = 12, MATCHUP_K = 8, TEAM_K = 6;
/* Rating phân cấp (Bradley-Terry): LAM_TEAM co rút từng đội, LAM_REGION co rút hiệu
   ứng khu vực. Chọn bằng quét lưới trên mô phỏng CKTG (xem chú thích RATING bên dưới). */
const LAM_TEAM = 8, LAM_REGION = 8;
/* LAMBDA_WIN = 300 (2026-09-18, đo bằng walk-forward THẬT trong chính pipeline
   sản xuất — xem cv.draft/withTeam bên dưới): bộ đặc trưng thuần-draft mới
   [frontline, ranged, mobility, pickPriority, familiarity, poolDepth]. Quét
   lambda=60/150/300 cho withTeam: acc 57.2%/60.5%/60.8%, logloss 0.678/0.663/
   0.660 — AUC gần như không đổi (0.55) nhưng 300 cho hiệu chỉnh + độ chính xác
   tốt nhất. draft-only: AUC 0.51/0.50/0.49, acc ~61% cả 3 mức. */
const LAMBDA_WIN = 300, LAMBDA_KILL = 100;
const SHORT = 28, LONG = 34;

/* ============================ RATING PHÂN CẤP (cho CKTG) =====================
   VẤN ĐỀ: tỉ lệ thắng của đội KHÔNG so sánh được giữa các khu vực. Mỗi giải có
   tổng thắng = tổng thua nên trung bình luôn đúng 50% — "Gen.G 70% (LCK)" và
   "Karmine Corp 79% (LEC)" là hai con số đo bằng hai thước hoàn toàn khác nhau.
   Về mặt toán học, đồ thị đối đầu rời thành các cụm không nối nhau thì sức mạnh
   giữa các cụm là KHÔNG XÁC ĐỊNH ĐƯỢC.

   CÁCH GIẢI: nạp các giải quốc tế (MSI, EWC, First Stand — xem TOURNAMENTS trong
   scrape.js) để nối các khu vực, rồi ước lượng đồng thời:
       P(xanh thắng) = sigmoid( side + [reg_A + dev_A] - [reg_B + dev_B] )
   reg = hiệu ứng chung của cả khu vực, dev = độ lệch riêng của đội trong khu vực.
   Tách 2 tầng là điều cốt yếu: nó cho phép CẢ MỘT khu vực mạnh lên tập thể, nên
   một đội LCK chưa từng ra quốc tế vẫn thừa hưởng mức của LCK thay vì bị coi
   ngang đội cùng tỉ lệ thắng ở khu vực yếu hơn.

   ĐO ĐẠC (mô phỏng CKTG: giấu sạch thành tích quốc tế của cả 2 đội rồi bắt dự
   đoán chính trận đó — đúng cảnh đội lần đầu dự CKTG, 155 trận):
       tỉ lệ thắng thô : AUC 0.522  (≈ tung đồng xu, VÔ DỤNG)
       rating phẳng    : AUC 0.606
       rating phân cấp : AUC 0.670   <- chênh lệch THẬT, bootstrap KTC [0.013, 0.275]
   Trong mô hình đầy đủ, dùng CẢ tỉ lệ thắng LẪN rating đo tốt nhất (xem
   meta.crossRegionAudit). */
function homeRegions(indices) {
  const count = {};
  for (const i of indices) {
    const g = games[i];
    if ((g.tier || 'major') === 'international') continue;   // giải quốc tế không định nghĩa khu vực nhà
    for (const sk of ['blue', 'red']) {
      const t = g[sk].team;
      (count[t] = count[t] || {})[g.league] = ((count[t] || {})[g.league] || 0) + 1;
    }
  }
  const home = {};
  for (const [t, c] of Object.entries(count)) home[t] = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  return home;
}
function fitRating(indices, home, { iters = 4000, lr = 0.5 } = {}) {
  const regionOf = t => home[t] || 'OTHER';
  const teams = [...new Set(indices.flatMap(i => [games[i].blue.team, games[i].red.team]))];
  const ti = Object.fromEntries(teams.map((t, k) => [t, k]));
  const regions = [...new Set(teams.map(regionOf))];
  const ri = Object.fromEntries(regions.map((r, k) => [r, k]));
  const dev = new Float64Array(teams.length), reg = new Float64Array(regions.length);
  let side = 0;
  const rows = indices.map(i => ({
    b: ti[games[i].blue.team], r: ti[games[i].red.team],
    rb: ri[regionOf(games[i].blue.team)], rr: ri[regionOf(games[i].red.team)],
    y: games[i].blue.win ? 1 : 0,
  }));
  const n = rows.length || 1;
  for (let it = 0; it < iters; it++) {
    const gd = new Float64Array(teams.length), gr = new Float64Array(regions.length);
    let gs = 0;
    for (const o of rows) {
      const e = 1 / (1 + Math.exp(-(side + dev[o.b] - dev[o.r] + reg[o.rb] - reg[o.rr]))) - o.y;
      gd[o.b] += e; gd[o.r] -= e; gr[o.rb] += e; gr[o.rr] -= e; gs += e;
    }
    for (let k = 0; k < teams.length; k++) dev[k] -= lr * (gd[k] / n + (LAM_TEAM / n) * dev[k]);
    for (let k = 0; k < regions.length; k++) reg[k] -= lr * (gr[k] / n + (LAM_REGION / n) * reg[k]);
    side -= lr * (gs / n);
  }
  const regionEffect = Object.fromEntries(regions.map(r => [r, reg[ri[r]]]));
  const teamDev = Object.fromEntries(teams.map(t => [t, dev[ti[t]]]));
  /* Đội hoàn toàn lạ (chưa có trong dữ liệu) -> dev 0 + hiệu ứng khu vực nếu biết
     khu vực, ngược lại rơi về 'OTHER'. Không bao giờ ném lỗi, luôn trả về số. */
  const get = name => (teamDev[name] || 0) + (regionEffect[regionOf(name)] || regionEffect.OTHER || 0);
  return { get, regionEffect, teamDev, side, regionOf };
}

/* ===================== TÁCH HAI BỂ DỮ LIỆU (quan trọng) =====================
   Trận quốc tế phục vụ 2 mục đích khác hẳn nhau, và trộn chung thì hỏng:

   1. NỐI CÁC KHU VỰC để tính rating  -> BẮT BUỘC phải có, kể cả trận cũ.
      Rosters có đổi nhưng đây là ràng buộc DUY NHẤT giữa các khu vực.
   2. THỐNG KÊ TƯỚNG (win rate, đối đầu) -> trận cũ khác patch GÂY HẠI.
      First Stand đá patch 16.5 (tháng 3), MSI patch 16.13 — meta khác hẳn
      giải hè. Đo thực nghiệm trên cùng 357 trận khu vực, mô hình draft-only:
        chỉ giải khu vực           AUC 0.5438  Brier 0.2473   <- TỐT NHẤT
        + quốc tế từ 15/07         AUC 0.5389  Brier 0.2495
        + quốc tế từ 01/06         AUC 0.5147  Brier 0.2539
        + tất cả (cả First Stand)  AUC 0.5189  Brier 0.2532
   Nên: rating ăn MỌI trận, thống kê tướng chỉ ăn giải khu vực. */
const isInternational = g => (g.tier || 'major') === 'international';

// ------------------------------------------------------------ stats builder
// Vị trí toàn cục trong 1 draft chuẩn LMHT: B1,R1,R2,B2,B3,R3 | R4,B4,B5,R5.
// Dùng để tính "được pick sớm hay muộn" — không liên quan thắng/thua.
const BLUE_POS = [1, 4, 5, 8, 9], RED_POS = [2, 3, 6, 7, 10];
const PRIO_K = 8;

function buildStats(indices) {
  const champ = {}, matchups = {}, team = {};
  const playerChamp = {}, playerPool = {}, pickPrio = {}, roster = {};
  const C = n => champ[n] || (champ[n] = {
    name: n, roles: {}, bans: 0, picks: 0, wins: 0, gameKills: [], gameDurs: [],
    k: 0, d: 0, a: 0, shortG: 0, shortW: 0, longG: 0, longW: 0,
  });
  for (const i of indices) {
    const g = games[i];
    // Thống kê TƯỚNG chỉ ăn giải khu vực (xem chú thích TÁCH HAI BỂ ở trên).
    // Thống kê ĐỘI vẫn ăn mọi trận vì thành tích quốc tế là thành tích thật.
    const forChampStats = !isInternational(g);
    const tk = g.blue.kills + g.red.kills;
    for (const sk of ['blue', 'red']) {
      const s = g[sk];
      const t = team[s.team] || (team[s.team] = { name: s.team, league: g.league, games: 0, wins: 0 });
      t.games++; if (s.win) t.wins++;
      // Độ quen tay/độ sâu pool/roster hiện tại: ăn MỌI trận (kể cả quốc tế) —
      // đây là thứ player thực sự tích lũy được, không phải thống kê win-rate
      // theo giải nên không bị vấn đề "trộn patch" như champ WR.
      const order = s.picksDraftOrder || [], POS = sk === 'blue' ? BLUE_POS : RED_POS;
      order.forEach((cn, k) => {
        if (k >= 5) return;
        const e = pickPrio[cn] || (pickPrio[cn] = { n: 0, sum: 0 });
        e.n++; e.sum += POS[k];
      });
      for (const role of ROLES) {
        const p = s.comp[role]; if (!p) continue;
        if (p.playerId) {
          const fk = p.playerId + '|' + p.champion;
          playerChamp[fk] = (playerChamp[fk] || 0) + 1;
          (playerPool[p.playerId] = playerPool[p.playerId] || new Set()).add(p.champion);
          // roster: player GẦN NHẤT ở mỗi cặp đội|đường (ghi đè theo thứ tự
          // indices đã sort theo ngày ở scrape.js, nên bản ghi sau = mới hơn)
          roster[s.team + '|' + role] = { playerId: p.playerId, player: p.player };
        }
      }
      if (!forChampStats) continue;
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
    if (!forChampStats) continue;          // đối đầu từng đường cũng chỉ lấy giải khu vực
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
  // n/avgKills/avgDur dùng làm mốc dự phòng cho chỉ số cấp tướng nên tính trên
  // cùng bể với thống kê tướng (giải khu vực), không trộn giải quốc tế vào.
  const statIdx = indices.filter(i => !isInternational(games[i]));
  const base = statIdx.length ? statIdx : indices;
  const n = base.length;
  const avgKills = mean(base.map(i => games[i].blue.kills + games[i].red.kills));
  const avgDur = mean(base.map(i => games[i].durationMin));
  // Rating phải tính TRONG ĐÂY để mỗi fold CV tự ước lượng lại từ fold huấn luyện
  // của nó — tính một lần bên ngoài rồi dùng chung là rò rỉ dữ liệu.
  const home = homeRegions(indices);
  const rating = fitRating(indices, home);
  return { champ, matchups, team, n, avgKills, avgDur, rating, home, playerChamp, playerPool, pickPrio, roster };
}
// pickPrio: vị trí trung bình trong draft, co rút về 5.5 (giữa) khi mẫu nhỏ.
// Trả về "độ ưu tiên": cao = được pick sớm = giới chuyên môn coi trọng.
const pickPriorityOf = (st, name) => {
  const e = st.pickPrio[name];
  const avg = e ? (e.sum + PRIO_K * 5.5) / (e.n + PRIO_K) : 5.5;
  return 5.5 - avg;
};
const familiarityOf = (st, playerId, champion) => playerId ? Math.log1p(st.playerChamp[playerId + '|' + champion] || 0) : 0;
const poolDepthOf = (st, playerId) => playerId && st.playerPool[playerId] ? st.playerPool[playerId].size : 0;

const ATTR_DEFAULT = { engage: 0, frontline: 0, cc: 0, dmg: 'AD', scaling: 0, mobility: 0, ranged: 0 };
// role tuỳ chọn: một số tướng chơi khác hẳn build tuỳ đường (VD: Varus top AP đấu sĩ
// vs Varus ADC sát lực) — tra "Tên|đường" trước, không có thì rơi về khoá tên chung
const attrOf = (n, role) => (role && ATTRS[n + '|' + role]) || ATTRS[n] || ATTR_DEFAULT;

/* per-side aggregate of a composition, given a stats snapshot.
   comp[role] mang cả playerId (không chỉ tên tướng) để tính độ quen tay/pool —
   xem compOf() bên dưới. */
function sideFeatures(comp, teamName, st) {
  let sumWr = 0, sumPres = 0, engage = 0, frontline = 0, cc = 0, scaling = 0, mobility = 0, ranged = 0, ad = 0, ap = 0;
  let paceSum = 0, durSum = 0, nPace = 0, familiarity = 0, poolDepth = 0, pickPriority = 0;
  for (const role of ROLES) {
    const pick = comp[role]; if (!pick || !pick.champion) continue;
    const name = pick.champion;
    const c = st.champ[name];
    const r = c && c.roles[role];
    sumWr += r ? (r.wins + PRIOR_K * 0.5) / (r.games + PRIOR_K) : 0.5;
    sumPres += c ? (c.picks + c.bans) / st.n : 0;
    const at = attrOf(name, role);
    engage += at.engage; frontline += at.frontline; cc += at.cc;
    scaling += at.scaling; mobility += at.mobility; ranged += at.ranged;
    if (at.dmg === 'AP') ap += 1; else if (at.dmg === 'Mixed') { ad += 0.5; ap += 0.5; } else ad += 1;
    if (c && c.gameKills.length) { paceSum += mean(c.gameKills); durSum += mean(c.gameDurs); nPace++; }
    familiarity += familiarityOf(st, pick.playerId, name);
    poolDepth += poolDepthOf(st, pick.playerId);
    pickPriority += pickPriorityOf(st, name);
  }
  const tw = teamName && st.team[teamName];
  return {
    sumWr, sumPres, engage, frontline, cc, scaling, mobility, ranged, ad, ap,
    familiarity, poolDepth, pickPriority,
    mixedness: 1 - Math.abs(ad - ap) / (ad + ap || 1),
    pace: nPace ? paceSum / nPace : st.avgKills,
    lengthLean: nPace ? durSum / nPace : st.avgDur,
    teamWr: tw ? (tw.wins + TEAM_K * 0.5) / (tw.games + TEAM_K) : 0.5,
    teamRating: teamName ? st.rating.get(teamName) : 0,
  };
}

// Giữ nguyên playerId (không rút gọn về tên tướng) — cần cho familiarity/poolDepth.
const compOf = side => Object.fromEntries(ROLES.map(r => [r, side.comp[r] &&
  { champion: side.comp[r].champion, playerId: side.comp[r].playerId, player: side.comp[r].player }]));

function rowFor(g, st) {
  const B = sideFeatures(compOf(g.blue), g.blue.team, st);
  const R = sideFeatures(compOf(g.red), g.red.team, st);
  return {
    /* 2026-09-17 — BỎ sumWr khỏi mô hình theo yêu cầu tường minh của người dùng,
       dù đã đo và báo trước: giữ sumWr tốt hơn bỏ ở mọi mức tướng mới thực tế
       (0-20%), chỉ thua kit thuần ở mức cực đoan 40% tướng lạ (hiếm khi xảy ra).
       Xem chú thích đầu file + meta.newChampAudit trong dataset.json để đối
       chiếu con số cũ. wrShrunk của tướng vẫn tính và hiển thị cho người dùng
       tham khảo (giống matchupEdge) — chỉ không còn NẠP vào mô hình dự đoán. */
    /* 2026-09-18 — teamWr/teamRating bỏ khỏi CẢ HAI mô hình, theo yêu cầu tường
       minh của người dùng: chuyển hẳn sang đánh giá qua draft, đội chỉ dùng để
       tra dữ liệu tướng/tuyển thủ (roster) chứ không còn là trục tính điểm.
       'draft': chỉ cần tướng, không cần biết ai cầm — pickPriority là tín hiệu
       cấp-tướng (thứ tự pick toàn cục) nên vẫn dùng được khi chưa chọn đội.
       'withTeam' (đổi ý nghĩa: giờ là "biết cả tuyển thủ" chứ không phải "biết
       sức mạnh đội"): thêm familiarity + poolDepth, cần chọn đội để tra roster. */
    draft: [B.frontline - R.frontline, B.ranged - R.ranged, B.mobility - R.mobility,
      B.pickPriority - R.pickPriority],
    /* 2026-09-18(2) — thêm 2 tương tác nhân đôi đã kiểm chứng bằng bootstrap
       (xem chú thích LAMBDA_WIN/đầu file): frontline×poolDepth (+0.0199 AUC,
       KTC 95% [0.0045,0.0348]) và familiarity×poolDepth (+0.0110, KTC
       [0.0026,0.0194]) — cả hai THẬT, không nằm trong nhiễu. Chỉ vào withTeam
       vì cần poolDepth (cần biết tuyển thủ). */
    withTeam: [B.frontline - R.frontline, B.ranged - R.ranged, B.mobility - R.mobility,
      B.pickPriority - R.pickPriority, B.familiarity - R.familiarity, B.poolDepth - R.poolDepth,
      B.frontline * B.poolDepth - R.frontline * R.poolDepth,
      B.familiarity * B.poolDepth - R.familiarity * R.poolDepth],
    kill: [(B.pace + R.pace) / 2, (B.lengthLean + R.lengthLean) / 2],
    intl: isInternational(g),
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

/* freezeBias=true: KHÔNG cho hệ số chặn (intercept) học — giữ b=0 suốt quá
   trình huấn luyện, theo yêu cầu tường minh của người dùng (2026-09-18(3)).
   Lý do: khi đặc trưng kit yếu (gần 0 ở đa số trận vì 2 đội chuyên nghiệp draft
   khá cân), intercept tự động hấp thụ tỉ lệ thắng CƠ BẢN của tập huấn luyện —
   mà xanh thắng 59.2% trên toàn bộ 737 trận (nhất quán mọi giải: 53.8%-66.3%).
   Kết quả: mô hình "chỉ đội hình" trên thực tế SỤP THÀNH "luôn đoán xanh"
   (đo được acc=57.9%, ĐÚNG BẰNG acc của baseline "luôn đoán xanh") — không
   phải đánh giá draft, mà là khai thác việc bên nào được xếp, không liên
   quan gì đến tướng đã chọn. Đo đánh đổi (walk-forward 587 trận): bỏ
   intercept mất 8.3 điểm % chính xác trung bình (KTC 95% [2.9, 14.0]) —
   NHƯNG trên 20 trận gần nhất (xanh chỉ thắng 35%, ngược xu hướng lịch sử),
   CÓ intercept cho acc=35.0% (sụp nặng vì "ăn theo" đúng lúc xu hướng đảo),
   KHÔNG intercept cho acc=50.0% (không lệ thuộc bên nào, ổn định hơn nhiều).
   Người dùng chọn KHÔNG intercept: draft-only giờ chỉ nói lên được gì từ
   CHÍNH các tướng đã chọn, mặc định 50/50 khi kit cân bằng — không mượn lợi
   thế side để tự nâng điểm chính xác của chính nó. */
function fitLogistic(Z, y, lambda, iters = 6000, lr = 0.3, freezeBias = false) {
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
    if (!freezeBias) b -= lr * (gb / n);
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
/* 2026-09-18 — draft/withTeam giờ PHẢI đo bằng WALK-FORWARD (thời gian), không
   còn được dùng kfold ngẫu nhiên. Lý do: pickPriority/familiarity/poolDepth là
   BỘ ĐẾM TĂNG DẦN theo thời gian (số trận đã cầm, số tướng đã cầm...) — kfold
   ngẫu nhiên lấy fold "train" từ cả tương lai, khiến trận đầu mùa "học" được
   độ quen tay mà lúc đó player chưa hề có. Đo thử: kfold ngẫu nhiên báo AUC
   0.705 cho withTeam; walk-forward thật (chỉ dùng trận TRƯỚC) chỉ ra 0.564 —
   phần chênh 0.14 gần như toàn bộ là rò rỉ, giống hệt bẫy đã gặp ở alt_signals.js
   (kfold báo +0.22, walk-forward thật chỉ +0.004). games được sort theo ngày
   ngay sau khi lọc integrity (xem chú thích "LỖI PHÁT HIỆN 2026-09-21" gần đầu
   file — dòng sort đó ban đầu KHÔNG tồn tại dù comment ở đây từng khẳng định có,
   nên chỉ cần đi tuần tự theo index.

   2026-09-18(2) — SỬA TIẾP một lỗi tinh vi hơn trong chính walk-forward vừa
   sửa: bản đầu tiên gọi buildStats(prior) MỘT LẦN cho mỗi bước i, rồi dùng
   CHUNG snapshot đó cho MỌI dòng huấn luyện j<i. Nghĩa là dòng huấn luyện của
   1 trận xảy ra từ rất lâu (VD trận thứ 5) vẫn được gán độ quen tay tính đến
   tận thời điểm i-1 — tức "biết" cả kinh nghiệm player tích luỹ SAU trận đó.
   Không rò rỉ kết quả trận i (mọi thứ vẫn ≤ i-1), nhưng làm sai lệch mối quan
   hệ giữa đặc trưng và kết quả của CHÍNH DÒNG huấn luyện đó — kiểm chứng bằng
   1 bản viết lại dùng đúng lịch sử riêng của mỗi dòng (mỗi trận j lấy độ quen
   tay/pool/ưu tiên tính đến ngay TRƯỚC trận j, không phải trước trận i): AUC
   giảm từ 0.566 xuống 0.528 — chênh 0.038, cho thấy cách cũ đã ước lượng hơi
   lạc quan. Từ giờ dùng POINT-IN-TIME arrays tính 1 lần theo đúng thứ tự thời
   gian, mỗi dòng chỉ mang lịch sử của riêng nó. */
const pitPlayerChamp = {}, pitPlayerPool = {}, pitPickPrio = {};
const PIT = games.map(g => {
  const side = sk => {
    const s = g[sk];
    let fam = 0, pool = 0, prio = 0;
    for (const role of ROLES) {
      const p = s.comp[role]; if (!p) continue;
      if (p.playerId) {
        fam += Math.log1p(pitPlayerChamp[p.playerId + '|' + p.champion] || 0);
        pool += pitPlayerPool[p.playerId] ? pitPlayerPool[p.playerId].size : 0;
      }
      const e = pitPickPrio[p.champion];
      prio += 5.5 - (e ? (e.sum + PRIO_K * 5.5) / (e.n + PRIO_K) : 5.5);
    }
    return { fam, pool, prio };
  };
  const B = side('blue'), R = side('red');
  // cập nhật bảng thống kê SAU KHI đã đọc (để trận sau mới thấy trận này)
  for (const sk of ['blue', 'red']) {
    const s = g[sk];
    const order = s.picksDraftOrder || [], POS = sk === 'blue' ? BLUE_POS : RED_POS;
    order.forEach((cn, k) => { if (k < 5) { const e = pitPickPrio[cn] || (pitPickPrio[cn] = { n: 0, sum: 0 }); e.n++; e.sum += POS[k]; } });
    for (const role of ROLES) {
      const p = s.comp[role]; if (!p || !p.playerId) continue;
      const fk = p.playerId + '|' + p.champion;
      pitPlayerChamp[fk] = (pitPlayerChamp[fk] || 0) + 1;
      (pitPlayerPool[p.playerId] = pitPlayerPool[p.playerId] || new Set()).add(p.champion);
    }
  }
  return { B, R };
});
// frontline/ranged/mobility không đổi theo thời gian — tính 1 lần luôn cho nhanh.
const KIT_STATIC = games.map(g => {
  const side = sk => ROLES.reduce((s, r) => {
    const p = g[sk].comp[r]; if (!p) return s;
    const a = attrOf(p.champion, r);
    return { frontline: s.frontline + a.frontline, ranged: s.ranged + a.ranged, mobility: s.mobility + a.mobility };
  }, { frontline: 0, ranged: 0, mobility: 0 });
  return { B: side('blue'), R: side('red') };
});
function draftFeatRow(i) {
  const k = KIT_STATIC[i], p = PIT[i];
  return [k.B.frontline - k.R.frontline, k.B.ranged - k.R.ranged, k.B.mobility - k.R.mobility, p.B.prio - p.R.prio];
}
function withTeamFeatRow(i) {
  const k = KIT_STATIC[i], p = PIT[i];
  return [k.B.frontline - k.R.frontline, k.B.ranged - k.R.ranged, k.B.mobility - k.R.mobility,
    p.B.prio - p.R.prio, p.B.fam - p.R.fam, p.B.pool - p.R.pool,
    k.B.frontline * p.B.pool - k.R.frontline * p.R.pool, p.B.fam * p.B.pool - p.R.fam * p.R.pool];
}
const WF_MIN_HISTORY = 150, WF_ITERS = 1500;
function walkForwardEval(rowKey, fitFn, predFn) {
  const buildRow = rowKey === 'draft' ? draftFeatRow : withTeamFeatRow;
  const out = [];
  for (let i = WF_MIN_HISTORY; i < N; i++) {
    const prior = [...Array(i).keys()];
    const s = standardise(prior.map(buildRow));
    // freezeBias=true: xem chú thích tại fitLogistic() — draft/withTeam không
    // được phép mượn lợi thế side xanh để tự nâng độ chính xác.
    const m = fitFn(s.Z, prior.map(j => games[j].blue.win ? 1 : 0), LAMBDA_WIN, WF_ITERS, 0.3, true);
    out.push({ p: predFn(m, applyStd(buildRow(i), s.mu, s.sg)), y: games[i].blue.win ? 1 : 0, intl: isInternational(games[i]) });
  }
  return out;
}
const cv = {
  draft: walkForwardEval('draft', fitLogistic, predLogit),
  withTeam: walkForwardEval('withTeam', fitLogistic, predLogit),
  kill: [],
};
// kills model: pace/lengthLean cũng là trung bình cộng dồn nên về lý thuyết có
// cùng nguy cơ, nhưng đây là hồi quy tuyến tính dự đoán SỐ (không phải thắng-
// thua nhạy với thứ tự thời gian như familiarity) — giữ kfold ngẫu nhiên như cũ,
// phạm vi sửa lần này chỉ nhắm vào draft/withTeam vừa đổi đặc trưng.
/* 2026-09-21 — thử thêm TEMPO CẤP ĐỘI (trung bình tổng mạng/thời gian LỊCH SỬ
   của chính đội đó, co rút về trung bình chung với TEAM_K=6, giống cách tính
   teamWr) vào feature của kill model, sau khi người dùng hỏi "bật đội có giúp
   đoán kill/thời gian chính xác hơn?" — câu trả lời trước đó là KHÔNG, vì model
   kill chưa từng dùng dữ liệu đội ở bất kỳ đâu. Đo bằng walk-forward toàn bộ
   678 trận (từ index 150) + bootstrap 3000 lần: thêm tempo đội vào [pace,
   lengthLean] cho MAE 6.791→6.755, R² 0.0032→0.0225 — NHƯNG bootstrap MAE delta
   KTC 95% [-0.227, 0.146] vẫn chứa 0, không đủ chắc để coi là thật. Thử luôn
   tempo đội THAY HẲN cho pace/lengthLean cấp-tướng: tệ hơn baseline (MAE 6.915,
   R² -0.0096). Kết luận: tempo cấp đội KHÔNG cải thiện được kill model một
   cách đáng tin — giữ nguyên [pace, lengthLean] cấp-tướng, KHÔNG nối "bật đội"
   với kill/thời gian. Vì kết quả không đạt ngưỡng, tiêu chí draft-only cho
   thắng/thua (draft/withTeam ở trên) cũng KHÔNG thay đổi theo yêu cầu có điều
   kiện của người dùng — familiarity/poolDepth vẫn giữ vai trò cũ trong
   withTeam. */
for (const { train, test } of kfold(N, 5)) {
  const st = buildStats(train);
  const tr = train.map(i => rowFor(games[i], st));
  const te = test.map(i => rowFor(games[i], st));
  const sK = standardise(tr.map(r => r.kill));
  const mK = fitLinear(sK.Z, tr.map(r => r.totalKills), LAMBDA_KILL);
  te.forEach(r => cv.kill.push({ pred: predLin(mK, applyStd(r.kill, sK.mu, sK.sg)), act: r.totalKills }));
}

// ------------------------------------------------------------ production fit
const stats = buildStats([...Array(N).keys()]);
const rows = games.map(g => rowFor(g, stats));
const yAll = rows.map(r => r.y);
// freezeBias=true ở cả 2 model thật (không chỉ lúc đo) — xem chú thích fitLogistic().
const sDraft = standardise(rows.map(r => r.draft));
const draftModel = fitLogistic(sDraft.Z, yAll, LAMBDA_WIN, 6000, 0.3, true);
const sTeam = standardise(rows.map(r => r.withTeam));
const teamModel = fitLogistic(sTeam.Z, yAll, LAMBDA_WIN, 6000, 0.3, true);
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

/* Tách chỉ số theo LOẠI trận: trộn chung thì khó đọc, vì trận quốc tế giữa các đội
   hàng đầu thế giới khó đoán hơn hẳn trận vòng bảng khu vực. Người dùng hàng ngày
   xem trận khu vực; đến CKTG mới xem cột quốc tế. */
const splitMetrics = arr => {
  const reg = arr.filter(r => !r.intl), intl = arr.filter(r => r.intl);
  return {
    ...clsMetrics(arr), calibration: calib(arr),
    regional: reg.length >= 30 ? { n: reg.length, ...clsMetrics(reg) } : null,
    international: intl.length >= 30 ? { n: intl.length, ...clsMetrics(intl) } : null,
  };
};
const draftMetrics = splitMetrics(cv.draft);
const teamMetrics = splitMetrics(cv.withTeam);
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
/* Danh sách đội CHỐT dự CKTG theo giải — CHỈ để lọc dropdown chọn đội cho gọn,
   KHÔNG đụng đến dữ liệu huấn luyện: đội không dự CKTG vẫn đóng góp thật vào
   win-rate tướng và hiệu ứng khu vực (loại chúng ra sẽ làm mẫu số nhỏ đi, giảm
   độ chính xác chứ không tăng). Giải chưa có danh sách -> không lọc gì cả. */
const worldsTeamsPath = path.join(DATA_DIR, 'worlds_teams.json');
const worldsTeamsRaw = fs.existsSync(worldsTeamsPath) ? JSON.parse(fs.readFileSync(worldsTeamsPath, 'utf8')) : {};
const worldsQualified = {};
for (const [league, list] of Object.entries(worldsTeamsRaw)) {
  if (league.startsWith('_') || !Array.isArray(list) || !list.length) continue;
  for (const name of list) worldsQualified[name] = true;
}

const teams = {};
for (const t of Object.values(stats.team)) {
  const home = stats.home[t.name] || null;          // khu vực nhà (giải quốc tế không tính)
  teams[t.name] = { name: t.name, league: t.league, homeRegion: home,
    games: t.games, wins: t.wins, wr: t.wins / t.games,
    wrShrunk: (t.wins + TEAM_K * 0.5) / (t.games + TEAM_K),
    /* rating: thang đo TOÀN CẦU, so sánh được giữa các khu vực (khác hẳn wr).
       ratingDev = lệch riêng của đội so với mặt bằng khu vực mình. */
    rating: stats.rating.get(t.name),
    ratingDev: stats.rating.teamDev[t.name] || 0,
    intlGames: games.filter(g => (g.tier || 'major') === 'international' &&
      (g.blue.team === t.name || g.red.team === t.name)).length,
    worldsQualified: !!worldsQualified[t.name],
  };
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
      { feature: 'sumWr', auc: 0.610, used: false, note: 'LOẠI 2026-09-17 theo yêu cầu người dùng: tỉ lệ thắng tướng đo được là có ích thật (tốt hơn bỏ ở mọi mức tướng mới 0-20%), nhưng người dùng chọn ưu tiên đánh giá theo kit/cấu trúc đội hình hơn lịch sử thắng-thua từng tướng — chấp nhận đổi lấy độ chính xác thấp hơn ở mức đo được (xem newChampAudit). Vẫn hiển thị wrShrunk trong UI để tham khảo.' },
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
      { feature: 'banPriority/firstPickEngage/scalingSpread/dmgImbalance/engage×cc/frontline×engage', auc: null, used: false, note: 'LOẠI 2026-09-21: vòng 2 dò tín hiệu thuần-kit (walk-forward+bootstrap trên baseline đã khoá bias) — tất cả trong nhiễu, riêng engage đơn lẻ THẬT nhưng có HẠI (-0.0137 AUC, KTC 95% [-0.0249,-0.0029]).' },
      { feature: 'archetype clustering (k-means kit ADC×Support, k=3 mỗi vai)', auc: null, used: false, note: "LOẠI 2026-09-21: gom tướng theo LOẠI kit (không theo tên) để có mẫu dày hơn cặp tướng cụ thể (61% cặp ADC+Support chỉ có ≤2 trận). Test 2 hướng — (A) tương tác cấu trúc bot lane theo archetype (engage×cc, ranged×mobility): trong nhiễu, cả hai lệch âm nhẹ. (B) tỉ lệ thắng theo BUCKET archetype (mẫu dày hơn cặp tướng riêng nên đỡ nhiễu hơn sumWr cũ, nhưng VỀ BẢN CHẤT vẫn là trục thắng/thua mà người dùng đã chọn bỏ — đo riêng, không ghép vào draft-only): +0.0225 AUC nhưng KTC 95% [-0.0058,0.0507] vẫn chứa 0 — chưa đủ chắc để coi là thật. Kết luận: không gian tín hiệu chỉ-từ-kit (không cần danh tính tuyển thủ) coi như đã dò cạn ở khối lượng dữ liệu hiện tại." },
    ],
    /* Kiểm định mô phỏng TƯỚNG MỚI (walk-forward 339 trận, che dữ liệu win-rate lúc
       dự đoán theo tỉ lệ tướng lạ trong trận). Con số = AUC.
                              0% mới   10%     20%     40%
       cũ (sumWr+scaling)     0.6026   0.5980  0.5934  0.5842
       chỉ sumWr              0.6104   0.6044  0.6010  0.5925
       chỉ kit (không sumWr)  0.5984   0.5984  0.5984  0.5984
       ĐANG DÙNG (kit+sumWr)  0.6103   0.6047  0.6022  0.5934   <- tốt nhất mọi mức */
    /* Hiệu ứng khu vực học được từ các trận quốc tế. Đơn vị logit: chênh 1.0 nghĩa
       là đội trung bình khu vực này thắng đội trung bình khu vực kia ~73%.
       Chỉ đáng tin khi có đủ trận liên khu vực — xem crossRegionAudit.linkCounts. */
    regionEffects: stats.rating.regionEffect,
    sideAdvantageLogit: stats.rating.side,
    worldsQualified: worldsTeamsRaw,
    crossRegionAudit: (() => {
      const home = stats.home, regionOf = t => home[t] || 'OTHER';
      const links = {};
      let cross = 0;
      for (const g of games) {
        const a = regionOf(g.blue.team), b = regionOf(g.red.team);
        if (a === b) continue;
        cross++;
        const k = [a, b].sort().join('-');
        links[k] = (links[k] || 0) + 1;
      }
      const teamsAll = [...new Set(games.flatMap(g => [g.blue.team, g.red.team]))];
      const intlTeams = new Set(games.filter(g => (g.tier || 'major') === 'international')
        .flatMap(g => [g.blue.team, g.red.team]));
      return {
        crossRegionGames: cross, linkCounts: links,
        internationalGames: games.filter(g => (g.tier || 'major') === 'international').length,
        teamsWithIntlPlay: [...intlTeams].length, teamsTotal: teamsAll.length,
        /* Mô phỏng CKTG: giấu sạch thành tích quốc tế của cả 2 đội rồi dự đoán
           chính trận đó (155 trận). AUC đo được: */
        worldsSimulation: { winRateOnly: 0.522, ratingFlat: 0.606, ratingHierarchical: 0.670,
          note: 'tỉ lệ thắng thô gần như tung đồng xu khi đội chưa từng ra quốc tế' },
      };
    })(),
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
  /* Dữ liệu cho mô hình THUẦN DRAFT (2026-09-18) — đội chỉ dùng để tra đúng
     roster hiện tại, không còn là trục tính điểm.
       pickPriority : tên tướng -> độ ưu tiên pick (cao = pro pick sớm), không
                       dùng thắng/thua, tính sẵn để client không phải tự suy ra
                       từ picksDraftOrame thô.
       roster       : "Đội|đường" -> tuyển thủ GẦN NHẤT từng thấy ở vị trí đó.
       familiarity  : "playerId|Tên tướng" -> log1p(số trận player đã cầm).
       poolDepth    : playerId -> số tướng khác nhau từng cầm. */
  pickPriority: Object.fromEntries(Object.keys(stats.pickPrio).map(n => [n, pickPriorityOf(stats, n)])),
  roster: stats.roster,
  familiarity: Object.fromEntries(Object.entries(stats.playerChamp).map(([k, v]) => [k, Math.log1p(v)])),
  poolDepth: Object.fromEntries(Object.keys(stats.playerPool).map(id => [id, stats.playerPool[id].size])),
  models: {
    draft: { features: ['frontline', 'ranged', 'mobility', 'pickPriority'], w: draftModel.w, b: draftModel.b, mu: sDraft.mu, sg: sDraft.sg, lambda: LAMBDA_WIN, metrics: draftMetrics },
    withTeam: { features: ['frontline', 'ranged', 'mobility', 'pickPriority', 'familiarity', 'poolDepth', 'frontlineXpool', 'familiarityXpool'], w: teamModel.w, b: teamModel.b, mu: sTeam.mu, sg: sTeam.sg, lambda: LAMBDA_WIN, metrics: teamMetrics },
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
