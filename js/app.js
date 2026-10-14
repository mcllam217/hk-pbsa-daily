(async function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const link = (url, text, cls) =>
    url
      ? `<a${cls ? ` class="${cls}"` : ""} href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`
      : text;
  const DASH = `<span class="muted">—</span>`;
  const UND = `<span class="undisclosed">未披露</span>`;
  const showOrUnd = (html) => (html === null || html === undefined || html === "" || html === DASH ? UND : html);

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error("無法載入 " + path);
    return res.json();
  }

  function fmtTs(iso) {
    const t = new Date(iso);
    if (isNaN(t)) return iso;
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(t).map((x) => [x.type, x.value])
    );
    return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute} HKT`;
  }

  /* ---------- 成交狀態（口徑） ---------- */
  // 已公布 covers announced deals even if the price is only in the media.
  const STATUS = {
    announced: { t: "已公布", tip: "交易方或其委任代理／律師正式公布，或交易所公告" },
    media: { t: "媒體報導", tip: "只見可靠媒體報道，未見交易方公告" },
  };
  const STATUS_ORDER = ["announced", "media"];
  const statusOf = (d) => (STATUS[d.deal_status] ? d.deal_status : "none");
  function badge(d) {
    const k = statusOf(d);
    const st = STATUS[k] || { t: "未分類", tip: "" };
    const tip = st.tip + (d.status_basis ? "。依據：" + d.status_basis : "");
    return `<span class="badge st-${esc(k)}" title="${esc(tip)}">${st.t}</span>` +
      (d.status_pending ? `<span class="pend">${esc(d.status_pending)}</span>` : "");
  }
  let DEAL_BY_ID = {};
  // Badge(s) for news / watch items that refer to a deal in the table, so labels can't drift apart.
  const shortAsset = (d) => {
    if (d.ref_label) return d.ref_label;
    const z = String(d.name_after || d.asset_zh || d.asset || "成交");
    const tail = z.split("→").pop().split("（")[0].trim();
    return tail.length > 18 ? tail.slice(0, 18) + "…" : tail;
  };
  const dealRefs = (ids) =>
    (Array.isArray(ids) ? ids : [])
      .map((k) => DEAL_BY_ID[k])
      .filter(Boolean)
      .map((d) => `<a class="deal-ref" href="#deal-${esc(d.id)}" title="${esc(d.asset_zh || d.asset)}：見近5年成交">${esc(shortAsset(d))} ${badge(d)}</a>`)
      .join(" ");

  /* ---------- 最新消息 ---------- */
  // Window = items dated within the last 14 days of the reference (data "updated") date.
  // Month-only dates are excluded: cannot tell if they fall inside two weeks.
  function newsCutoff(refIso) {
    const m = String(refIso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const ref = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    ref.setUTCDate(ref.getUTCDate() - 14);
    const y = ref.getUTCFullYear(), mo = ref.getUTCMonth() + 1, day = ref.getUTCDate();
    return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  function inWindow(dateStr, cutoff) {
    if (!cutoff) return true;
    const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return false;
    return `${m[1]}-${m[2]}-${m[3]}` >= cutoff;
  }

  const OPINION = /汪敦敬|樓·言板|樓・言板|校長Talk|評論專欄/;
  function visibleNews(n) {
    const title = String(n.title || "");
    if (OPINION.test(title)) return false;
    if (n.auto && /news\.google\.com|google\.com\/rss/.test(String(n.url || ""))) return false;
    return true;
  }
  const BUCKETS = [
    ["放盤", "可以睇，但未成交。叫價唔好當可比。"],
    ["新成交", "先用嚟改收購價假設。"],
    ["新供應", "只列政府官方數據／消息，同各大代理行 research study。單一成交或單一項目申請唔入呢欄。"],
    ["政策", "規則／制度有變（收生上限、簽證、改裝規例、計劃推出）。代理行 research 唔入呢欄，入「新供應」。"],
  ];
  /** 新供應：只收政府官方 + 代理行研究；單一成交／單一項目申請唔入。 */
  function isAgencyResearchNews(n) {
    const src = String(n.source || "");
    const blob = src + " " + String(n.title || "") + " " + String(n.summary || "") + " " + String(n.report_title || "");
    const firm = /仲量聯行|JLL|CBRE|世邦魏理仕|萊坊|Knight\s*Frank|第一太平戴維斯|Savills|高力國際|Colliers|戴德梁行|Cushman|中原測量師|美聯/;
    const study = /研究報告|研究稿|新聞稿|Viewpoint|Research|預測|缺口|估計|展望|白皮書|Smart Growth|順勢部署|業界估計|報告指出|報告刊|未見飽和|回報約/;
    // 來源或標題寫代理行名 + 研究／預測語氣 → 新供應；唔入政策
    return firm.test(src) || firm.test(String(n.title || "")) || (firm.test(blob) && study.test(blob));
  }
  function isGovSupplyNews(n) {
    const src = String(n.source || "");
    const t = String(n.title || "") + " " + String(n.summary || "");
    const blob = src + " " + t;
    const govSrc = /政府|施政報告|立法會|發展局|教育局|規劃署|地政總署|新聞公報|Policy Address|DEVB|EDB|財委會|行政長官/;
    const supplyTopic = /城中學舍|Hostels in the City|宿舍用地|學生宿舍用地|賣地|宿位供應|確認資格|申請過關|擬推.*宿舍|推售.*宿舍|管道|供應/;
    // 單一項目申請／啟用／改裝唔當「新供應」欄官方匯總
    const singleAsset = /廣場申請|酒店申請|大廈申請|擬提供\d+房|啟用：|完成改裝項目之一|聯僑|MU88|個別項目/;
    if (singleAsset.test(blob) && !/施政報告|約\d+宗|本財年|全港|全市/.test(blob)) return false;
    return (govSrc.test(src) || govSrc.test(t)) && supplyTopic.test(blob);
  }
  function newsBucket(n) {
    if (n.bucket === "新供應" || n.bucket === "新成交" || n.bucket === "放盤" || n.bucket === "政策" || n.bucket === "口徑" || n.bucket === "其他") {
      return n.bucket;
    }
    const t = String(n.title || "") + String(n.summary || "");
    // 1) 放售／叫價先入「放盤」（單一放盤唔入新供應／新成交）
    if (/放售|意向價|叫價|尋退場|放盤|獲委任出售|獨家放售/.test(t) && !/億購|完成收購|已成交|易手成交/.test(t)) return "放盤";
    // 2) 代理行 research／政府供應匯總 → 「新供應」（唔入政策）
    if (isAgencyResearchNews(n) || isGovSupplyNews(n)) return "新供應";
    if (/購|斥資|收購|易手|合營/.test(t)) return "新成交";
    // 3) 政策：規則／制度轉變（收生上限、簽證、規例、計劃推出）——唔包研究缺口／租金預測
    if (/收生上限|宿舍守則|規例修訂|簽證|入境|留港|非本地生收生|收生.*上限|計劃推出|拆牆鬆綁/.test(t)) return "政策";
    if (/出租率|入住率|回報|短缺|缺口|未見飽和|租金/.test(t)) return "口徑";
    // 單一項目城規／改裝申請 → 其他（唔入新供應）
    if (/城中學舍|申請改|城規會|擬提供\d|批出改|宿舍用地/.test(t)) return "其他";
    return "其他";
  }
  function newsItemHtml(n) {
    const refs = dealRefs(n.deal_ids);
    const listed = n.date || n.date_label || "";
    const srcDate = n.source_date || "";
    const same = !srcDate || srcDate === listed;
    const monthOnly = n.date_precision === "month" || /^\d{4}-\d{2}$/.test(listed);
    const dateBits = [
      `<span class="n-date" title="入表日期">入表 ${esc(listed)}</span>`,
      same || monthOnly ? "" : `<span class="n-orig" title="原文／公告日期">原文 ${esc(n.source_date_label || srcDate)}</span>`,
      n.earlier_date_label ? `<span class="n-orig" title="較早或另一來源日期">另見 ${esc(n.earlier_date_label)}</span>` : "",
    ].filter(Boolean).join("");
    return `<li>
      <span class="n-dates">${dateBits}</span>
      <div class="n-body">
        ${link(n.url, esc(n.title), "n-title")}
        <span class="n-src">${esc(n.source)}${n.url2 ? ` · ${link(n.url2, esc(n.url2_label || "來源2"))}` : ""}</span>
        ${n.summary ? `<details class="n-sum"><summary>摘要</summary><p>${esc(n.summary)}</p></details>` : ""}
        ${refs ? `<div class="refs">${refs}</div>` : ""}
      </div>
    </li>`;
  }
  function renderNews(data, refIso) {
    const cutoff = newsCutoff(refIso);
    const items = (data.items || []).filter((n) => visibleNews(n) && inWindow(n.date, cutoff));
    const groups = {};
    items.forEach((n) => {
      const b = newsBucket(n);
      (groups[b] || (groups[b] = [])).push(n);
    });
    $("#buckets").innerHTML = BUCKETS.map(([name, hint]) => {
      const list = groups[name] || [];
      const body = list.length
        ? `<ul class="news-list">${list.map(newsItemHtml).join("")}</ul>`
        : `<p class="bucket-empty">近兩星期未有</p>`;
      return `<article class="bucket"><h3>${esc(name)} <span class="bn">${list.length}</span></h3><p class="bucket-hint">${esc(hint)}</p>${body}</article>`;
    }).join("");
    const rest = [...(groups["口徑"] || []), ...(groups["其他"] || [])];
    const restEl = $("#news-rest");
    if (!restEl) { /* no fold */ }
    else if (!rest.length) restEl.hidden = true;
    else {
      restEl.hidden = false;
      restEl.open = false; // 預設摺埋
      $("#news-rest-n").textContent = String(rest.length);
      $("#news-rest-list").innerHTML = rest.map(newsItemHtml).join("");
    }
    return BUCKETS.reduce((n, [name]) => n + (groups[name] || []).length, 0);
  }

  /* ---------- 近5年成交 ---------- */
  function fmtNum(v, digits) {
    if (v === null || v === undefined || v === "") return null;
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function basisTag(d, key) {
    const b = (d.metric_basis || {})[key];
    if (b === "calc") return ` <span class="basis" title="按來源輸入計算">計算</span>`;
    if (b === "source") return ` <span class="basis" title="來源列明">來源</span>`;
    return "";
  }
  function metric(d, key, digits, prefix, suffix) {
    const lo = fmtNum(d[key], digits);
    if (lo === null) return null;
    const hi = fmtNum(d[key + "_max"], digits);
    const txt = hi && hi !== lo ? `${lo}–${hi}` : lo;
    return `${prefix || ""}${txt}${suffix || ""}${basisTag(d, key)}`;
  }
  const range = (lo, hi, f) => (lo === undefined || lo === null ? null : hi ? `${f ? f(lo) : lo}–${f ? f(hi) : hi}` : `${f ? f(lo) : lo}`);
  const n0 = (v) => fmtNum(v, 0);
  const has = (v) => v !== null && v !== undefined && v !== "";

  // Short amount for the table: text before the first note bracket, without the "HK$" (unit is in the header).
  function shortPrice(label) {
    const s = String(label || "").split(/[（(；;]/)[0].replace(/HK\$\s?/g, "").trim();
    return s || "—";
  }

  function sizeTxt(r) {
    if (r.size_label) return esc(r.size_label);
    if (r.size_sqft === undefined) return "未披露";
    return `${range(r.size_sqft, r.size_sqft_max)} 平方呎${r.size_basis ? `（${esc(r.size_basis)}）` : ""}`;
  }
  function rentTxt(r) {
    if (r.rent_label) return esc(r.rent_label);
    if (r.rent_hkd_month === undefined) return "未披露";
    return `HK$${range(r.rent_hkd_month, r.rent_hkd_month_max, n0)}${r.rent_basis ? `（${esc(r.rent_basis)}）` : ""}`;
  }
  function countTxt(r) {
    const bits = [];
    if (has(r.rooms)) bits.push(`${esc(r.rooms)} 間`);
    if (has(r.beds)) bits.push(`${esc(r.beds)} 床`);
    if (has(r.beds_per_room)) bits.push(`每間 ${esc(r.beds_per_room)} 床`);
    return bits.join(" · ") || "未披露";
  }
  const RENT_ST = { operating: "已營運", leasing: "招租中", not_open: "未營運" };
  function rentRollHtml(d) {
    const r = d.rent_roll;
    if (!r) return `<p class="rent-roll muted">出租：未有公開的改建後租金，未入 DCF。</p>`;
    const bits = [`<b>${esc(RENT_ST[r.status] || r.status || "未分類")}</b>`];
    if (has(r.rooms) || has(r.beds)) bits.push([has(r.rooms) ? `${esc(r.rooms)} 間` : "", has(r.beds) ? `${esc(r.beds)} 床` : ""].filter(Boolean).join("／"));
    if (has(r.occupancy_pct)) {
      const scope = r.occupancy_scope ? esc(r.occupancy_scope) : "";
      const onote = r.occupancy_note ? esc(r.occupancy_note) : "";
      bits.push(scope
        ? `出租率 ${esc(r.occupancy_pct)}%（${scope}${onote ? "；" + onote : ""}）`
        : `出租率 ${esc(r.occupancy_pct)}%${onote ? `（${onote}）` : ""}`);
    }
    if (r.as_of) bits.push(esc(r.as_of));
    const src = r.source_url ? ` ${link(r.source_url, "出租來源")}` : "";
    return `<p class="rent-roll">${bits.join(" · ")}${src}</p>${r.note ? `<p class="rent-roll muted">${esc(r.note)}</p>` : ""}<p class="rent-roll muted">DCF：多人房用每床月租 × 床數；單人房用每房月租 × 間數。起價不是平均租金。未營運的叫價不要當成已實現收入。</p>`;
  }

  function openingTxt(d) {
    let s = "";
    if (d.opening_date) {
      const st = d.opening_status === "actual" ? "實際" : d.opening_status === "target" ? "目標" : "";
      s = `${esc(d.opening_date)}${st ? `（${st}）` : ""}`;
    } else if (d.opening_label) s = esc(d.opening_label);
    if (d.months_deal_to_open !== undefined && d.months_deal_to_open !== null)
      s += `${s ? "；" : ""}成交→營運 ${esc(d.months_deal_to_open)} 個月${basisTag(d, "months_deal_to_open")}`;
    return s || null;
  }

  // Full announcement date when known; otherwise YYYY-MM.
  function dateLabel(d) {
    const full = String(d.deal_date || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(full)) return esc(full);
    return esc(monthOf(d));
  }
  function dealKey(d) {
    const s = String(d.deal_date || d.date || "");
    const m = s.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
    return m ? `${m[1]}-${m[2]}-${m[3] || "00"}` : s;
  }
  const monthOf = (d) => dealKey(d).slice(0, 7);
  const yearOf = (d) => dealKey(d).slice(0, 4);
  const regionOf = (d) => String(d.district || "").split("（")[0].trim();

  const mid = (d, key) => {
    const lo = d[key];
    if (!has(lo)) return null;
    const hi = d[key + "_max"];
    return has(hi) ? (Number(lo) + Number(hi)) / 2 : Number(lo);
  };
  const wan = (m) => fmtNum(Math.round(m * 100), 0); // 百萬 → 萬
  const rangeTxt = (d, key, f) => {
    const lo = f(d[key]);
    const hi = has(d[key + "_max"]) ? f(d[key + "_max"]) : null;
    return hi && hi !== lo ? `${lo}–${hi}` : lo;
  };
  const PSF_TAG = { GFA: ["建", "建築面積（GFA）"], saleable: ["實", "實用面積"] };
  const useParts = (u) => String(u || "").split("／").map((x) => x.trim()).filter(Boolean);
  // Words in a property name that already state a use type → don't repeat that type as a badge.
  const USE_WORDS = {
    酒店: ["酒店", "hotel", "旅館", "賓館"],
    住宅: ["住宅", "residence", "residential", "apartment"],
    學生宿舍: ["學生宿舍", "學生公寓", "宿舍", "學舍", "student"],
    寫字樓: ["寫字樓", "office"],
    商廈: ["商廈", "商業大廈"],
    服務式住宅: ["服務式住宅", "serviced"],
  };
  function useTag(d) {
    const name = String(d.asset_zh || d.asset || "").toLowerCase();
    // Name already states a type (酒店／住宅／學生公寓／學生宿舍 …) → no type badge at all.
    const typeWords = Object.values(USE_WORDS).flat().concat(useParts(d.original_use));
    if (typeWords.some((w) => name.includes(w.toLowerCase()))) return "";
    const left = useParts(d.original_use);
    if (!left.length) return "";
    return `<div class="type-row"><span class="use" title="原用途${d.original_use_note ? "：" + esc(d.original_use_note) : ""}">原用途 ${esc(left.join("／"))}</span></div>`;
  }

  function psfCell(d) {
    if (!has(d.price_psf_hkd)) return DASH;
    const t = PSF_TAG[d.psf_basis] || ["未明", "來源未註明面積口徑"];
    return `$${rangeTxt(d, "price_psf_hkd", (v) => fmtNum(v, 0))}<span class="mtag" title="${t[1]}">${t[0]}</span>`;
  }
  function roomCell(d) {
    if (!has(d.price_per_room_hkd_m)) return DASH;
    return `$${rangeTxt(d, "price_per_room_hkd_m", wan)}萬`;
  }
  const UNRENO = `<span class="mtag warn" title="只計收購價；改建投資未有來源">未含翻新</span>`;
  const RENO = `<span class="mtag" title="（代價＋有來源嘅改建投資）÷ 改建後床位">翻新後</span>`;
  // Two separate columns; each deal's per-bed number appears in exactly one of them.
  // 翻新後: only sourced post-renovation figures. 未含翻新: purchase-only, only when no 翻新後 figure exists.
  function renoCell(d) {
    return has(d.all_in_per_bed_hkd_m) ? `$${rangeTxt(d, "all_in_per_bed_hkd_m", wan)}萬` : DASH;
  }
  function unrenoCell(d) {
    if (!has(d.price_per_bed_hkd_m)) return DASH;
    return `$${rangeTxt(d, "price_per_bed_hkd_m", wan)}萬`;
  }
  function bedsCell(d) {
    if (!has(d.beds_after)) return DASH;
    const n = rangeTxt(d, "beds_after", (v) => fmtNum(v, 0));
    const tip = d.beds_after_note ? ` title="${esc(d.beds_after_note)}"` : "";
    return `<span${tip}>${n}</span>`;
  }
  const unrenoVal = (d) => (has(d.all_in_per_bed_hkd_m) ? null : mid(d, "price_per_bed_hkd_m"));
  function areaCell(d) {
    if (!has(d.gfa_sqft)) return DASH;
    const t = d.psf_basis === "saleable" ? PSF_TAG.saleable : PSF_TAG.GFA; // gfa_sqft is GFA unless overridden
    return `${rangeTxt(d, "gfa_sqft", (v) => fmtNum(v, 0))}<span class="mtag" title="${t[1]}">${t[0]}</span>`;
  }
  function roomsCell(d) {
    if (!has(d.rooms)) return DASH;
    return rangeTxt(d, "rooms", (v) => fmtNum(v, 0));
  }

  /* 翻新後每床價（估算）: only for deals with a sourced bed count but no sourced capex.
     = purchase price ÷ beds + scenario capex per bed (by 原用途). Kept apart from the sourced column. */
  let SCEN = null;
  function scenarioFor(d) {
    if (!SCEN || !Array.isArray(SCEN.scenarios)) return null;
    for (const u of useParts(d.original_use)) {
      const s = SCEN.scenarios.find((x) => (x.uses || []).includes(u));
      if (s) return s;
    }
    return null;
  }
  function estimate(d) {
    if (!has(d.beds_after) || has(d.capex_hkd_m) || has(d.all_in_per_bed_hkd_m) || !has(d.price_per_bed_hkd_m)) return null;
    const s = scenarioFor(d);
    if (!s || !Array.isArray(s.per_bed_hkd) || s.per_bed_hkd.length !== 3) return null;
    const lo = Number(d.price_per_bed_hkd_m), hi = has(d.price_per_bed_hkd_m_max) ? Number(d.price_per_bed_hkd_m_max) : lo;
    const c = s.per_bed_hkd.map(Number);
    // values in HK$ 萬
    return { low: lo * 100 + c[0] / 1e4, mid: ((lo + hi) / 2) * 100 + c[1] / 1e4, high: hi * 100 + c[2] / 1e4, s };
  }
  const w0 = (v) => fmtNum(Math.round(v), 0);
  function estCell(d) {
    const e = estimate(d);
    if (!e) return DASH;
    const tip = `估算：收購價÷床位＋${e.s.code} ${e.s.name}改建費（低／中／高）。${SCEN.basis || ""}`;
    return `<span class="est" title="${esc(tip)}">$${w0(e.mid)}萬<span class="mtag est-tag">估算，非成交數</span><small class="est-rng">低–高 ${w0(e.low)}–${w0(e.high)}萬</small></span>`;
  }
  // One key per-bed/per-room figure for the compact mobile card.
  function keyMetric(d) {
    if (has(d.all_in_per_bed_hkd_m)) return `<span class="k-l">每床</span> $${rangeTxt(d, "all_in_per_bed_hkd_m", wan)}萬${RENO}`;
    if (has(d.price_per_bed_hkd_m)) return `<span class="k-l">每床</span> $${rangeTxt(d, "price_per_bed_hkd_m", wan)}萬${UNRENO}`;
    if (has(d.price_per_room_hkd_m)) return `<span class="k-l">每房</span> $${rangeTxt(d, "price_per_room_hkd_m", wan)}萬`;
    return "";
  }
  const otherSources = (d) => (Array.isArray(d.other_sources) ? d.other_sources : []).filter((u) => typeof u === "string" && u.trim());

  function details(d) {
    const H = (v) => ({ html: v }); // pre-escaped HTML
    const st = STATUS[statusOf(d)];
    const stHtml = st
      ? badge(d) + (d.status_basis ? ` ${esc(d.status_basis)}` : "") +
        (d.status_source_url && d.status_source_url !== d.source_url ? " " + link(d.status_source_url, "依據") : "")
      : null;
    const others = otherSources(d);
    // Shown on phones only: the columns hidden from the compact card.
    // Columns moved out of the default table: shown in 詳情 on every screen size.
    const moved = [
      ["賣家", d.seller || "—"],
      ["建築面積（GFA）", H(areaCell(d))],
      ["原有房間／單位", H(roomsCell(d) + ' <span class="mtag">非床位</span>')],
      ["翻新後每床價（估算）", estimate(d) ? H(estCell(d)) : null],
    ];
    // Shown on phones only: the remaining columns hidden from the compact card.
    const mob = [
      ["買家", d.buyer],
      ["原用途", d.original_use ? H(esc(d.original_use) + (d.original_use_note ? `（${esc(d.original_use_note)}）` : "") + (d.original_use_source_url ? " " + link(d.original_use_source_url, "來源") : "")) : null],
      ["呎價", H(psfCell(d))],
      ["每房價", H(roomCell(d))],
      ["翻新後每床價", H(renoCell(d))],
      ["每床價（未含翻新）", H(unrenoCell(d))],
      ["主來源", H(link(d.source_url, esc(d.source)) + (others.length ? ` · ${link(others[0], "第二來源")}` : ""))],
    ];
    const facts = [
      ["狀態", stHtml ? H(stHtml) : null],
      ["代價（原文）", d.price_label ? (d.status === "media_price" ? { html: esc(d.price_label) + " " + priceStatusTag(d) } : d.price_label) : null],
      ["價錢備註", d.price_note || null],
      ["成交日期", d.deal_date],
      ["改建後名稱", d.name_after || "未公布"],
      ["原物業", d.former_name || null],
      ["英文名稱", d.asset_zh && d.asset !== d.asset_zh ? d.asset : null],
      ["原用途", d.original_use ? H(esc(d.original_use) + (d.original_use_note ? `（${esc(d.original_use_note)}）` : "") + (d.original_use_source_url ? " " + link(d.original_use_source_url, "來源") : "")) : null, "d-only"],
      ["位置", d.location],
      ["地區", d.district],
      ["類型", d.type],
      ["指標", d.metrics],
      ["每床價（未含翻新）", H(metric(d, "price_per_bed_hkd_m", 2, "HK$", "百萬"))],
      ["開始營運", H(openingTxt(d))],
      ["鄰近大學", d.nearest_university],
      ["鄰近港鐵", d.nearest_mtr],
      ["改建後床位", has(d.beds_after) ? range(d.beds_after, d.beds_after_max) + (d.beds_after_note ? `（${d.beds_after_note}）` : "") + "（非原有房間數）" : "來源未列"],
      ["床／房比", H(metric(d, "beds_per_room", 2))],
      ["改建投資（百萬）", range(d.capex_hkd_m, d.capex_hkd_m_max)],
      ["總投資（百萬）", d.total_investment_hkd_m ? `${d.total_investment_hkd_m}${d.total_investment_note ? `（${d.total_investment_note}）` : ""}` : null],
      ["翻新後每床（百萬）", has(d.all_in_per_bed_hkd_m) ? H(metric(d, "all_in_per_bed_hkd_m", 2) + (d.all_in_note ? `（${esc(d.all_in_note)}）` : "")) : null],
      ["落成年份", d.completion_year],
      ["地契", d.lease_note],
      ["入住率", d.occupancy_pct !== undefined ? `${d.occupancy_pct}%${d.occupancy_note ? `（${d.occupancy_note}）` : ""}` : null],
      ["報稱回報", d.reported_yield_pct !== undefined ? `${d.reported_yield_pct}%${d.reported_yield_note ? `（${d.reported_yield_note}）` : ""}` : null],
      ["保證收入", d.guaranteed_income_hkd_m_pa ? H(`每年HK$${esc(d.guaranteed_income_hkd_m_pa)}百萬 × ${esc(d.guaranteed_years || "?")}年；相當於代價 ${metric(d, "guaranteed_yield_pct", 2, "", "%") || "—"}`) : null],
      ["年收入（百萬）", d.annual_revenue_hkd_m],
      ["月租收入（百萬）", d.monthly_rent_income_hkd_m],
      ["呎價計算範圍（HK$）", Array.isArray(d.price_psf_hkd_calc_range) ? d.price_psf_hkd_calc_range.map(n0).join("–") : null],
      ["每床月租", d.rent_per_bed_min_hkd ? `HK$${n0(d.rent_per_bed_min_hkd)}${d.rent_per_bed_max_hkd && d.rent_per_bed_max_hkd !== d.rent_per_bed_min_hkd ? "–" + n0(d.rent_per_bed_max_hkd) : ""}` : null],
      ["毛收益率", H(metric(d, "gross_yield_pct", 2, "", "%"))],
      ["營運備註", d.opening_note],
      ["其他備註", d.note_zh],
    ];
    const ok = ([, v]) => v !== null && v !== undefined && v !== "" && !(typeof v === "object" && (v.html === null || v.html === ""));
    const fact = ([k, v, cls]) => `<div class="fact${cls ? " " + cls : ""}"><dt>${k}</dt><dd>${typeof v === "object" ? v.html : esc(v)}</dd></div>`;
    const movedHtml = moved.filter(ok).map(fact).join("");
    const mobHtml = mob.filter(ok).map(fact).join("");
    const factHtml = facts.filter(ok).map(fact).join("");

    const links = [
      link(d.source_url, `主來源：${esc(d.source)}`),
      ...others.map((u, i) => link(u, `來源${i + 2}`)),
      d.project_url ? link(d.project_url, "項目網頁") : "",
    ].filter(Boolean).join(" · ");

    const rts = d.room_types || [];
    const rtHtml = rts.length
      ? `<div class="rt-wrap"><table class="rt"><thead><tr><th>房型</th><th>間／床</th><th>面積</th><th>月租</th><th>備註</th><th>資料日期</th><th>來源</th></tr></thead><tbody>${rts
          .map((r) => `<tr><td>${esc(r.name)}</td><td>${countTxt(r)}</td><td>${sizeTxt(r)}</td><td>${rentTxt(r)}</td><td>${esc(r.rent_note || "")}</td><td>${esc(r.as_of || "")}</td><td>${r.source_url ? link(r.source_url, "連結") : "—"}</td></tr>`)
          .join("")}</tbody></table></div>`
      : `<p class="muted small">未有按房型公開的面積或租金。</p>`;

    return `<dl class="facts m-only">${mobHtml}</dl><dl class="facts moved">${movedHtml}</dl><dl class="facts">${factHtml}</dl><p class="d-links">${links}</p><h4>改建後出租（做 DCF）</h4>${rentRollHtml(d)}${rtHtml}`;
  }

  function priceStatusTag(d) {
    if (d.status === "media_price") {
      return `<span class="mtag media-price" title="媒體報道價錢；非官方確認成交價">媒體價／非確認價</span>`;
    }
    return "";
  }
  function dealBody(d, idx) {
    const media = priceStatusTag(d);
    const rid = `dd-${idx}`;
    const num = (v) => (v === null || v === undefined ? "" : v);
    const others = otherSources(d);
    const e = estimate(d);
    const km = keyMetric(d);
    const former = d.former_name || d.asset || d.asset_zh || "";
    const after = d.name_after || "";
    const afterCell = `<div class="c-top"><span class="c-date">${dateLabel(d)}</span></div>` + (after
      ? `<div class="a-name">${esc(after)}</div>${former ? `<div class="a-former">原：${esc(former)}</div>` : ""}${d.project_url ? `<div class="a-site">${link(d.project_url, "官網")}</div>` : ""}`
      : `<span class="undisclosed">未披露</span>${former ? `<div class="a-former">原：${esc(former)}</div>` : ""}`);
    const formerCell = former ? esc(former) : UND;
    const distCell = d.district ? esc(d.district) : (d.location ? esc(d.location) : UND);
    const sellerCell = d.seller ? esc(d.seller) : UND;
    const useCell = d.original_use ? esc(d.original_use) : UND;
    return `<tbody class="deal" id="deal-${esc(d.id || idx)}" data-status="${esc(statusOf(d))}" data-date="${esc(dealKey(d))}" data-price="${d.price_hkd_m ?? ""}" data-area="${num(mid(d, "gfa_sqft"))}" data-rooms="${num(mid(d, "rooms"))}" data-psf="${num(mid(d, "price_psf_hkd"))}" data-room="${num(mid(d, "price_per_room_hkd_m"))}" data-bed="${num(mid(d, "all_in_per_bed_hkd_m"))}" data-beds="${num(mid(d, "beds_after"))}" data-unreno="${num(mid(d, "price_per_bed_hkd_m"))}" data-est="${e ? e.mid : ""}" data-idx="${idx}">
      <tr class="main">
        <td class="c-dt">${dateLabel(d)}</td>
        <td class="c-former">${formerCell}<div class="c-statusline">${badge(d)}</div></td>
        <td class="c-after">${afterCell}${km ? `<div class="m-key">${km}</div>` : ""}<div class="c-statusline">${badge(d)}</div></td>
        <td class="c-dist">${distCell}</td>
        <td class="c-parties">${d.buyer ? esc(d.buyer) : UND}</td>
        <td class="c-seller">${sellerCell}</td>
        <td class="c-use">${useCell}</td>
        <td class="c-gfa num">${showOrUnd(areaCell(d) === DASH ? null : areaCell(d))}</td>
        <td class="c-price num">${d.price_label ? esc(shortPrice(d.price_label)) : UND}${media}</td>
        <td class="c-rooms num">${showOrUnd(roomsCell(d) === DASH ? null : roomsCell(d))}</td>
        <td class="c-m c-room num">${showOrUnd(roomCell(d) === DASH ? null : roomCell(d))}</td>
        <td class="c-m c-psf num">${showOrUnd(psfCell(d) === DASH ? null : psfCell(d))}</td>
        <td class="c-beds num">${showOrUnd(bedsCell(d) === DASH ? null : bedsCell(d))}</td>
        <td class="c-m c-unreno num">${showOrUnd(unrenoCell(d) === DASH ? null : unrenoCell(d))}</td>
        <td class="c-src"><span class="src-links">${link(d.source_url, esc(d.source || "來源"))}${others.length ? ` <span class="src2">· ${link(others[0], "來源2", "")}${others.length > 1 ? `＋${others.length - 1}` : ""}</span>` : ""}</span><button type="button" class="more-link" aria-expanded="false" aria-controls="${rid}">詳情</button></td>
      </tr>
      <tr class="detail" id="${rid}" hidden><td colspan="15">${details(d)}</td></tr>
    </tbody>`;
  }

  /* ---------- 統計：中位數＋範圍 ---------- */
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y), k = s.length >> 1;
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  };
  function statLine(label, vals, f, extraCls) {
    if (!vals.length) return `<li class="${extraCls || ""}"><span class="s-l">${label}</span> <span class="muted">—（n=0）</span></li>`;
    const few = vals.length < 5 ? ` <em class="few">樣本少，勿當估值</em>` : "";
    return `<li class="${extraCls || ""}"><span class="s-l">${label}</span> 中位數 <b>${f(median(vals))}</b> <span class="s-r">（${f(Math.min(...vals))}–${f(Math.max(...vals))}，n=${vals.length}）</span>${few}</li>`;
  }
  // Default: all 已公布. Toggle adds 媒體報導.
  const firmDeal = (d) => d.deal_status === "announced";
  function renderSummary(shown, total, withMedia) {
    const pool = shown.filter((d) => (withMedia ? d.deal_status === "announced" || d.deal_status === "media" : firmDeal(d)));
    const vals = (arr, key) => arr.map((d) => mid(d, key)).filter((v) => v !== null);
    const $psf = (v) => "$" + fmtNum(v, 0), $w = (v) => "$" + wan(v) + "萬";
    const psfG = vals(pool.filter((d) => d.psf_basis === "GFA"), "price_psf_hkd");
    const psfS = vals(pool.filter((d) => d.psf_basis === "saleable"), "price_psf_hkd");
    const room = vals(pool, "price_per_room_hkd_m");
    const bed = vals(pool, "all_in_per_bed_hkd_m");
    const unreno = vals(pool, "price_per_bed_hkd_m");
    const est = pool.map(estimate).filter(Boolean).map((e) => e.mid);
    const lines = [
      statLine("呎價（建築面積）", psfG, $psf),
      psfS.length ? statLine("呎價（實用面積）", psfS, $psf) : "",
      statLine("每房價", room, $w),
    ].join("");
    const side = [
      statLine("每床價（未含翻新）", unreno, $w, "side"),
    ].join("");
    const estBlock = "";
    const hint = !withMedia && shown.length && !pool.length ? `；篩選結果只有媒體報導，勾選右邊可計入` : "";
    $("#sum-n").innerHTML = `篩選後 n=<b>${shown.length}</b>／${total} 宗 · 統計計入 <b>${pool.length}</b> 宗（${withMedia ? "已公布＋媒體報導" : "只計已公布"}${hint}）`;
    $("#sum-main").innerHTML = lines;
    $("#sum-side").innerHTML = side;
    let estHost = document.getElementById("sum-est");
    if (!estHost) {
      estHost = document.createElement("ul");
      estHost.id = "sum-est";
      estHost.className = "sum-est";
      $("#sum-side").insertAdjacentElement("afterend", estHost);
    }
    estHost.innerHTML = estBlock;
  }


  const USE_CLASS = [
    ["酒店", "酒店"],
    ["商廈", "商廈／寫字樓"],
    ["住宅", "住宅"],
    ["其他", "其他"],
  ];
  function classOf(d) {
    const u = String(d.original_use || "");
    if (u === "酒店") return "酒店";
    if (u === "住宅") return "住宅";
    if (u === "寫字樓" || u === "商廈") return "商廈";
    return "其他";
  }
  function capexForClass(cls) {
    if (!SCEN || !Array.isArray(SCEN.scenarios)) return null;
    const code = { 酒店: "S1", 商廈: "S2", 住宅: "S3" }[cls];
    return code ? SCEN.scenarios.find((s) => s.code === code) || null : null;
  }
  function bedsPerK(d) {
    const beds = mid(d, "beds_after");
    const gfa = mid(d, "gfa_sqft");
    if (!beds || !gfa) return null;
    return beds / (gfa / 1000);
  }
  function rentObs(d) {
    if (!has(d.rent_per_bed_min_hkd)) return null;
    const lo = Number(d.rent_per_bed_min_hkd);
    return has(d.rent_per_bed_max_hkd) ? (lo + Number(d.rent_per_bed_max_hkd)) / 2 : lo;
  }
  function statCell(vals, fmt) {
    if (!vals.length) return `<span class="muted">未有</span>`;
    const few = vals.length < 5 ? ` <em class="few">樣本少</em>` : "";
    const med = fmt(median(vals));
    const lo = fmt(Math.min(...vals));
    const hi = fmt(Math.max(...vals));
    const range = lo === hi ? "" : `${lo}–${hi} · `;
    return `<b>${med}</b><span class="s-r">${range}n=${vals.length}</span>${few}`;
  }
  let MODEL_DEALS = [];
  function renderModel() {
    const use = $("#m-use").value;
    const region = $("#m-region").value;
    const withMedia = $("#m-media").checked;
    let pool = MODEL_DEALS.filter((d) =>
      withMedia ? d.deal_status === "announced" || d.deal_status === "media" : d.deal_status === "announced"
    );
    if (region) pool = pool.filter((d) => regionOf(d) === region);
    const classes = use ? USE_CLASS.filter((c) => c[0] === use) : USE_CLASS;
    const wanH = (v) => "$" + fmtNum(Math.round(v / 10000), 0) + "萬";
    const money = (v) => "$" + fmtNum(Math.round(v), 0);
    const body = classes.map(([cls, label]) => {
      const rowsD = pool.filter((d) => classOf(d) === cls);
      if (!rowsD.length) return "";
      const psf = rowsD.map((d) => (d.psf_basis === "GFA" ? mid(d, "price_psf_hkd") : null)).filter((v) => v !== null);
      const room = rowsD.map((d) => mid(d, "price_per_room_hkd_m")).filter((v) => v !== null).map((v) => v * 1e6);
      const bpk = rowsD.map(bedsPerK).filter((v) => v !== null);
      const pbed = rowsD.map((d) => mid(d, "price_per_bed_hkd_m")).filter((v) => v !== null).map((v) => v * 1e6);
      const rent = rowsD.map(rentObs).filter((v) => v !== null);
      const months = rowsD.map((d) => (has(d.months_deal_to_open) ? Number(d.months_deal_to_open) : null)).filter((v) => v !== null && !isNaN(v));
      const cap = capexForClass(cls);
      const capexHtml = cap
        ? `<span class="est">$${fmtNum(Math.round(cap.per_bed_hkd[1] / 10000), 0)}萬</span><span class="s-r">情景 ${fmtNum(Math.round(cap.per_bed_hkd[0] / 10000), 0)}–${fmtNum(Math.round(cap.per_bed_hkd[2] / 10000), 0)}萬 · 非成交</span>`
        : `<span class="muted">冇對應情景</span>`;
      const allIn = pbed.length && cap
        ? `<b class="est">${wanH(median(pbed) + cap.per_bed_hkd[1])}</b><span class="s-r">收購中位＋改建中位</span>`
        : `<span class="muted">未有</span>`;
      const names = rowsD.map((d) => `<a href="#deal-${esc(d.id)}">${esc(shortAsset(d))}</a>`).join("、");
      return `<tr>
        <th scope="row">${esc(label)}<span class="s-r">${rowsD.length} 宗</span></th>
        <td>${statCell(psf, money)}</td>
        <td>${statCell(room, wanH)}</td>
        <td>${statCell(bpk, (v) => fmtNum(v, 1))}</td>
        <td>${statCell(pbed, wanH)}</td>
        <td>${capexHtml}</td>
        <td>${allIn}</td>
        <td>${statCell(rent, (v) => "$" + fmtNum(Math.round(v), 0))}</td>
        <td>${statCell(months, (v) => fmtNum(v, 0) + "個月")}</td>
      </tr><tr class="model-names"><td colspan="9">樣本：${names}</td></tr>`;
    }).join("");
    $("#model-out").innerHTML = body
      ? `<div class="table-wrap"><table class="model"><thead><tr>
          <th>原用途</th><th>收購呎價<small>建築面積</small></th><th>每房價</th><th>每千呎床數</th>
          <th>每床收購價</th><th>改建費<small>情景中位</small></th><th>全套每床<small>估算</small></th>
          <th>每床月租</th><th>成交至開業</th>
        </tr></thead><tbody>${body}</tbody></table></div>`
      : `<p class="muted">呢個範圍未有${withMedia ? "" : "已公布"}成交。</p>`;
  }


  /* ---------- 可比區間總表（comps_ranges.json） ---------- */
  let COMPS = null;
  const COMPS_LABELS = {
    price_per_room_hkd_m: "每房價",
    price_per_bed_hkd_m: "每床價（未含翻新）",
    price_psf_hkd: "呎價（建築面積）",
    beds_per_room: "房改床比率",
    rent_per_bed_hkd_month: "每床月租（觀測）",
    months_deal_to_open: "成交→開業月數",
  };
  function compsFmt(key, v) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    if (key === "price_per_room_hkd_m" || key === "price_per_bed_hkd_m") return "$" + fmtNum(v, 2) + "百萬";
    if (key === "price_psf_hkd") return "$" + fmtNum(Math.round(v), 0);
    if (key === "beds_per_room") return fmtNum(v, 2);
    if (key === "rent_per_bed_hkd_month") return "$" + fmtNum(Math.round(v), 0);
    if (key === "months_deal_to_open") return fmtNum(v, 0) + "個月";
    return String(v);
  }
  function renderCompsRanges(scope) {
    const host = $("#comps-body");
    if (!host) return;
    if (!COMPS) {
      host.innerHTML = `<tr><td colspan="6" class="muted">未有 comps_ranges.json。</td></tr>`;
      return;
    }
    const block = COMPS[scope] || COMPS.primary;
    const upd = $("#comps-updated");
    if (upd) upd.textContent = COMPS.as_of ? `資料 as_of ${COMPS.as_of} · 池 n=${block.pool_n}` : "";
    const keys = Object.keys(COMPS_LABELS);
    host.innerHTML = keys.map((k) => {
      const s = block[k] || {};
      const n = s.n || 0;
      if (!n) {
        return `<tr><th scope="row">${esc(COMPS_LABELS[k])}</th><td class="num c-empty" colspan="3">未有足夠來源數字</td><td class="num">n=0</td><td class="muted">${esc(s.unit || "")}</td></tr>`;
      }
      return `<tr>
        <th scope="row">${esc(COMPS_LABELS[k])}</th>
        <td class="num">${compsFmt(k, s.min)}</td>
        <td class="num"><b>${compsFmt(k, s.median)}</b></td>
        <td class="num">${compsFmt(k, s.max)}</td>
        <td class="num">n=${n}</td>
        <td class="muted">${esc((s.unit || "") + (s.basis ? " · " + s.basis : ""))}</td>
      </tr>`;
    }).join("");
  }

  function renderDeals(data) {
    const all = data.deals || [];
    const table = $("table.deals");
    table.querySelectorAll("tbody").forEach((t) => t.remove());
    table.insertAdjacentHTML("beforeend", all.map(dealBody).join(""));

    table.addEventListener("click", (e) => {
      const b = e.target.closest(".more-link");
      if (!b) return;
      const row = document.getElementById(b.getAttribute("aria-controls"));
      row.hidden = !row.hidden;
      b.setAttribute("aria-expanded", String(!row.hidden));
      b.textContent = row.hidden ? "詳情" : "收起";
      b.closest("tbody").classList.toggle("open", !row.hidden);
    });

    // sorting (month-only dates sort as day 00, i.e. just after full dates of the same month when descending)
    const state = { key: "date", dir: -1 };
    function sortBy(key, dir) {
      const bodies = [...table.querySelectorAll("tbody.deal")];
      bodies.sort((a, b) => {
        let va = a.dataset[key], vb = b.dataset[key];
        if (key !== "date") {
          va = va === "" ? null : Number(va);
          vb = vb === "" ? null : Number(vb);
          if (va === null && vb === null) return a.dataset.idx - b.dataset.idx;
          if (va === null) return 1;
          if (vb === null) return -1;
          return (va - vb) * dir || a.dataset.idx - b.dataset.idx;
        }
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir || a.dataset.idx - b.dataset.idx;
      });
      bodies.forEach((b) => table.appendChild(b));
      table.querySelectorAll("th.sortable").forEach((th) =>
        th.setAttribute("aria-sort", th.dataset.sort === key ? (dir < 0 ? "descending" : "ascending") : "none")
      );
      const sel = $("#f-sort");
      if (sel) sel.value = `${key}:${dir}`;
    }
    const doSort = (key, dir) => { state.key = key; state.dir = dir; sortBy(key, dir); };
    table.querySelectorAll("th.sortable button").forEach((btn) =>
      btn.addEventListener("click", () => {
        const key = btn.parentElement.dataset.sort;
        doSort(key, state.key === key ? -state.dir : -1);
      })
    );
    $("#f-sort").addEventListener("change", (e) => {
      const [k, dir] = e.target.value.split(":");
      doSort(k, Number(dir));
    });
    sortBy("date", -1);

    // ---- filters ----
    const opts = (vals) => [...new Set(vals.filter(Boolean))];
    const fill = (sel, values, counts) => {
      sel.insertAdjacentHTML("beforeend", values.map((v) => `<option value="${esc(v)}">${esc(v)}${counts ? `（${counts[v]}）` : ""}</option>`).join(""));
    };
    const cnt = (arr) => arr.reduce((o, v) => ((o[v] = (o[v] || 0) + 1), o), {});
    const regC = cnt(all.map(regionOf));
    fill($("#f-region"), opts(all.map(regionOf)).sort((a, b) => regC[b] - regC[a] || a.localeCompare(b, "zh-HK")), regC);
    fill($("#f-year"), opts(all.map(yearOf)).sort().reverse(), cnt(all.map(yearOf)));
    const stC = cnt(all.map(statusOf));
    $("#f-status").insertAdjacentHTML("beforeend", STATUS_ORDER.map((k) => `<option value="${k}">${STATUS[k].t}（${stC[k] || 0}）</option>`).join(""));
    const useC = cnt(all.flatMap((d) => useParts(d.original_use)));
    fill($("#f-use"), Object.keys(useC).sort((a, b) => useC[b] - useC[a] || a.localeCompare(b, "zh-HK")), useC);
    $("#f-buyers").innerHTML = opts(all.map((d) => d.buyer)).map((b) => `<option value="${esc(b)}"></option>`).join("");

    const norm = (v) => String(v || "").toLowerCase().replace(/\s+/g, "");
    const F = () => ({
      q: norm($("#f-q").value), region: $("#f-region").value, year: $("#f-year").value,
      buyer: norm($("#f-buyer").value), status: $("#f-status").value, use: $("#f-use").value,
      bed: $("#f-bed").value, media: $("#f-media").checked,
    });
    const hasBed = (d) => has(d.all_in_per_bed_hkd_m) || has(d.price_per_bed_hkd_m);
    function apply() {
      const f = F();
      const shown = [];
      table.querySelectorAll("tbody.deal").forEach((tb) => {
        const d = all[Number(tb.dataset.idx)];
        const hay = norm([d.name_after, d.former_name, d.asset_zh, d.asset, d.location, d.district, d.buyer, d.seller, d.original_use].join(" "));
        const ok =
          (!f.q || hay.includes(f.q)) &&
          (!f.region || regionOf(d) === f.region) &&
          (!f.year || yearOf(d) === f.year) &&
          (!f.buyer || norm(d.buyer).includes(f.buyer)) &&
          (!f.status || statusOf(d) === f.status) &&
          (!f.use || useParts(d.original_use).includes(f.use)) &&
          (!f.bed || (f.bed === "yes" ? hasBed(d) : !hasBed(d)));
        tb.hidden = !ok;
        if (ok) shown.push(d);
      });
      const active = [f.q, f.region, f.year, f.buyer, f.status, f.use, f.bed].filter(Boolean).length;
      $("#f-active").textContent = active ? `（${active} 項）` : "";
      $("#f-empty").hidden = shown.length > 0;
      renderSummary(shown, all.length, f.media);
    }
    $("#filters").addEventListener("input", apply);
    $("#filters").addEventListener("change", apply);
    $("#f-media").addEventListener("change", apply);
    $("#f-reset").addEventListener("click", () => {
      ["#f-q", "#f-buyer"].forEach((s) => ($(s).value = ""));
      ["#f-region", "#f-year", "#f-status", "#f-use", "#f-bed"].forEach((s) => ($(s).value = ""));
      apply();
    });
    // Compact (closed) filter panel on phones, open on desktop.
    if (window.matchMedia("(max-width: 720px)").matches) $("#filters").open = false;
    apply();
  }

  function fmtSdValue(item) {
    const v = item.value;
    if (v === null || v === undefined || v === "") return UND;
    if (typeof v === "number") return Number(v).toLocaleString("en-US");
    return esc(v);
  }
  function sdItemHtml(item) {
    const tag = [
      item.single_source ? `<span class="sd-tag" title="只有一個獨立來源">單一來源</span>` : "",
      (item.category === "industry" || /業界估計/.test(String(item.note || "")))
        ? `<span class="sd-tag sd-tag-ind" title="顧問／業界估計，非政府官方">業界估計</span>` : "",
    ].filter(Boolean).join("");
    const src = item.source_url
      ? link(item.source_url, esc(item.source_name || "來源"))
      : esc(item.source_name || "來源");
    const asOf = item.as_of ? `截至 ${esc(item.as_of)}` : "";
    const period = item.period ? esc(item.period) : "";
    const note = item.note ? esc(item.note) : "";
    return `<li>
      <span class="sd-val">${fmtSdValue(item)}<span class="sd-unit">${esc(item.unit || "")}</span>${tag}</span>
      <span class="sd-label">${esc(item.label || "")}</span>
      <span class="sd-meta">${[asOf, period].filter(Boolean).join(" · ")}${note ? `<br>${note}` : ""}<br>${src}${item.doc_id ? ` · <code>${esc(item.doc_id)}</code>` : ""}</span>
    </li>`;
  }
  function renderSupplyDemand(data) {
    if (!data) {
      $("#sd-demand").innerHTML = `<p class="muted">未有供求資料檔。</p>`;
      $("#sd-supply").innerHTML = "";
      $("#sd-pipeline").innerHTML = "";
      $("#sd-gaps").hidden = true;
      return;
    }
    const demand = data.demand || [];
    const supply = data.supply || [];
    const pipeline = data.pipeline || [];
    const industry = data.industry || [];
    $("#sd-demand").innerHTML = demand.length
      ? `<ul class="sd-list">${demand.map(sdItemHtml).join("")}</ul>`
      : `<p class="muted">暫無</p>`;
    $("#sd-supply").innerHTML = supply.length
      ? `<ul class="sd-list">${supply.map(sdItemHtml).join("")}</ul>`
      : `<p class="muted">暫無</p>`;
    $("#sd-pipeline").innerHTML = pipeline.length
      ? `<ul class="sd-list">${pipeline.map(sdItemHtml).join("")}</ul>`
      : `<p class="muted">暫無</p>`;
    const indEl = $("#sd-industry");
    const indWrap = $("#sd-industry-wrap");
    if (indEl) {
      if (!industry.length) {
        if (indWrap) indWrap.hidden = true;
        indEl.innerHTML = "";
      } else {
        if (indWrap) indWrap.hidden = false;
        indEl.innerHTML = `<ul class="sd-list sd-industry-list">${industry.map(sdItemHtml).join("")}</ul>`;
      }
    }
    const gaps = data.gaps || [];
    if (!gaps.length) $("#sd-gaps").hidden = true;
    else {
      $("#sd-gaps").hidden = false;
      $("#sd-gaps-n").textContent = String(gaps.length);
      $("#sd-gaps-list").innerHTML = gaps.map((g) => `<li>${esc(g)}</li>`).join("");
    }
  }

  function projectRentSummary(d) {
    const bits = [];
    const rr = d.rent_roll;
    if (rr) {
      if (rr.status) bits.push(RENT_ST[rr.status] || rr.status);
      if (has(rr.occupancy_pct)) {
        const scope = rr.occupancy_scope || "";
        bits.push(scope ? `出租率 ${rr.occupancy_pct}%（${scope}）` : `出租率 ${rr.occupancy_pct}%`);
      }
      if (rr.note) bits.push(rr.note);
    }
    const rts = d.room_types || [];
    if (rts.length) {
      const sample = rts.slice(0, 3).map((r) => {
        const rent = r.rent_label || (has(r.rent_hkd_month) ? `HK$${n0(r.rent_hkd_month)}` : "");
        return `${r.name || "房型"}${rent ? ` ${rent}` : ""}`;
      });
      bits.push(sample.join("；") + (rts.length > 3 ? ` 等 ${rts.length} 種房型` : ""));
    }
    return bits.length ? esc(bits.join(" · ")) : `<span class="undisclosed">未披露</span>`;
  }
  function renderProjects(deals) {
    const rows = (deals || []).filter((d) => d.rent_roll || (d.room_types && d.room_types.length) || has(d.beds_after) || d.project_url);
    if (!rows.length) {
      $("#projects-body").innerHTML = `<tr><td colspan="7" class="muted">未有改建後公開租金／床位資料。</td></tr>`;
      return;
    }
    $("#projects-body").innerHTML = rows.map((d) => {
      const name = d.name_after || d.asset_zh || d.asset || "—";
      const former = d.former_name && d.name_after ? `<span class="proj-former">原：${esc(d.former_name)}</span>` : "";
      const beds = has(d.beds_after)
        ? rangeTxt(d, "beds_after", (v) => fmtNum(v, 0))
        : (d.rent_roll && has(d.rent_roll.beds) ? fmtNum(d.rent_roll.beds, 0) : UND);
      const stRaw = d.rent_roll ? (RENT_ST[d.rent_roll.status] || d.rent_roll.status || "") : "";
      const stCell = stRaw ? esc(stRaw) : UND;
      const asOf = (d.rent_roll && d.rent_roll.as_of) || (d.room_types && d.room_types[0] && d.room_types[0].as_of) || "—";
      const srcUrl = (d.rent_roll && d.rent_roll.source_url) || d.project_url || d.source_url;
      const srcLabel = d.project_url && srcUrl === d.project_url ? "項目網頁" : (d.source || "來源");
      return `<tr>
        <td><span class="proj-name">${link(`#deal-${esc(d.id)}`, esc(name))}</span>${former}</td>
        <td>${d.district ? esc(d.district) : UND}</td>
        <td class="num">${beds}</td>
        <td>${stCell}</td>
        <td class="proj-rent">${projectRentSummary(d)}</td>
        <td>${esc(asOf)}</td>
        <td>${srcUrl ? link(srcUrl, esc(srcLabel)) : UND}</td>
      </tr>`;
    }).join("");
  }

  function leadBucket(L) {
    const t = String(L.note || "") + String(L.asset || "");
    if (/放售|叫價|招標|估值／招標|待售|指示價|意向價/.test(t)) return "放售／叫價";
    if (/用途未確認|買家未獲官方確認|買家用途未確認|非學生宿舍|成交是否完成待核實|細節待查/.test(t)) return "用途未確認／待核實";
    return "其他待核實";
  }

  function pendingRowHtml(P) {
    const name = P.asset_zh || P.asset || P.id || "—";
    const price = has(P.price_hkd_m)
      ? (P.price_label || `約 ${fmtNum(P.price_hkd_m)} 百萬`)
      : "未披露";
    const rooms = has(P.rooms) ? String(P.rooms) : "—";
    const beds = has(P.beds_after) ? String(P.beds_after) : (has(P.beds) ? String(P.beds) : "—");
    const src = P.source_url ? link(P.source_url, esc(P.source || "來源")) : esc(P.source || "—");
    const src2 = P.source_url2 ? ` · ${link(P.source_url2, "來源2")}` : "";
    const note = P.approval_note || P.note || "";
    return `<tr class="pending-row">
      <td><span class="pend-badge" title="未獲 FINAL CHECK 批准">未批准</span></td>
      <td>${esc(P.proposed_date || P.deal_date || P.date || "—")}</td>
      <td>${esc(name)}${P.former_name ? `<div class="muted small">${esc(P.former_name)}</div>` : ""}</td>
      <td>${esc(P.district || P.location || "—")}</td>
      <td>${esc(P.buyer || "未披露")}</td>
      <td class="num">${esc(price)}</td>
      <td class="num">${esc(rooms)} 房／${esc(beds)} 床</td>
      <td class="c-src">${src}${src2}</td>
      <td class="pending-note">${esc(note)}</td>
    </tr>`;
  }
  function renderPending(list) {
    const box = $("#pending-fold");
    const body = $("#pending-tbody");
    const nEl = $("#pending-n");
    if (!box || !body) return;
    const rows = list || [];
    if (nEl) nEl.textContent = String(rows.length);
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="9" class="muted">暫無待批核項目。新發現成交會先寫喺呢度，等你 FINAL CHECK。</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(pendingRowHtml).join("");
  }

  function leadItemHtml(L) {
    const src = L.source_url ? link(L.source_url, esc(L.source || "來源")) : esc(L.source || "");
    const src2 = L.source_url2 ? ` · ${link(L.source_url2, "來源2")}` : "";
    const date = L.source_date ? esc(L.source_date) : "";
    const tag = leadBucket(L);
    return `<li data-lead-bucket="${esc(tag)}">
      <span class="lead-tag">${esc(tag)}</span>
      <span class="lead-asset">${esc(L.asset || L.asset_zh || "線索")}</span>
      ${L.note ? `<span class="lead-note">${esc(L.note)}</span>` : ""}
      <span class="lead-src">${date}${date && src ? " · " : ""}${src}${src2}</span>
    </li>`;
  }
  function renderLeads(list) {
    const fold = $("#leads-fold");
    if (!list || !list.length) { fold.hidden = true; return; }
    fold.hidden = false;
    $("#leads-n").textContent = String(list.length);
    const order = ["放售／叫價", "用途未確認／待核實", "其他待核實"];
    const groups = {};
    list.forEach((L) => {
      const b = leadBucket(L);
      (groups[b] || (groups[b] = [])).push(L);
    });
    $("#leads-list").innerHTML = order.filter((b) => groups[b] && groups[b].length).map((b) => {
      return `<li class="lead-group"><strong class="lead-group-h">${esc(b)}（${groups[b].length}）</strong><ul class="leads-sub">${groups[b].map(leadItemHtml).join("")}</ul></li>`;
    }).join("");
  }

  function renderGaps(data) {
    const gaps = data.gaps || [];
    if (!gaps.length) { $("#gaps").hidden = true; return; }
    $("#gaps").hidden = false;
    $("#gaps-n").textContent = gaps.length;
    $("#gaps-list").innerHTML = gaps.map((g) => `<li>${esc(g)}</li>`).join("");
  }

  try {
    const [deals, news, watch, scen, sd, comps] = await Promise.all([
      loadJSON("data/deals.json"),
      loadJSON("data/news.json"),
      loadJSON("data/watch.json"),
      loadJSON("data/capex_scenarios.json").catch(() => null),
      loadJSON("data/supply_demand.json").catch(() => null),
      loadJSON("data/comps_ranges.json").catch(() => null),
    ]);
    SCEN = scen;
    COMPS = comps;
    if ($("#est-note")) $("#est-note").hidden = true;
    DEAL_BY_ID = Object.fromEntries((deals.deals || []).filter((d) => d.id).map((d) => [d.id, d]));
    const ref = news.updated;
    const shownNews = renderNews(news, ref);
    renderSupplyDemand(sd);
    renderDeals(deals);
    renderLeads(deals.leads_to_verify || []);
    renderPending(deals.pending_approval || []);
    renderProjects(deals.deals || []);
    renderCompsRanges(($("#comps-scope") && $("#comps-scope").value) || "primary");
    const compsSel = $("#comps-scope");
    if (compsSel && !compsSel.dataset.bound) {
      compsSel.dataset.bound = "1";
      compsSel.addEventListener("change", () => renderCompsRanges(compsSel.value));
    }
    renderGaps(watch);
    const list = deals.deals || [];
    MODEL_DEALS = list;
    const regC = {};
    list.forEach((d) => { const r = regionOf(d); if (r) regC[r] = (regC[r] || 0) + 1; });
    const mRegion = $("#m-region");
    if (mRegion) {
      mRegion.insertAdjacentHTML("beforeend", Object.keys(regC).sort((a, b) => regC[b] - regC[a] || a.localeCompare(b, "zh-HK")).map((r) => `<option value="${esc(r)}">${esc(r)}（${regC[r]}）</option>`).join(""));
      renderModel();
      ["#m-use", "#m-region", "#m-media"].forEach((s) => $(s).addEventListener("change", renderModel));
    }
    if (!list.some((d) => has(d.beds_after) || has(d.price_per_bed_hkd_m) || has(d.all_in_per_bed_hkd_m))) {
      document.querySelector("table.deals").classList.add("no-beds");
      const bedFilter = $("#f-bed") && $("#f-bed").closest("label");
      if (bedFilter) bedFilter.hidden = true;
    }

    const byStatus = STATUS_ORDER.map((k) => [k, list.filter((d) => statusOf(d) === k).length]).filter(([, c]) => c);
    const leadsN = (deals.leads_to_verify || []).length;
    const pendN = (deals.pending_approval || []).length;
    $("#counts").textContent = `${list.length} 宗成交（${byStatus.map(([k, c]) => `${STATUS[k].t} ${c}`).join(" · ")}） · 近兩星期 ${shownNews} 則新聞`
      + (pendN ? ` · ${pendN} 宗待你批核` : "")
      + (leadsN ? ` · ${leadsN} 條待核實` : "");
    const stamp = (id, iso) => {
      const el = $(id);
      if (!el) return;
      el.textContent = iso ? fmtTs(iso) : "—";
      if (iso) el.setAttribute("datetime", iso);
    };
    stamp("#news-updated", news.updated);
    stamp("#sd-updated", sd && sd.updated);
    stamp("#deals-updated", deals.updated);
    document.documentElement.dataset.ready = "1";
  } catch (err) {
    console.error(err);
    document.documentElement.dataset.ready = "error";
    $("#buckets").innerHTML = `<p class="muted">載入失敗：${esc(err.message)}</p>`;
  }
})();
