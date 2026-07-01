"""Tools over the bundled mock Meta-ads dataset. No network calls."""
import json
import math
from pathlib import Path

from langchain_core.tools import tool

_DATA_PATH = Path(__file__).parent / "data" / "mock_ads.json"
ADS: list[dict] = json.loads(_DATA_PATH.read_text(encoding="utf-8"))

_MAX_DAYS = 420
_MAX_LOG_REACH = math.log10(2_400_000)


def _filter_ads(ads: list[dict], zone: str, query: str) -> list[dict]:
    zone_l = zone.strip().lower()
    query_l = query.strip().lower()
    out = []
    for ad in ads:
        if ad["zone"].lower() != zone_l:
            continue
        haystack = f'{ad["product"]} {ad["category"]} {ad["creative_body"]}'.lower()
        if query_l and query_l not in haystack:
            continue
        out.append(ad)
    return sorted(out, key=lambda a: a["days_running"], reverse=True)


def _score_products(ads: list[dict], product_names: list[str], zone: str) -> list[dict]:
    """Score 0-100: 60% longevity (days_running), 40% reach (log-scaled).

    Longevity dominates because sustained spend is the strongest public
    signal an ad is profitable — same rubric as the production design.
    """
    wanted = {p.strip().lower() for p in product_names}
    zone_l = zone.strip().lower()
    ranked = []
    for name in wanted:
        matches = [a for a in ads
                   if a["zone"].lower() == zone_l and name in a["product"].lower()]
        if not matches:
            ranked.append({"product": name, "score": 0, "verdict": "no ads found in zone",
                           "evidence": []})
            continue
        best = max(matches, key=lambda a: a["days_running"])
        longevity = min(best["days_running"] / _MAX_DAYS, 1.0)
        reach = min(math.log10(max(best["eu_total_reach"], 1)) / _MAX_LOG_REACH, 1.0)
        ranked.append({
            "product": best["product"],
            "score": round((0.6 * longevity + 0.4 * reach) * 100),
            "verdict": f'{best["days_running"]} days running, reach {best["eu_total_reach"]:,}',
            "evidence": [{"ad_id": a.get("ad_id"), "days_running": a["days_running"],
                          "eu_total_reach": a["eu_total_reach"],
                          "advertiser": a.get("advertiser")} for a in matches],
        })
    return sorted(ranked, key=lambda r: r["score"], reverse=True)


@tool
def search_ads(zone: str, query: str) -> str:
    """Search the ad archive for a zone. `query` matches product, category or
    creative text; pass "" to list everything in the zone. Returns JSON."""
    return json.dumps(_filter_ads(ADS, zone, query), ensure_ascii=False)


@tool
def compare_products(product_names: list[str], zone: str) -> str:
    """Score candidate products in a zone by ad longevity (60%) and reach (40%).
    Returns a JSON ranking with per-product evidence."""
    return json.dumps(_score_products(ADS, product_names, zone), ensure_ascii=False)
