'use strict';
/* Kit-based champion classification — EXPERT JUDGMENT layer, not measured data.
   Kept separate from gol.gg-derived numbers and labelled as such in the UI.
   engage    : 1 = has a reliable tool to force a fight on demand
   frontline : 0 squishy | 1 bruiser/off-tank | 2 true frontline
   cc        : 0-3 quantity+reliability of crowd control
   dmg       : AD | AP | Mixed  (damage the enemy must itemise against)
   scaling   : -1 strongest early ... +1 hypercarry / late game
   mobility  : 0-3 dashes/blinks/speed
   ranged    : 1 = ranged basic attacks
   Names follow gol.gg spelling (apostrophes stripped).

   2026-09-07 — đối chiếu với patch note thật của 26.16 (12/08) và 26.17 (26/08),
   2 patch đang được đá tại LCK/LPL/LEC (games.json vẫn dùng toàn bộ 469 trận đa
   patch cho phần thống kê thắng/thua — điều đó KHÔNG đổi; chỉ lớp phân loại kit
   ở file này mới cần cập nhật theo patch hiện tại, vì buff/nerf thay đổi sức
   mạnh/thiên hướng thật của tướng theo thời gian):
     26.16 buff: Azir, Gwen, Kennen · nerf: Bel'Veth, Camille, Poppy, Nasus
     26.17 buff: Aurelion Sol, Cho'Gath, Irelia, LeBlanc, Qiyana, Trundle, Yasuo, Yone
     26.17 nerf: Graves, Nasus, Nocturne, Thresh, Vayne (riêng đường trên), Xerath
   Chỉ chỉnh `scaling` khi patch note nói rõ dịch chuyển SỚM/MUỘN (VD: "mất burst
   sớm đổi lấy scale tank"); buff/nerf sức mạnh chung chung không đổi trục này. */

const A = (engage, frontline, cc, dmg, scaling, mobility, ranged) =>
  ({ engage, frontline, cc, dmg, scaling, mobility, ranged });

module.exports = {
  // ---------- tanks / frontline ----------
  'Ornn':          A(1, 2, 3, 'AP',    0.4, 1, 0),
  'Sion':          A(1, 2, 3, 'Mixed', 0.7, 1, 0),
  'Galio':         A(1, 2, 3, 'AP',    0.4, 1, 0),
  'Malphite':      A(1, 2, 3, 'AP',    0.3, 1, 0),
  'Poppy':         A(1, 2, 3, 'AD',    0.25, 1, 0),  // patch 26.16: mất burst/an toàn sớm, đổi lại sustain đường + scale tank (cùng hướng đổi với Camille)
  'Shen':          A(1, 2, 1, 'AP',    0.2, 1, 0),
  'Dr. Mundo':     A(0, 2, 1, 'AP',    0.5, 1, 0),
  'Chogath':       A(0, 2, 3, 'AP',    0.6, 0, 0),
  'KSante':        A(1, 2, 3, 'Mixed', 0.2, 2, 0),
  'Sejuani':       A(1, 2, 3, 'AP',    0.3, 1, 0),
  'Skarner':       A(1, 2, 3, 'Mixed', 0.3, 2, 0),
  'Maokai':        A(1, 2, 3, 'AP',    0.3, 1, 0),
  'Nautilus':      A(1, 2, 3, 'AP',    0.2, 1, 0),
  'Leona':         A(1, 2, 3, 'AP',    0.0, 0, 0),
  'Alistar':       A(1, 2, 3, 'AP',   -0.1, 1, 0),
  'Rell':          A(1, 2, 3, 'AP',    0.0, 1, 0),
  'Braum':         A(1, 2, 3, 'AP',    0.1, 0, 0),
  'Thresh':        A(1, 1, 3, 'AP',    0.2, 1, 0),
  'Blitzcrank':    A(1, 1, 3, 'AP',   -0.1, 0, 0),

  // ---------- fighters / bruisers ----------
  'Ambessa':       A(1, 1, 2, 'AD',   -0.3, 2, 0),
  'Aatrox':        A(1, 1, 2, 'AD',    0.0, 2, 0),
  'Renekton':      A(0, 1, 1, 'AD',   -0.6, 1, 0),
  'Olaf':          A(0, 1, 1, 'AD',   -0.4, 1, 0),
  'Jax':           A(0, 1, 1, 'AD',    0.7, 2, 0),
  'Fiora':         A(0, 0, 0, 'AD',    0.5, 2, 0),   // đấu sĩ 1v1/tách lính thuần, không có công cụ mở giao tranh hay CC, ult refresh khi hạ mục tiêu -> mạnh dần về cuối trận
  'Camille':       A(1, 1, 2, 'AD',    0.2, 3, 0),   // fallback nếu xuất hiện ở đường khác top/support
  'Camille|top':   A(1, 1, 2, 'AD',    0.35, 3, 0),  // patch 26.16: mất burst/an toàn sớm, đổi lại sustain đường + scale tank — dịch nhẹ về hậu kỳ so với trước
  'Camille|support': A(0, 1, 1, 'AD',  0.0, 3, 0),    // build support: ít chủ động mở giao tranh hơn, thiên về bảo kê/peel cho carry, ít áp lực sát thương hơn bản top
  'Irelia':        A(1, 1, 2, 'AD',    0.2, 3, 0),
  'Trundle':       A(0, 1, 1, 'AD',    0.2, 1, 0),
  'Warwick':       A(1, 1, 2, 'Mixed', 0.0, 1, 0),
  'Kled':          A(1, 1, 2, 'AD',   -0.4, 2, 0),
  'Yorick':        A(0, 1, 1, 'AD',    0.3, 0, 0),
  'Nasus':         A(0, 1, 1, 'AD',    0.9, 0, 0),   // bị nerf liên tiếp 26.16+26.17 (mất sustain đi đường) — đường sớm khó hơn nhưng bản chất hyperscale hậu kỳ không đổi, giữ nguyên số
  'Mordekaiser':   A(1, 1, 1, 'AP',    0.4, 1, 0),
  'Urgot':         A(0, 1, 1, 'AD',    0.1, 0, 0),
  'Gwen':          A(0, 1, 1, 'AP',    0.6, 1, 0),
  'Zaahen':        A(1, 1, 2, 'AD',    0.1, 2, 0),   // darkin skirmisher: W pull, E dash slow, revive passive
  'Sylas':         A(1, 1, 2, 'AP',    0.1, 2, 0),
  'Yone':          A(1, 1, 2, 'Mixed', 0.5, 2, 0),   // patch 26.17: buff khuyến khích lên đồ chí mạng — củng cố thiên hướng hậu kỳ
  'Yasuo':         A(0, 1, 1, 'AD',    0.6, 2, 0),   // patch 26.17: buff khuyến khích lên đồ chí mạng — củng cố thiên hướng hậu kỳ
  'Gragas':        A(1, 1, 2, 'AP',    0.2, 1, 0),
  'Rumble':        A(0, 1, 1, 'AP',    0.0, 1, 0),
  'Gnar':          A(1, 1, 3, 'Mixed', 0.3, 2, 1),
  'Jayce':         A(0, 0, 1, 'AD',   -0.3, 2, 1),
  'Rakan':         A(1, 1, 2, 'AP',    0.0, 3, 0),

  // ---------- junglers (diver / skirmisher) ----------
  'Lee Sin':       A(1, 1, 2, 'AD',   -0.7, 3, 0),
  'Jarvan IV':     A(1, 1, 2, 'AD',   -0.2, 2, 0),
  'Vi':            A(1, 1, 2, 'AD',   -0.2, 2, 0),
  'Xin Zhao':      A(1, 1, 2, 'AD',   -0.5, 2, 0),
  'Wukong':        A(1, 1, 2, 'AD',    0.1, 2, 0),
  'Pantheon':      A(1, 1, 2, 'AD',   -0.7, 2, 0),
  'Nocturne':      A(1, 0, 2, 'AD',   -0.1, 2, 0),
  'Naafiri':       A(0, 0, 1, 'AD',   -0.2, 3, 0),
  'Qiyana':        A(1, 0, 2, 'AD',   -0.3, 3, 0),
  'Zed':           A(0, 0, 0, 'AD',   -0.1, 3, 0),
  'Graves':        A(0, 1, 1, 'AD',    0.1, 1, 1),
  'Nidalee':       A(0, 0, 0, 'AP',    0.0, 2, 1),
  'Elise':         A(0, 0, 2, 'AP',   -0.4, 2, 1),

  // ---------- assassins / mid ----------
  'Akali':         A(0, 0, 1, 'AP',    0.0, 3, 0),
  'Locke':         A(0, 0, 2, 'AP',    0.0, 3, 0),   // AP assassin: Q slows, E blink+dash, R 99% slow + execute
  'LeBlanc':       A(0, 0, 1, 'AP',   -0.1, 2, 1),   // patch 26.17: buff tốc đánh + tỉ lệ AP — bớt lệ thuộc vào combo giết sớm, dịch nhẹ về hậu kỳ
  'Ahri':          A(0, 0, 2, 'AP',    0.2, 2, 1),
  'Aurora':        A(0, 0, 2, 'AP',    0.2, 2, 1),
  'Pyke':          A(1, 0, 2, 'AD',    0.0, 2, 0),
  'Tristana':      A(1, 0, 1, 'AD',    0.3, 2, 1),
  'Vayne':         A(0, 0, 1, 'AD',    0.9, 1, 1),   // trong dữ liệu chỉ xuất hiện ở top; patch 26.17 nerf diện rộng riêng Vayne top (giảm sức mạnh chung, không đổi hướng hậu kỳ)

  // ---------- control mages ----------
  'Ryze':          A(0, 0, 1, 'AP',    0.8, 1, 1),
  'Orianna':       A(1, 0, 2, 'AP',    0.6, 0, 1),
  'Syndra':        A(0, 0, 2, 'AP',    0.6, 0, 1),
  'Viktor':        A(0, 0, 2, 'AP',    0.8, 0, 1),
  'Cassiopeia':    A(0, 0, 2, 'AP',    0.6, 0, 1),
  'Anivia':        A(1, 0, 3, 'AP',    0.8, 0, 1),
  'Annie':         A(1, 0, 3, 'AP',    0.1, 0, 1),
  'Lissandra':     A(1, 0, 3, 'AP',    0.2, 1, 1),
  'Taliyah':       A(0, 0, 2, 'AP',    0.3, 2, 1),
  'Azir':          A(1, 0, 2, 'AP',    0.6, 1, 1),
  'Hwei':          A(0, 0, 2, 'AP',    0.6, 0, 1),
  'Xerath':        A(0, 0, 2, 'AP',    0.7, 0, 1),
  'Ziggs':         A(0, 0, 1, 'AP',    0.5, 0, 1),
  'Swain':         A(0, 1, 2, 'AP',    0.4, 0, 1),
  'Aurelion Sol':  A(0, 0, 2, 'AP',    0.7, 2, 1),
  'Mel':           A(0, 0, 1, 'AP',    0.8, 0, 1),
  'Twisted Fate':  A(0, 0, 2, 'Mixed', 0.0, 1, 1),
  'Lux':           A(0, 0, 2, 'AP',    0.4, 0, 1),
  'Neeko':         A(1, 0, 2, 'AP',    0.3, 1, 1),
  'Seraphine':     A(1, 0, 2, 'AP',    0.7, 0, 1),
  'Karma':         A(0, 0, 1, 'AP',    0.2, 1, 1),
  'Lulu':          A(0, 0, 2, 'AP',    0.2, 0, 1),
  'Milio':         A(0, 0, 1, 'AP',    0.1, 0, 1),
  'Renata Glasc':  A(1, 0, 2, 'AP',    0.3, 0, 1),
  'Bard':          A(1, 0, 2, 'AP',    0.2, 2, 1),
  'Soraka':        A(0, 0, 2, 'AP',    0.3, 0, 1),
  'Yuumi':         A(0, 0, 2, 'AP',    0.3, 0, 1),
  'Nami':          A(1, 0, 2, 'AP',    0.2, 0, 1),

  // ---------- marksmen ----------
  'Samira':        A(0, 0, 0, 'AD',    0.3, 2, 0),   // xạ thủ CẬN CHIẾN, cần đồng đội khống chế trước mới combo được, dash + ult AoE xử tốp
  'Jhin':          A(0, 0, 2, 'AD',    0.5, 0, 1),
  'Corki':         A(0, 0, 0, 'Mixed', 0.4, 1, 1),
  'Ezreal':        A(0, 0, 1, 'Mixed', 0.5, 2, 1),
  'Lucian':        A(0, 0, 0, 'AD',   -0.3, 2, 1),
  'Varus':         A(1, 0, 2, 'Mixed', 0.4, 0, 1),   // fallback nếu xuất hiện ở đường khác top/adc
  'Varus|top':     A(1, 0, 2, 'AP',    0.1, 0, 1),   // build AP đấu sĩ (Liandry/Nashor on-hit), đấu tay giữa game, không cần kéo dài
  'Varus|adc':     A(1, 0, 2, 'Mixed', 0.5, 0, 1),   // build sát lực/crit chuẩn ADC, scale hậu kỳ tốt hơn
  'Kaisa':         A(0, 0, 0, 'Mixed', 0.6, 2, 1),
  'Sivir':         A(0, 0, 0, 'AD',    0.3, 1, 1),
  'Ashe':          A(1, 0, 3, 'AD',    0.5, 0, 1),
  'Xayah':         A(0, 0, 2, 'AD',    0.6, 1, 1),
  'Caitlyn':       A(0, 0, 2, 'AD',    0.4, 0, 1),
  'Yunara':        A(0, 0, 1, 'Mixed', 0.8, 1, 1),
  'Kalista':       A(1, 0, 1, 'AD',   -0.2, 3, 1),
  'Miss Fortune':  A(0, 0, 1, 'AD',    0.3, 0, 1),
  'KogMaw':        A(0, 0, 1, 'Mixed', 0.95, 0, 1),
  'Zeri':          A(0, 0, 1, 'AD',    0.7, 3, 1),
  'Draven':        A(0, 0, 1, 'AD',   -0.3, 1, 1),
  'Aphelios':      A(0, 0, 2, 'AD',    0.7, 0, 1),
  'Jinx':          A(0, 0, 1, 'AD',    0.8, 0, 1),
  'Smolder':       A(0, 0, 1, 'Mixed', 0.9, 1, 1),

  // ---------- remaining champions seen in the scanned games ----------
  /* 2026-09-15: 8 tướng dưới đây xuất hiện khi nạp thêm các giải QUỐC TẾ (MSI,
     EWC, First Stand). First Stand đá patch 16.5 nên meta khác hẳn giải hè. */
  'Gangplank':     A(0, 1, 1, 'AD',    0.8, 1, 0),   // thùng dầu là CC gián tiếp; crit scale rất mạnh cuối trận
  'Morgana':       A(0, 0, 2, 'AP',    0.2, 0, 1),   // trói + ult khoá, nhưng không tự mở giao tranh
  'Veigar':        A(0, 0, 2, 'AP',    1.0, 0, 1),   // lồng CC; cộng dồn sức mạnh vô hạn -> hypercarry
  'Garen':         A(0, 1, 1, 'AD',   -0.2, 1, 0),   // không có công cụ bắt; mạnh sớm, đuối cuối
  'Senna':         A(0, 0, 1, 'AD',    0.6, 0, 1),   // cộng dồn hồn, tầm đánh tăng dần -> mạnh dần
  'Viego':         A(0, 1, 1, 'AD',    0.5, 2, 0),   // chiếm xác giúp giao tranh kéo dài có lợi
  'RekSai':        A(1, 1, 1, 'AD',   -0.4, 2, 0),   // ult bắt tầm xa = engage; rừng mạnh sớm
  'Sett':          A(1, 2, 2, 'AD',    0.1, 1, 0),   // W/E kéo + tuyến đầu dày
  'Udyr':          A(0, 1, 2, 'Mixed', 0.2, 1, 0),
  'Belveth':       A(1, 1, 2, 'AD',    0.6, 3, 0),
  'Diana':         A(1, 1, 2, 'AP',    0.2, 2, 0),
  'Zoe':           A(0, 0, 2, 'AP',    0.3, 1, 1),
  'Volibear':      A(1, 2, 2, 'Mixed', 0.3, 1, 0),
  'Shyvana':       A(1, 1, 1, 'Mixed', 0.4, 2, 0),
  'Kennen':        A(1, 0, 3, 'AP',    0.4, 2, 1),   // patch 26.16: ult cộng thêm sát thương lẫn kháng chịu — trụ giao tranh tốt hơn, dịch nhẹ về hậu kỳ
  'KhaZix':        A(0, 0, 0, 'AD',    0.1, 3, 0),
  'Zyra':          A(1, 0, 2, 'AP',    0.4, 0, 1),
  'Tahm Kench':    A(1, 2, 2, 'AP',    0.2, 1, 0),
  'Hecarim':       A(1, 1, 2, 'AD',    0.1, 2, 0),   // ult fear + knockback = engage
  'Kindred':       A(0, 0, 1, 'AD',    0.7, 2, 1),   // scales on marks, R denies a kill but isn't engage
  'Tryndamere':    A(0, 0, 0, 'AD',    0.8, 1, 0),   // crit hypercarry duelist, undying rage, no CC on others
  'Taric':         A(1, 2, 3, 'AP',    0.2, 0, 0),   // long-range stun (Dazzle) + armor link + invuln ult
  'Vladimir':      A(0, 1, 0, 'AP',    0.6, 1, 0),   // health-stacking sustain mage, Sanguine Pool dodges but no hard CC
  'Vex':           A(1, 0, 2, 'AP',    0.4, 0, 1),   // fear (E) is real hard CC, burst mage, punishes dashes
  'VelKoz':        A(0, 0, 2, 'AP',    0.4, 0, 1),   // poke/burst mage, W knockup + E slow zone, channelled execute ult
};
