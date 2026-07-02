from agent.router import decide_next


def _state(search_results=None, scores=None, report_done=False):
    return {
        "messages": [],
        "search_results": search_results,
        "scores": scores,
        "report_done": report_done,
    }


def test_routes_to_scout_when_no_search_results():
    assert decide_next(_state()) == "market_scout"


def test_routes_to_analyst_when_results_but_no_scores():
    assert decide_next(_state(search_results=[{"ad_id": "ad_0001"}])) == "scoring_analyst"


def test_routes_to_writer_when_scores_present():
    assert decide_next(
        _state(search_results=[{"ad_id": "ad_0001"}], scores=[{"product": "A", "score": 80}])
    ) == "report_writer"


def test_routes_to_end_when_report_done():
    assert decide_next(
        _state(
            search_results=[{"ad_id": "ad_0001"}],
            scores=[{"product": "A", "score": 80}],
            report_done=True,
        )
    ) == "end"
