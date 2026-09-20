from review.expected import expected_points_pct, k_for


def test_win_chance_empty_points(client):
    r = client.post("/win-chance", json={"points": []})
    assert r.status_code == 200
    assert r.json() == []


def test_win_chance_matches_expected_points_pct_directly(client):
    r = client.post("/win-chance", json={
        "white_elo": 1500, "black_elo": 1200,
        "points": [{"ply": 1, "cp_white": 80}],
    })
    assert r.status_code == 200
    assert r.json() == [
        {"ply": 1, "win_after_played": expected_points_pct(80, True, k_for(1500))}
    ]


def test_win_chance_ply_parity_selects_mover_elo(client):
    r = client.post("/win-chance", json={
        "white_elo": 1500, "black_elo": 900,
        "points": [{"ply": 1, "cp_white": 50}, {"ply": 2, "cp_white": 50}],
    })
    body = r.json()
    assert body[0]["win_after_played"] == expected_points_pct(50, True, k_for(1500))
    assert body[1]["win_after_played"] == expected_points_pct(50, False, k_for(900))


def test_win_chance_no_elo_defaults_like_unresolved_rating(client):
    r = client.post("/win-chance", json={"points": [{"ply": 1, "cp_white": 0}]})
    assert r.json() == [
        {"ply": 1, "win_after_played": expected_points_pct(0, True, k_for(None))}
    ]


def test_win_chance_mate_folds_to_signed_10000(client):
    r = client.post("/win-chance", json={
        "points": [{"ply": 1, "mate": 3}, {"ply": 2, "mate": -2}],
    })
    body = r.json()
    assert body[0]["win_after_played"] == expected_points_pct(10_000, True, k_for(None))
    assert body[1]["win_after_played"] == expected_points_pct(-10_000, False, k_for(None))


def test_win_chance_point_requires_exactly_one_score(client):
    assert client.post("/win-chance", json={"points": [{"ply": 1}]}).status_code == 422
    r = client.post(
        "/win-chance", json={"points": [{"ply": 1, "cp_white": 1, "mate": 1}]}
    )
    assert r.status_code == 422


def test_win_chance_oversized_payload_rejected(client):
    points = [{"ply": i + 1, "cp_white": 0} for i in range(601)]
    r = client.post("/win-chance", json={"points": points})
    assert r.status_code == 422
