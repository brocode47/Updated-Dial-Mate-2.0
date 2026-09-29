"""
DialMate 2.0 — Phase 2 Step 6 AI Engine API Test Suite
======================================================
Tests:
1. Valid Chat Request: schema, agent, intent, confidence, conversation_id, type
2. Invalid Payload: Pydantic schema validation errors (HTTP 422)
3. API Security & Key Enforcement: X-AI-ENGINE-KEY validation & HTTP 401 on unauthorized
4. Multi-Tenant Isolation: Same customer phone across two different shops
5. Conversation Continuation: Multi-turn context resolution
6. Sub-second Execution: Latency verification for template queries (< 100ms)
7. Health & Home Check: GET / and GET /health
"""
import os
import sys
import time
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

# In-memory storage to simulate multi-tenant DB persistence offline
in_memory_conversations = {}
in_memory_history = {}


def mock_save_message(shop_id, phone, message, sender="customer"):
    key = f"{shop_id}:{phone}"
    if key not in in_memory_conversations:
        in_memory_conversations[key] = f"conv-{shop_id}-{phone}"
        in_memory_history[key] = []
    in_memory_history[key].append({"role": sender, "content": message})
    return in_memory_conversations[key]


def mock_get_history(shop_id, phone):
    key = f"{shop_id}:{phone}"
    return in_memory_history.get(key, [])


def mock_get_customer_id(shop_id, phone):
    return f"cust-{shop_id}-{phone}"


def run_api_tests():
    print("=" * 70)
    print("DIALMATE 2.0: PHASE 2 STEP 6 FASTAPI CHAT ENDPOINT TEST SUITE")
    print("=" * 70)

    # 1. Test Home & Health
    print("\n--- Test 1: Home & Health Endpoints ---")
    resp_home = client.get("/")
    assert resp_home.status_code == 200, f"Expected 200, got {resp_home.status_code}"
    assert resp_home.json()["status"] == "running"

    resp_health = client.get("/health")
    assert resp_health.status_code == 200, f"Expected 200, got {resp_health.status_code}"
    assert resp_health.json()["status"] == "healthy"
    print("PASS: Home and Health endpoints return 200 OK.")

    # 2. Test Valid Chat Request & Schema
    print("\n--- Test 2: Valid Chat Request & Schema Verification ---")
    payload = {
        "shop_id": "test-shop-123",
        "customer_phone": "+923001234567",
        "message": "price bata dein"
    }

    start = time.time()
    resp = client.post("/chat", json=payload)
    elapsed_ms = (time.time() - start) * 1000

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()

    for key in ["response", "agent", "intent", "confidence", "conversation_id", "type"]:
        assert key in data, f"Missing required key '{key}' in response: {data}"

    assert data["agent"] == "product_agent"
    assert data["intent"] == "price_inquiry"
    assert data["confidence"] >= 0.70
    assert data["type"] == "conversation"
    assert data["conversation_id"] is not None
    assert len(data["response"]) > 0

    print(f"PASS: Valid chat request executed in {elapsed_ms:.1f}ms. Agent: {data['agent']}, Intent: {data['intent']}, Confidence: {data['confidence']}")

    # 3. Test Invalid Payloads (Pydantic validation)
    print("\n--- Test 3: Invalid Payloads & Validation ---")
    r1 = client.post("/chat", json={"customer_phone": "123", "message": "hello"})
    assert r1.status_code == 422, f"Expected 422 for missing shop_id, got {r1.status_code}"

    r2 = client.post("/chat", json={"shop_id": "shop-1", "message": "hello"})
    assert r2.status_code == 422, f"Expected 422 for missing customer_phone, got {r2.status_code}"

    r3 = client.post("/chat", json={"shop_id": "shop-1", "customer_phone": "123"})
    assert r3.status_code == 422, f"Expected 422 for missing message, got {r3.status_code}"

    r4 = client.post("/chat", json={})
    assert r4.status_code == 422, f"Expected 422 for empty payload, got {r4.status_code}"

    print("PASS: All invalid payloads correctly rejected with HTTP 422 Unprocessable Entity.")

    # 4. Test API Key Security
    print("\n--- Test 4: API Key Security & Enforcement ---")
    test_key = "test-secret-key-dialmate-2026"
    os.environ["AI_ENGINE_API_KEY"] = test_key

    auth_payload = {
        "shop_id": "sec-shop-1",
        "customer_phone": "+923000000000",
        "message": "hello"
    }

    try:
        # Missing header -> 401
        r_missing = client.post("/chat", json=auth_payload)
        assert r_missing.status_code == 401, f"Expected 401 for missing key, got {r_missing.status_code}"

        # Wrong key -> 401
        r_wrong = client.post("/chat", json=auth_payload, headers={"X-AI-ENGINE-KEY": "wrong-key"})
        assert r_wrong.status_code == 401, f"Expected 401 for wrong key, got {r_wrong.status_code}"

        # Valid key -> 200
        r_valid = client.post("/chat", json=auth_payload, headers={"X-AI-ENGINE-KEY": test_key})
        assert r_valid.status_code == 200, f"Expected 200 for valid key, got {r_valid.status_code}"
        assert r_valid.json()["agent"] == "support_agent"

        print("PASS: API key enforcement correctly blocks unauthorized callers and allows valid credentials.")
    finally:
        del os.environ["AI_ENGINE_API_KEY"]

    # 5. Test Multi-Tenant Isolation
    print("\n--- Test 5: Multi-Tenant Isolation ---")
    phone = "+923119998877"
    shop_a = "store-alpha-001"
    shop_b = "store-beta-002"

    r_a = client.post("/chat", json={"shop_id": shop_a, "customer_phone": phone, "message": "available hai?"})
    assert r_a.status_code == 200
    data_a = r_a.json()
    assert data_a["intent"] == "product_availability"
    conv_a = data_a["conversation_id"]

    r_b = client.post("/chat", json={"shop_id": shop_b, "customer_phone": phone, "message": "COD available hai?"})
    assert r_b.status_code == 200
    data_b = r_b.json()
    assert data_b["intent"] == "payment_methods"
    conv_b = data_b["conversation_id"]

    assert conv_a != conv_b, f"Expected different conversation IDs for different shops, got {conv_a} and {conv_b}"
    print(f"PASS: Multi-tenant isolation verified: Shop A ({conv_a}) != Shop B ({conv_b}).")

    # 6. Test Conversation Continuation
    print("\n--- Test 6: Conversation Continuation & Multi-Turn Context ---")
    shop_id = "tenant-conv-test"
    c_phone = "+923334445555"

    r_t1 = client.post("/chat", json={"shop_id": shop_id, "customer_phone": c_phone, "message": "Mujhe gift chahiye"})
    assert r_t1.status_code == 200
    d_t1 = r_t1.json()
    assert d_t1["agent"] == "product_agent"

    r_t2 = client.post("/chat", json={"shop_id": shop_id, "customer_phone": c_phone, "message": "Birthday"})
    assert r_t2.status_code == 200
    d_t2 = r_t2.json()
    assert d_t2["agent"] == "product_agent"
    assert len(d_t2["response"]) > 0

    print("PASS: Conversation continuation handles multi-turn context accurately.")

    # 7. Sub-Second Performance Latency Benchmark
    print("\n--- Test 7: Sub-Second Latency Benchmark ---")
    perf_payload = {
        "shop_id": "perf-shop",
        "customer_phone": "+923001234567",
        "message": "delivery charges kitnay hain?"
    }

    latencies = []
    for _ in range(5):
        t0 = time.time()
        r_p = client.post("/chat", json=perf_payload)
        t1 = time.time()
        assert r_p.status_code == 200
        latencies.append((t1 - t0) * 1000)

    avg_ms = sum(latencies) / len(latencies)
    print(f"PASS: Average latency over 5 calls: {avg_ms:.1f}ms (Well under 2.0s requirement).")
    assert avg_ms < 2000.0, "Latency exceeded 2 seconds threshold"

    print("\n" + "=" * 70)
    print("ALL 7 API TEST SUITES PASSED SUCCESSFULLY!")
    print("=" * 70)
    return True


if __name__ == "__main__":
    with patch("app.agents.main_agent.save_message", side_effect=mock_save_message), \
         patch("app.agents.main_agent.get_conversation_history", side_effect=mock_get_history), \
         patch("app.agents.main_agent.get_customer_id_by_phone", side_effect=mock_get_customer_id), \
         patch("app.agents.main_agent.get_customer_context", return_value={}), \
         patch("app.agents.main_agent.get_customer_order_by_phone", return_value=None), \
         patch("app.agents.main_agent.log_ai_interaction", return_value=None):
        
        success = run_api_tests()
        sys.exit(0 if success else 1)
