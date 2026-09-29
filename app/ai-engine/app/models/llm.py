import time
import concurrent.futures
from langchain_ollama import ChatOllama
from app.config import AI_MODEL, RESPONSE_MODEL, DIAL_MATE_SYSTEM_PROMPT, LLM_TIMEOUT_SECONDS

# Response LLM — used by agents for generating customer-facing text
# timeout prevents indefinite hangs if Ollama is unavailable or slow
# keep_alive keeps model loaded in memory between calls for faster responses
llm = ChatOllama(
    model=RESPONSE_MODEL,
    temperature=0,
    num_predict=150,
    num_ctx=1024,
    num_thread=4,
    keep_alive="5m",
    timeout=LLM_TIMEOUT_SECONDS,
)

# Routing LLM — used ONLY by supervisor for intent classification
# Minimal num_predict (JSON is ~60 tokens), small context, JSON mode
routing_llm = ChatOllama(
    model=AI_MODEL,
    temperature=0,
    num_predict=60,
    num_ctx=512,
    num_thread=4,
    format="json",
    keep_alive="5m",
    timeout=LLM_TIMEOUT_SECONDS,
)

# Thread pool for timeout-protected LLM calls
_llm_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)


def safe_llm_invoke(messages, timeout_seconds=None):
    """
    Invoke the response LLM with timeout protection.
    Returns the response content string, or None if timed out / errored.
    """
    if timeout_seconds is None:
        timeout_seconds = LLM_TIMEOUT_SECONDS

    start = time.time()
    try:
        future = _llm_executor.submit(llm.invoke, messages)
        response = future.result(timeout=timeout_seconds)
        elapsed = time.time() - start
        print(f"[Response LLM] Completed in {elapsed:.2f}s")
        return response.content.strip()
    except concurrent.futures.TimeoutError:
        elapsed = time.time() - start
        print(f"[Response LLM] TIMEOUT after {elapsed:.2f}s (limit: {timeout_seconds}s)")
        return None
    except Exception as e:
        elapsed = time.time() - start
        print(f"[Response LLM] ERROR after {elapsed:.2f}s: {e}")
        return None


def ask_ai(message):

    system_prompt = DIAL_MATE_SYSTEM_PROMPT + """

Important:
- Never say "main bana hoon".
- Use natural Pakistani Roman Urdu.
- Do not use Hindi style grammar.
- Keep answers short.
- If asked identity questions, reply:
"Main Dial Mate AI hoon. Main customers ki madad ke liye bana hoon."
"""

    result = safe_llm_invoke([
        ("system", system_prompt),
        ("human", message)
    ])

    if result is None:
        # Fallback response when LLM is unavailable
        return "Jee, main aap ki madad ke liye hazir hoon. Aap apna sawal bata dein."

    return result
