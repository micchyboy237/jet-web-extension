import fnmatch
import os
from collections import defaultdict
from typing import Any, Dict, Generator, List, Optional
from urllib.parse import urljoin, urlsplit

import requests
from bs4 import BeautifulSoup
from fastapi import Body, FastAPI
from fastapi.responses import StreamingResponse
from jet.logger import logger
from openai import OpenAI
from pydantic import BaseModel, Field
from unstructured.partition.html import partition_html

app = FastAPI(title="Summarizer Server")

LLM_BASE_URL = os.getenv("LLAMA_CPP_LLM_URL", "http://localhost:1234/v1")
MODEL_NAME = os.getenv("LLAMA_CPP_LLM_HF_MODEL", "Qwen/Qwen3-4B-Instruct-2507")
client = OpenAI(base_url=LLM_BASE_URL, api_key="sk-1234")

# ── unchanged summarization constants and prompts ──
SYSTEM_PROMPT = """You are an expert web page summarizer.
Create concise, objective, and well-structured summaries.
- Focus on main topic, key arguments, facts, and conclusions.
- Use bullet points for lists of key points when appropriate.
- Maintain neutrality and accuracy.
- Target 300-600 words or shorter if content is simple.
Start directly with the summary."""

USER_PROMPT_TEMPLATE = """Webpage content:
{content}
Provide the structured summary."""

CHUNK_SIZE_CHARS = 12000
MAX_CHUNKS = 8

# ── Link extraction models ────────────────────────────────────────


class LinkItem(BaseModel):
    text: str
    href: str


class LinkGroup(BaseModel):
    context: str
    links: List[LinkItem]


class LinkExtractRequest(BaseModel):
    # url is always required; html is optional, used only if provided
    url: str = Field(
        ...,
        description="The page URL - always required. Used as base for internal/external logic and relative link resolution",
    )
    html: Optional[str] = Field(
        None, description="If provided, use this HTML instead of fetching from url"
    )

    include_external: bool = False
    include_patterns: Optional[List[str]] = None
    exclude_patterns: Optional[List[str]] = None

    include_selectors: Optional[List[str]] = Field(
        None,
        description="CSS selectors; keep <a> if descendant of (or is) element matching any of these",
    )
    exclude_selectors: Optional[List[str]] = Field(
        None,
        description="CSS selectors; discard <a> if descendant of (or is) element matching any of these",
    )


def is_internal_link(href: str, base_url: str) -> bool:
    if not href:
        return True
    href = href.strip()
    if href.startswith(("#", "javascript:", "data:", "about:", "mailto:", "tel:")):
        return True
    parsed_href = urlsplit(href)
    parsed_base = urlsplit(base_url)
    scheme_ok = parsed_href.scheme in ("", "http", "https")
    netloc_ok = parsed_href.netloc in ("", parsed_base.netloc)
    return scheme_ok and netloc_ok


def extract_grouped_links(request: LinkExtractRequest) -> List[LinkGroup]:
    # ── Determine HTML source and base_url ──────────────
    mode = "html (provided)" if request.html else "fetch from url"
    base_url = request.url.rstrip("/")
    try:
        if request.html:
            html = request.html.strip()
            if not html:
                logger.warning("Provided html is empty")
                return [LinkGroup(context="No content", links=[])]
        else:
            resp = requests.get(
                request.url,
                timeout=15,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                },
                allow_redirects=True,
            )
            resp.raise_for_status()
            html = resp.text
    except requests.RequestException as e:
        logger.warning(
            f"Failed to fetch page {request.url}: {type(e).__name__} - {str(e)}"
        )
        return [LinkGroup(context="Page fetch failed", links=[])]

    logger.info(f"Extracting links in {mode} mode (base: {base_url[:80]}...)")

    # ── Parse with BeautifulSoup ───────────────────────────────────
    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception as e:
        logger.error(
            f"BeautifulSoup parse failed: {type(e).__name__} {str(e)}", exc_info=True
        )
        return [LinkGroup(context="Parse error", links=[])]

    # ── Compute allowed <a> tags using container selectors ────────
    allowed_a_tags: set = set()

    if request.include_selectors:
        for raw_sel in request.include_selectors:
            sel = raw_sel.strip()
            if not sel:
                continue
            try:
                for a_tag in soup.select(f"{sel} a"):
                    allowed_a_tags.add(a_tag)
            except Exception as e:
                logger.warning(f"Invalid include selector '{sel}': {e}")
    else:
        # If no include selectors → all <a> are candidates initially
        for a_tag in soup.find_all("a"):
            allowed_a_tags.add(a_tag)

    if request.exclude_selectors:
        for raw_sel in request.exclude_selectors:
            sel = raw_sel.strip()
            if not sel:
                continue
            try:
                for a_tag in soup.select(f"{sel} a"):
                    allowed_a_tags.discard(a_tag)
            except Exception as e:
                logger.warning(f"Invalid exclude selector '{sel}': {e}")

    # ── Grouping logic ─────────────────────────────────────────────
    groups: Dict[str, List[Dict[str, str]]] = defaultdict(list)
    current_section = "Uncategorized"

    for elem in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "a"]):
        if elem.name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            text = elem.get_text(strip=True)
            if text:
                current_section = text
        elif elem.name == "a":
            href_raw = elem.get("href", "").strip()
            if not href_raw:
                continue
            full_href = urljoin(base_url, href_raw)
            link_text = elem.get_text(strip=True) or full_href[:80] + (
                "..." if len(full_href) > 80 else ""
            )

            # Existing URL filters
            if not request.include_external and not is_internal_link(
                full_href, base_url
            ):
                continue
            if request.include_patterns and not any(
                fnmatch.fnmatch(full_href, p) for p in request.include_patterns
            ):
                continue
            if request.exclude_patterns and any(
                fnmatch.fnmatch(full_href, p) for p in request.exclude_patterns
            ):
                continue

            # New container selector filter
            if elem not in allowed_a_tags:
                continue

            groups[current_section].append({"text": link_text, "href": full_href})
            # Reset to Uncategorized after adding link under a specific heading
            # (prevents footer links piling under last heading)
            current_section = "Uncategorized"

    if not groups:
        return [LinkGroup(context="No matching links found", links=[])]

    return [
        LinkGroup(context=context, links=[LinkItem(**link) for link in links])
        for context, links in groups.items()
    ]


# ── Summarization endpoints unchanged ─────────────────────────────


class SummarizeRequest(BaseModel):
    html: str


def clean_html(html: str) -> str:
    if not html or not html.strip():
        return ""
    try:
        elements = partition_html(text=html)
        relevant = {"Title", "NarrativeText", "ListItem", "Heading"}
        text_parts: List[str] = []
        for el in elements:
            text = str(el).strip()
            if text and (not hasattr(el, "category") or el.category in relevant):
                text_parts.append(text)
        clean_text = "\n\n".join(text_parts)
        logger.debug(f"Cleaned to {len(clean_text)} chars")
        return clean_text
    except Exception as e:
        logger.warning(f"HTML partition failed: {e}. Fallback truncate.")
        return html[:50000]


def get_text_chunks(text: str) -> List[str]:
    if not text:
        return []
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: List[str] = []
    current = ""
    for p in paragraphs:
        if len(current) + len(p) + 2 > CHUNK_SIZE_CHARS and current:
            chunks.append(current.strip())
            current = p
            if len(chunks) >= MAX_CHUNKS - 1:
                break
        else:
            current += ("\n\n" if current else "") + p
        # Force split if current gets too large even without next p
        if len(current) > CHUNK_SIZE_CHARS:
            chunks.append(current[:CHUNK_SIZE_CHARS].strip())
            current = current[CHUNK_SIZE_CHARS:]
    if current:
        chunks.append(current.strip())
    logger.info(f"Split into {len(chunks)} chunks")
    return chunks


def build_messages(
    content: str, is_final_synthesis: bool = False
) -> List[Dict[str, str]]:
    if is_final_synthesis:
        user_content = f"""Synthesize a single coherent final summary from these section summaries without losing key information:
{content}"""
    else:
        user_content = USER_PROMPT_TEMPLATE.format(content=content)
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


def generate_stream(messages: List[Dict[str, str]]) -> Generator[str, None, None]:
    try:
        stream: Any = client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages,
            stream=True,
            temperature=0.3,
            top_p=0.9,
            max_tokens=2500,
            stream_options={"include_usage": True},
        )
        for part in stream:
            if part.choices:
                content = part.choices[0].delta.content or ""
                if content:
                    yield content
            if hasattr(part, "usage") and part.usage:
                logger.info(f"Usage → {part.usage}")
    except Exception as e:
        logger.error(f"Stream error: {e}")
        yield f"\n[Error: {str(e)}]"


@app.post("/summarize")
async def summarize(request: SummarizeRequest):
    logger.info("Received summarization request")
    clean_text = clean_html(request.html)
    if len(clean_text) < CHUNK_SIZE_CHARS * 0.8:
        logger.info("Direct summarization")
        messages = build_messages(clean_text)
    else:
        logger.info("Hierarchical summarization (large content)")
        chunks = get_text_chunks(clean_text)
        chunk_summaries: List[str] = []
        for i, chunk in enumerate(chunks):
            logger.info(f"Chunk {i + 1}/{len(chunks)}")
            chunk_msgs = build_messages(chunk)
            resp = client.chat.completions.create(
                model=MODEL_NAME,
                messages=chunk_msgs,
                temperature=0.3,
                max_tokens=800,
                stream=False,
            )
            summary = resp.choices[0].message.content or ""
            chunk_summaries.append(f"**Section {i + 1}:**\n{summary}")
        combined = "\n\n---\n\n".join(chunk_summaries)
        messages = build_messages(combined, is_final_synthesis=True)

    return StreamingResponse(
        generate_stream(messages),
        media_type="text/plain",
        headers={"Cache-Control": "no-cache"},
    )


# ── Single unified endpoint ───────────────────────────────────────


@app.post("/extract-grouped-links", response_model=List[LinkGroup])
async def extract_grouped_links_endpoint(request: LinkExtractRequest = Body(...)):
    """
    Extract grouped links from a webpage.
    • url is always required (used for origin comparison and relative href resolution)
    • html is optional — if given, use it instead of fetching
    """
    # Remove broad catch → let FastAPI/Pydantic handle validation errors (422)
    result = extract_grouped_links(request)

    # Safe count even if result is weird
    total_links = 0
    group_count = 0
    try:
        total_links = sum(len(g.links) for g in result)
        group_count = len(result)
    except Exception as count_err:
        logger.warning(f"Could not count links/groups: {count_err}")

    logger.debug(f"Extracted {total_links} links in {group_count} groups")
    return result


def normalize_url_for_pattern(full_href: str) -> str:
    """Remove scheme and netloc so fnmatch works on path-like patterns"""
    from urllib.parse import urlsplit

    parsed = urlsplit(full_href)
    path_query = parsed.path
    if parsed.query:
        path_query += "?" + parsed.query
    return path_query.lstrip("/")


if __name__ == "__main__":
    import uvicorn

    logger.info("Starting summarizer server on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
