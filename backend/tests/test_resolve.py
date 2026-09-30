from app.tools.resolve import normalize, resolve_district, resolve_facility


def test_normalize_punctuation_numbers_and_aliases():
    assert normalize("PHC Kota-4") == "phc kota 4"
    assert normalize("kota_phc_4") == "kota phc 4"
    assert normalize("Kota ka PHC chaar") == "kota phc 4"
    assert normalize("rural fourteen") == "rural 14"
    assert normalize("PHC सेक्टर बारह") == "phc sector 12"
    assert normalize("पीएचसी कोटा ४") == "phc kota 4"
    assert normalize("Kota district") == "kota"


def test_resolve_district_variants():
    assert resolve_district("कोटा") == "district_kota"
    assert resolve_district("Kota") == "district_kota"
    assert resolve_district("kota district") == "district_kota"
    assert resolve_district("jaipur") == "district_jaipur_rural"
    assert resolve_district("Jaipur Gramin") == "district_jaipur_rural"
    assert resolve_district("district_alwar") == "district_alwar"
    assert resolve_district("bikaner") == "district_bikaner"
    assert resolve_district("xyzzy plugh") is None
    assert resolve_district("") is None


def test_resolve_facility_spoken_names():
    assert resolve_facility("Kota ka PHC 4").best.id == "kota_phc_4"
    assert resolve_facility("Kota ka PHC chaar").best.id == "kota_phc_4"
    assert resolve_facility("rural fourteen").best.id == "phc_18"
    assert resolve_facility("PHC सेक्टर बारह").best.id == "phc_12"
    assert resolve_facility("CHC East").best.id == "chc_east"
    assert resolve_facility("kota_phc_4").best.id == "kota_phc_4"


def test_resolve_facility_ambiguous_returns_several():
    res = resolve_facility("Kota")
    assert res.ambiguous
    assert len(res.matches) > 1
    assert all(m.district_id == "district_kota" for m in res.matches)


def test_resolve_facility_unambiguous_is_not_flagged():
    res = resolve_facility("PHC Kota-4")
    assert res.best.id == "kota_phc_4"
    assert not res.ambiguous


def test_resolve_facility_restricts_to_district():
    res = resolve_facility("PHC 4", district="Alwar")
    assert res.best.id == "alwar_phc_4"
    assert all(m.district_id == "district_alwar" for m in res.matches)


def test_resolve_facility_no_match():
    assert resolve_facility("zzzz qqqq").matches == []
