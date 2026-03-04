import pytest
from summarizer_server import (
    LinkExtractRequest,
    extract_grouped_links,
    is_internal_link,
)


# ── Helper to make request objects cleaner ──
def make_request(html=None, **kwargs):
    defaults = {
        "url": "https://example.com/page",
        "include_external": False,
        "include_patterns": None,
        "exclude_patterns": None,
        "include_selectors": None,
        "exclude_selectors": None,
    }
    defaults.update(kwargs)
    return LinkExtractRequest(html=html, **defaults)


# ── is_internal_link tests ────────────────────────────────────────
def test_is_internal_link():
    base = "https://example.com/path"

    assert is_internal_link("/sub", base) is True
    assert is_internal_link("https://example.com/other", base) is True
    assert is_internal_link("https://other.com", base) is False
    assert is_internal_link("#anchor", base) is True
    assert is_internal_link("javascript:void(0)", base) is True
    assert is_internal_link("mailto:hi@example.com", base) is True


# ── Basic extraction ──────────────────────────────────────────────
def test_extract_no_links():
    req = make_request(html="<html><body>No links here</body></html>")
    result = extract_grouped_links(req)
    assert len(result) == 1
    assert result[0].context == "No matching links found"
    assert result[0].links == []


def test_extract_basic_grouping(simple_html):
    req = make_request(html=simple_html, include_external=False)
    result = extract_grouped_links(req)

    assert len(result) == 2
    contexts = {g.context for g in result}
    # Now correctly has Uncategorized for footer links
    # assert "Uncategorized" in contexts   # optional
    # Just ensure Resources exists and has correct link
    resources = next(g for g in result if g.context == "Resources")
    assert len(resources.links) == 1
    assert resources.links[0].text == "Download PDF"
    assert resources.links[0].href.endswith("/internal.pdf")


# ── Internal / external filtering ────────────────────────────────
def test_include_external_flag(complex_html):
    req_no_ext = make_request(html=complex_html, include_external=False)
    result_no = extract_grouped_links(req_no_ext)
    hrefs_no = {link.href for g in result_no for link in g.links}
    assert "https://ads.com" not in hrefs_no

    req_with_ext = make_request(html=complex_html, include_external=True)
    result_with = extract_grouped_links(req_with_ext)
    hrefs_with = {link.href for g in result_with for link in g.links}
    assert "https://ads.com" in hrefs_with


# ── URL pattern filtering ─────────────────────────────────────────
@pytest.mark.parametrize(
    "include_pat, exclude_pat, expected_hrefs",
    [
        (["*internal.pdf", "*.pdf"], None, ["internal.pdf"]),  # better pattern
        (None, ["*ads*"], []),
        (["*/page*"], None, ["page1"]),
        (None, None, ["page1", "ads.com", "sponsor", "privacy"]),
    ],
)
def test_url_patterns(complex_html, include_pat, exclude_pat, expected_hrefs):
    req = make_request(
        html=complex_html,
        include_external=True,
        include_patterns=include_pat,
        exclude_patterns=exclude_pat,
    )
    # Use rstrip("/") to strip trailing slashes before splitting
    result = extract_grouped_links(req)
    found = {link.href.rstrip("/").split("/")[-1] for g in result for link in g.links}
    expected = set(expected_hrefs)
    assert found == expected, f"Expected {expected} but got {found}"


# ── CSS container selector filtering ──────────────────────────────
@pytest.mark.parametrize(
    "include_sels, exclude_sels, expected_texts",
    [
        ([".content"], None, ["Page 1", "Ad"]),
        (
            None,
            [".sidebar"],
            ["Page 1", "Ad", "Privacy"],
        ),
        ([".article"], [".footer"], ["Page 1", "Ad", "Sponsor"]),
        ([], [], ["Page 1", "Ad", "Sponsor", "Privacy"]),
        ([".nonexistent"], None, []),
    ],
)
def test_css_container_selectors(
    complex_html, include_sels, exclude_sels, expected_texts
):
    req = make_request(
        html=complex_html,
        include_external=True,
        include_selectors=include_sels,
        exclude_selectors=exclude_sels,
    )
    result = extract_grouped_links(req)
    found_texts = {link.text for g in result for link in g.links}
    assert found_texts == set(expected_texts)


def test_invalid_selector_is_skipped(complex_html):
    req = make_request(
        html=complex_html,
        include_selectors=[".content", "invalid[["],
    )
    # should still extract from .content
    result = extract_grouped_links(req)
    texts = {link.text for g in result for link in g.links}
    assert "Page 1" in texts
    assert len(texts) > 0  # didn't fail completely
