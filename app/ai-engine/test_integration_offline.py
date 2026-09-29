"""
DialMate Integration Test (offline mode)
==========================================
Simulates all test_memory.py flows without requiring PostgreSQL or Ollama.
Verifies:
- Keyword routing works correctly
- Product agent uses templates (not LLM)
- Support agent handles escalation
- Template rendering is correct
- Timeout protection works
- No code path hangs indefinitely
"""
import time
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

def test_a_routing_isolation():
    """Test A: Keyword routing works for all intents."""
    print("\n--- Test A: Keyword Routing ---")
    from app.agents.supervisor import keyword_supervisor_agent
    
    tests = {
        "Mujhe wife ke liye gift chahiye": "sales_agent",
        "Mera order kahan hai": "order_agent", 
        "Tumhara boss kon hai": "support_agent",
        "Delivery kab tak ayegi": "delivery_agent",
    }
    
    all_pass = True
    for msg, expected in tests.items():
        result = keyword_supervisor_agent(msg)
        if result["agent"] != expected:
            print(f"  FAIL: '{msg}' -> {result['agent']} (expected {expected})")
            all_pass = False
    
    if all_pass:
        print("PASS: All routing is correct.")
    return all_pass


def test_b_product_template():
    """Test B: Product agent generates template responses."""
    print("\n--- Test B: Product Template Response ---")
    from app.agents.product_agent import _format_product_list, _get_personalization
    from app.agents.product_agent import PRODUCT_LIST_TEMPLATE_BUDGET, ASK_BUDGET_TEMPLATE
    
    products = [
        ("Luxury Perfume Set", "Premium fragrance", 4500),
        ("Crystal Vase", "Elegant decor", 2800),
    ]
    memory = {"preferred_categories": "perfumes", "average_budget": 5000}
    
    start = time.time()
    plist = _format_product_list(products)
    pers = _get_personalization(memory)
    result = PRODUCT_LIST_TEMPLATE_BUDGET.format(personalization=pers, product_list=plist)
    elapsed = time.time() - start
    
    if elapsed < 0.1 and "perfumes" in result and "4,500" in result:
        print(f"PASS: Template rendered in {elapsed:.6f}s")
        return True
    else:
        print(f"FAIL: Template took {elapsed:.2f}s or content wrong")
        return False


def test_c_product_no_hang():
    """Test C: Product agent doesn't hang when DB/LLM unavailable."""
    print("\n--- Test C: Product Agent No-Hang ---")
    from app.agents.product_agent import product_agent
    
    context = {
        "history": [],
        "customer_memory": {},
        "previous_orders": []
    }
    
    start = time.time()
    # This should return the ASK_BUDGET_TEMPLATE since no products match
    # and no DB query triggers (no gift keywords without search)
    result = product_agent("Hello", context)
    elapsed = time.time() - start
    
    if elapsed < 5 and result and "message" in result:
        print(f"PASS: Completed in {elapsed:.2f}s (no hang)")
        return True
    else:
        print(f"FAIL: Took {elapsed:.2f}s or no result")
        return False


def test_d_support_escalation():
    """Test D: Support escalation uses template."""
    print("\n--- Test D: Support Escalation ---")
    from app.agents.support_agent import support_agent
    
    start = time.time()
    result = support_agent("owner_request", "Tumhara boss kon hai")
    elapsed = time.time() - start
    
    if elapsed < 0.1 and "management ya owner" in result["response"]:
        print(f"PASS: Escalation in {elapsed:.6f}s")
        return True
    else:
        print(f"FAIL: Took {elapsed:.2f}s or wrong response")
        return False


def test_e_support_general_timeout():
    """Test E: Support general question doesn't hang."""
    print("\n--- Test E: Support General (timeout protection) ---")
    from app.agents.support_agent import support_agent
    
    start = time.time()
    result = support_agent("general_question", "Shukriya", context={
        "history": [], "customer_memory": {}, "previous_orders": []
    })
    elapsed = time.time() - start
    
    if elapsed < 50 and result and "response" in result:
        print(f"PASS: Completed in {elapsed:.2f}s (no hang, fallback worked)")
        return True
    else:
        print(f"FAIL: Took {elapsed:.2f}s")
        return False


def test_f_safe_llm_invoke():
    """Test F: safe_llm_invoke timeout protection."""
    print("\n--- Test F: LLM Timeout Protection ---")
    from app.models.llm import safe_llm_invoke
    
    start = time.time()
    result = safe_llm_invoke([
        ("system", "Reply only: test"),
        ("human", "test")
    ], timeout_seconds=5)
    elapsed = time.time() - start
    
    # Should either succeed quickly or timeout cleanly
    if elapsed < 7:
        print(f"PASS: Exited in {elapsed:.2f}s (no hang)")
        return True
    else:
        print(f"FAIL: Took {elapsed:.2f}s (exceeded timeout)")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("DialMate Integration Test (Offline Mode)")
    print("=" * 60)
    
    results = {}
    results["A"] = test_a_routing_isolation()
    results["B"] = test_b_product_template()
    results["C"] = test_c_product_no_hang()
    results["D"] = test_d_support_escalation()
    results["E"] = test_e_support_general_timeout()
    results["F"] = test_f_safe_llm_invoke()
    
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    for name, passed in results.items():
        status = "PASS" if passed else "FAIL"
        print(f"  Test {name}: {status}")
    
    all_pass = all(results.values())
    print(f"\nOverall: {'ALL PASS' if all_pass else 'SOME FAILED'}")
    sys.exit(0 if all_pass else 1)
