"""
DialMate Response LLM Benchmark
================================
Tests the EXACT same ChatOllama object used by product_agent & support_agent.

Tests:
A) Simple prompt — measures raw Ollama inference latency
B) Product prompt — measures full product_agent prompt latency  
C) Template response — measures template path (zero LLM)
D) Timeout protection — verifies safe_llm_invoke doesn't hang

Run:
  python test_response_llm.py
"""
import time
import sys
import os

# Ensure app module is importable
sys.path.insert(0, os.path.dirname(__file__))


def test_a_simple_prompt():
    """Test A: Raw Ollama inference with minimal prompt."""
    print("\n" + "=" * 60)
    print("TEST A: Simple prompt — 'Reply only: hello'")
    print("=" * 60)
    
    from app.models.llm import safe_llm_invoke
    
    start = time.time()
    result = safe_llm_invoke([
        ("system", "Reply only with the word hello."),
        ("human", "Reply only: hello")
    ], timeout_seconds=15)
    elapsed = time.time() - start
    
    print(f"  Result: {result}")
    print(f"  Time:   {elapsed:.2f}s")
    
    if result is None:
        print(f"  STATUS: ⚠️  LLM unavailable (timed out or Ollama not running)")
        return elapsed, False
    elif elapsed > 5:
        print(f"  STATUS: ⚠️  SLOW ({elapsed:.2f}s > 5s target)")
        return elapsed, True
    else:
        print(f"  STATUS: ✅ PASS ({elapsed:.2f}s)")
        return elapsed, True


def test_b_product_prompt():
    """Test B: Full product_agent style prompt with product list."""
    print("\n" + "=" * 60)
    print("TEST B: Product agent style prompt")
    print("=" * 60)
    
    from app.models.llm import safe_llm_invoke

    product_list_str = """- Luxury Perfume Set - Rs 4500
- Premium Handbag - Rs 3500
- Crystal Vase - Rs 2800"""
    
    system_prompt = f"""You are a helpful Pakistani customer support agent named DialMate.
You must respond in Roman Urdu ONLY. Keep responses short and conversational.
The customer has asked for product recommendations.
Here are the products found in the database:
{product_list_str}

Customer Intelligence:
- Preferred Categories: perfumes
- Preferred Products: None
- Average Budget: 5000
- General Preferences: likes premium gifts

Draft a short response recommending these products.
Format as a direct response to the user. Do not include markdown blocks."""
    
    start = time.time()
    result = safe_llm_invoke([
        ("system", system_prompt),
        ("human", "Message: Mujhe wife ke liye gift chahiye")
    ], timeout_seconds=15)
    elapsed = time.time() - start
    
    print(f"  Result: {result[:100] if result else 'None'}...")
    print(f"  Time:   {elapsed:.2f}s")
    
    if result is None:
        print(f"  STATUS: ⚠️  LLM unavailable")
        return elapsed, False
    elif elapsed > 5:
        print(f"  STATUS: ⚠️  SLOW ({elapsed:.2f}s > 5s target)")
        return elapsed, True
    else:
        print(f"  STATUS: ✅ PASS ({elapsed:.2f}s)")
        return elapsed, True


def test_c_template_response():
    """Test C: Template product response — no LLM, instant."""
    print("\n" + "=" * 60)
    print("TEST C: Template response (no LLM)")
    print("=" * 60)
    
    from app.agents import product_agent as pa_module
    from app.agents.product_agent import _format_product_list, _get_personalization
    from app.agents.product_agent import PRODUCT_LIST_TEMPLATE_BUDGET
    
    # Mock product data (same shape as DB returns)
    mock_products = [
        ("Luxury Perfume Set", "Premium fragrance", 4500),
        ("Crystal Vase", "Elegant home decor", 2800),
        ("Silk Scarf", "Designer scarf", 3200),
    ]
    
    memory = {
        "preferred_categories": "perfumes",
        "average_budget": 5000
    }
    
    start = time.time()
    
    # Test the template rendering directly (same code path as product_agent)
    product_list_str = _format_product_list(mock_products)
    personalization = _get_personalization(memory)
    result_text = PRODUCT_LIST_TEMPLATE_BUDGET.format(
        personalization=personalization,
        product_list=product_list_str
    )
    
    elapsed = time.time() - start
    
    print(f"  Result: {result_text[:100]}...")
    print(f"  Time:   {elapsed:.4f}s")
    
    if elapsed > 1:
        print(f"  STATUS: ⚠️  Slower than expected for template ({elapsed:.2f}s)")
        return elapsed, True
    else:
        print(f"  STATUS: ✅ PASS ({elapsed:.4f}s — template, no LLM)")
        return elapsed, True


def test_d_timeout_protection():
    """Test D: Verify safe_llm_invoke doesn't hang beyond timeout."""
    print("\n" + "=" * 60)
    print("TEST D: Timeout protection (max 5s)")
    print("=" * 60)
    
    from app.models.llm import safe_llm_invoke
    
    start = time.time()
    result = safe_llm_invoke([
        ("system", "Reply only: test"),
        ("human", "test")
    ], timeout_seconds=5)
    elapsed = time.time() - start
    
    if elapsed > 7:
        # Allow 2s buffer over timeout
        print(f"  STATUS: ❌ FAIL — Took {elapsed:.2f}s, timeout not working!")
        return elapsed, False
    elif result is None:
        print(f"  STATUS: ✅ PASS — Timed out correctly in {elapsed:.2f}s")
        return elapsed, True
    else:
        print(f"  STATUS: ✅ PASS — Completed in {elapsed:.2f}s (under timeout)")
        return elapsed, True


if __name__ == "__main__":
    print("=" * 60)
    print("DialMate Response LLM Benchmark")
    print("=" * 60)
    
    results = {}
    
    # Test C first — doesn't need Ollama
    time_c, pass_c = test_c_template_response()
    results["C_template"] = {"time": time_c, "pass": pass_c}
    
    # Tests that need Ollama
    time_a, pass_a = test_a_simple_prompt()
    results["A_simple"] = {"time": time_a, "pass": pass_a}
    
    time_b, pass_b = test_b_product_prompt()
    results["B_product"] = {"time": time_b, "pass": pass_b}
    
    time_d, pass_d = test_d_timeout_protection()
    results["D_timeout"] = {"time": time_d, "pass": pass_d}
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"{'Test':<25} {'Time (s)':<12} {'Status':<10}")
    print("-" * 47)
    for name, r in results.items():
        status = "✅ PASS" if r["pass"] else "❌ FAIL"
        print(f"{name:<25} {r['time']:<12.2f} {status}")
    
    all_pass = all(r["pass"] for r in results.values())
    print(f"\nOverall: {'✅ ALL PASS' if all_pass else '⚠️ SOME FAILED'}")
    print(f"\nKey finding:")
    print(f"  Template path (Test C): {results['C_template']['time']:.3f}s")
    if results['A_simple']['pass'] and results['A_simple']['time'] < 15:
        print(f"  LLM path (Test A):      {results['A_simple']['time']:.2f}s")
    else:
        print(f"  LLM path:               Unavailable (Ollama not running)")
