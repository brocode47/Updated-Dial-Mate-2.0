"""
DialMate LLM Routing Benchmark
Tests all available Ollama models for:
- First token latency (via streaming)
- Total response time
- JSON validity
- Output correctness (agent routing)
"""
import time
import json
import requests

OLLAMA_URL = "http://localhost:11434"

MODELS = [
    "qwen2.5:1.5b",
    "qwen2.5:3b",
    "llama3.2:3b",
]

# Compact supervisor prompt — the one we actually send
SYSTEM_PROMPT = """You are an intent routing supervisor. Your ONLY job is to classify the customer's intent into a JSON object.
Allowed agents: product_agent, order_agent, delivery_agent, support_agent.
Return ONLY valid JSON. No markdown. No explanation.
Example: {"agent":"product_agent","intent":"product_recommendation","action":"product_search","priority":"normal"}"""

TEST_CASES = [
    {
        "message": "Mujhe wife ke liye gift chahiye",
        "expected_agent": "product_agent",
    },
    {
        "message": "Mera order kahan hai",
        "expected_agent": "order_agent",
    },
    {
        "message": "Delivery kab tak ayegi",
        "expected_agent": "delivery_agent",
    },
    {
        "message": "Tumhara boss kon hai",
        "expected_agent": "support_agent",
    },
]


def benchmark_model_streaming(model, message):
    """Use Ollama /api/chat with streaming to measure first-token and total latency."""
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": message},
        ],
        "stream": True,
        "options": {
            "temperature": 0,
            "num_predict": 60,
            "num_ctx": 512,
        },
        "format": "json",
    }

    start = time.time()
    first_token_time = None
    full_response = ""

    try:
        resp = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, stream=True, timeout=60)
        for line in resp.iter_lines():
            if line:
                chunk = json.loads(line)
                token = chunk.get("message", {}).get("content", "")
                if token and first_token_time is None:
                    first_token_time = time.time() - start
                full_response += token
                if chunk.get("done"):
                    break
    except Exception as e:
        return {
            "error": str(e),
            "first_token_s": None,
            "total_s": time.time() - start,
            "response": "",
            "valid_json": False,
            "correct_agent": False,
        }

    total_time = time.time() - start

    # Validate JSON
    valid_json = False
    parsed = {}
    clean = full_response.strip()
    try:
        parsed = json.loads(clean)
        valid_json = True
    except json.JSONDecodeError:
        pass

    return {
        "first_token_s": round(first_token_time, 2) if first_token_time else None,
        "total_s": round(total_time, 2),
        "response": clean[:200],
        "valid_json": valid_json,
        "parsed": parsed,
    }


def benchmark_model_non_streaming(model, message):
    """Use Ollama /api/chat without streaming for comparison."""
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": message},
        ],
        "stream": False,
        "options": {
            "temperature": 0,
            "num_predict": 60,
            "num_ctx": 512,
        },
        "format": "json",
    }
    start = time.time()
    try:
        resp = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=60)
        data = resp.json()
        total_time = time.time() - start
        content = data.get("message", {}).get("content", "").strip()
        valid_json = False
        parsed = {}
        try:
            parsed = json.loads(content)
            valid_json = True
        except json.JSONDecodeError:
            pass
        return {
            "total_s": round(total_time, 2),
            "response": content[:200],
            "valid_json": valid_json,
            "parsed": parsed,
        }
    except Exception as e:
        return {
            "error": str(e),
            "total_s": round(time.time() - start, 2),
            "response": "",
            "valid_json": False,
        }


def run_benchmark():
    # Check which models are available
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        available = [m["name"] for m in resp.json().get("models", [])]
        print(f"Available models: {available}\n")
    except Exception:
        print("ERROR: Cannot connect to Ollama. Is it running?")
        return

    models_to_test = [m for m in MODELS if m in available]
    if not models_to_test:
        print(f"None of {MODELS} found in available models: {available}")
        return

    print("=" * 80)
    print("BENCHMARK: Streaming mode with format=json, num_predict=60, num_ctx=512")
    print("=" * 80)

    results = {}

    for model in models_to_test:
        print(f"\n--- Model: {model} ---")
        model_results = []
        for tc in TEST_CASES:
            msg = tc["message"]
            expected = tc["expected_agent"]
            r = benchmark_model_streaming(model, msg)
            correct = r.get("parsed", {}).get("agent") == expected
            r["correct_agent"] = correct
            model_results.append(r)
            status = "✅" if (r["valid_json"] and correct) else "❌"
            print(f"  {status} \"{msg[:40]}\"")
            print(f"     First token: {r['first_token_s']}s | Total: {r['total_s']}s | JSON: {r['valid_json']} | Agent: {r.get('parsed',{}).get('agent','?')} (expected: {expected})")

        avg_total = sum(r["total_s"] for r in model_results) / len(model_results)
        avg_first = sum(r["first_token_s"] for r in model_results if r["first_token_s"]) / max(1, sum(1 for r in model_results if r["first_token_s"]))
        json_rate = sum(1 for r in model_results if r["valid_json"]) / len(model_results) * 100
        correct_rate = sum(1 for r in model_results if r.get("correct_agent")) / len(model_results) * 100

        results[model] = {
            "avg_total_s": round(avg_total, 2),
            "avg_first_token_s": round(avg_first, 2),
            "json_valid_pct": json_rate,
            "correct_pct": correct_rate,
        }

    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"{'Model':<25} {'Avg Total(s)':<15} {'Avg 1st Token(s)':<18} {'JSON Valid %':<15} {'Correct %':<12}")
    print("-" * 85)
    for model, r in results.items():
        print(f"{model:<25} {r['avg_total_s']:<15} {r['avg_first_token_s']:<18} {r['json_valid_pct']:<15} {r['correct_pct']:<12}")

    # Recommend
    best = min(results.items(), key=lambda x: x[1]["avg_total_s"] if x[1]["correct_pct"] >= 75 else 999)
    print(f"\n🏆 RECOMMENDED: {best[0]} (avg {best[1]['avg_total_s']}s, {best[1]['correct_pct']}% correct)")


if __name__ == "__main__":
    run_benchmark()
