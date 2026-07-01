import json
from agent.tools import _filter_ads, _score_products, search_ads, ADS


def test_dataset_loads_40_ads():
    assert len(ADS) == 40
    required = {"ad_id", "zone", "product", "category", "days_running",
                "eu_total_reach", "gender_target", "advertiser", "creative_body"}
    assert all(required <= set(ad) for ad in ADS)


def test_filter_by_zone_only_returns_that_zone():
    result = _filter_ads(ADS, zone="Berlin", query="")
    assert result, "Berlin should have ads"
    assert all(ad["zone"] == "Berlin" for ad in result)


def test_filter_query_matches_product_category_and_creative():
    result = _filter_ads(ADS, zone="Berlin", query="fitness")
    assert result
    assert all(
        "fitness" in (ad["product"] + " " + ad["category"] + " " + ad["creative_body"]).lower()
        for ad in result
    )


def test_filter_unknown_zone_returns_empty():
    assert _filter_ads(ADS, zone="Atlantis", query="") == []


def test_score_products_ranks_longevity_and_reach():
    ads = [
        {"product": "A", "zone": "Berlin", "days_running": 300, "eu_total_reach": 2_000_000},
        {"product": "B", "zone": "Berlin", "days_running": 10, "eu_total_reach": 9_000},
    ]
    ranked = _score_products(ads, ["A", "B"], zone="Berlin")
    assert ranked[0]["product"] == "A"
    assert ranked[0]["score"] > ranked[1]["score"]
    assert 0 <= ranked[1]["score"] <= ranked[0]["score"] <= 100


def test_search_ads_tool_returns_json_string():
    out = search_ads.invoke({"zone": "Berlin", "query": "fitness"})
    parsed = json.loads(out)
    assert isinstance(parsed, list)
