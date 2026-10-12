#!/usr/bin/env python3
"""Append public headlines to data/news.json. Never edits data/deals.json."""
from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEWS = ROOT / "data" / "news.json"
HKT = timezone(timedelta(hours=8))
KEYWORDS = ("學生宿舍", "學生公寓", "學生住宿", "PBSA", "城中學舍", "學舍", "宿位")
QUERY = "香港 (學生宿舍 OR 學生公寓 OR 學生住宿 OR PBSA OR 城中學舍)"
FEED = (
    "https://news.google.com/rss/search?q="
    + urllib.parse.quote(QUERY)
    + "&hl=zh-HK&gl=HK&ceid=HK:zh-Hant"
)



MARKERS = (
    "KASA", "世邦魏理仕", "聯僑廣場", "宜必思", "仁和大廈", "勝捷",
    "城中學舍", "7.8萬", "78萬", "一步居", "日新舍",
)

def _same_story(key: str, seen: set[str]) -> bool:
    marks = [m for m in MARKERS if m in key]
    for old in seen:
        if key[:16] and (key[:16] in old or old[:16] in key):
            return True
        if marks and any(m in old for m in marks):
            return True
    return False

def norm(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def strip_html(raw: str) -> str:
    text = re.sub(r"<[^>]+>", " ", raw or "")
    text = unescape(re.sub(r"\s+", " ", text)).strip()
    return text[:400]


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch_items() -> list[dict]:
    req = urllib.request.Request(FEED, headers={"User-Agent": "hk-pbsa-daily/1.0"})
    with urllib.request.urlopen(req, timeout=30) as res:
        xml = res.read()
    root = ET.fromstring(xml)
    found = []
    cutoff = (datetime.now(HKT) - timedelta(days=14)).date()
    for node in root.findall("./channel/item"):
        raw_title = (node.findtext("title") or "").strip()
        link = (node.findtext("link") or "").strip()
        if not raw_title or not link:
            continue
        headline, sep, tail = raw_title.rpartition(" - ")
        title = headline.strip() if sep else raw_title
        source = tail.strip() if sep else "Google 新聞"
        blob = title + (node.findtext("description") or "")
        if not any(k.lower() in blob.lower() for k in KEYWORDS):
            continue
        if any(x in title for x in ("汪敦敬", "樓·言板", "樓・言板", "校長Talk", "評論")):
            continue
        try:
            published = parsedate_to_datetime(node.findtext("pubDate") or "").astimezone(HKT)
        except (TypeError, ValueError, IndexError):
            continue
        if published.date() < cutoff:
            continue
        found.append(
            {
                "date": published.strftime("%Y-%m-%d"),
                "date_label": f"{published.year}年{published.month}月{published.day}日",
                "title": title,
                "summary": "自動收錄標題，開連結核對原文。成交金額未核實前不會寫入成交表。",
                "source": source,
                "url": link,
                "source_date": published.strftime("%Y-%m-%d"),
                "source_date_label": f"{source} {published.strftime('%Y-%m-%d')}",
                "auto": True,
            }
        )
    return found


def main() -> int:
    news = load(NEWS)
    items = news.get("items") or []
    seen_titles = {norm(i.get("title") or "") for i in items}
    seen_urls = {i.get("url") for i in items if i.get("url")}
    try:
        incoming = fetch_items()
    except Exception as exc:  # network or parse failure should not fail the deploy
        print(f"fetch skipped: {exc}")
        return 0
    added = []
    for entry in incoming:
        key = norm(entry["title"])
        if not key or key in seen_titles or entry["url"] in seen_urls:
            continue
        if _same_story(key, seen_titles):
            continue
        added.append(entry)
        seen_titles.add(key)
        seen_urls.add(entry["url"])
    if not added:
        print("no new items")
        return 0
    now = datetime.now(HKT).strftime("%Y-%m-%dT%H:%M:%S+08:00")
    news["items"] = added + items
    news["updated"] = now
    save(NEWS, news)
    print(f"added {len(added)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
