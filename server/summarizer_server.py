import os
from typing import Any, Dict, Generator, List

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from jet.logger import logger
from openai import OpenAI
from pydantic import BaseModel
from unstructured.partition.html import partition_html

app = FastAPI(title="Summarizer Server")

LLM_BASE_URL = os.getenv("LLAMA_CPP_LLM_URL", "http://localhost:1234/v1")
MODEL_NAME = os.getenv("LLAMA_CPP_LLM_HF_MODEL", "Qwen/Qwen3-4B-Instruct-2507")
client = OpenAI(base_url=LLM_BASE_URL, api_key="sk-1234")

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


class SummarizeRequest(BaseModel):
    html: str


def clean_html(html: str) -> str:
    """
    Extract clean, relevant text from HTML using unstructured for proper LLM context.
    """
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
    """
    Split into paragraph-based chunks (semantic, no mid-sentence cuts).
    """
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
    if current:
        chunks.append(current.strip())
    logger.info(f"Split into {len(chunks)} chunks")
    return chunks


def build_messages(
    content: str, is_final_synthesis: bool = False
) -> List[Dict[str, str]]:
    """
    Build chat messages (reusable).
    """
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
    """
    Yield LLM delta chunks (matches chat-stream.py pattern).
    """
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
    """
    Main streaming endpoint.
    """
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


if __name__ == "__main__":
    import uvicorn

    logger.info("Starting summarizer server on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
