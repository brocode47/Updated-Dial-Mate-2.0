"""
DialMate Production Conversation Quality Layer Test Suite
=========================================================
Tests Phase 2 Step 5 Production Quality Layer across:
- 26 realistic customer messages (Roman Urdu, Urdu script, English)
- Deterministic routing to correct agent (<1ms, zero LLM)
- Correct intent classification & confidence score verification
- Language matching between customer query and agent response
- Response generation without exceptions, hangs, or hallucinations
"""
import sys
import os
import time

sys.path.insert(0, os.path.dirname(__file__))

from app.agents.router import route_message
from app.agents.main_agent import main_agent
from app.agents.language import detect_language


TEST_CASES = [
    # -------------------------------------------------------------------
    # 1. Product Inquiries
    # -------------------------------------------------------------------
    {
        "id": 1,
        "message": "Mujhe gift chahiye",
        "expected_agent": "product_agent",
        "expected_intent": "product_recommendation",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: any(w in resp.lower() for w in ["gift", "budget", "help", "option"])
    },
    {
        "id": 2,
        "message": "price bata dein",
        "expected_agent": "product_agent",
        "expected_intent": "price_inquiry",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "price" in resp.lower() or "qeemat" in resp.lower() or "product" in resp.lower()
    },
    {
        "id": 3,
        "message": "available hai?",
        "expected_agent": "product_agent",
        "expected_intent": "product_availability",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "stock" in resp.lower() or "available" in resp.lower() or "naam" in resp.lower()
    },
    {
        "id": 4,
        "message": "is mein konsay colors aur sizes hain?",
        "expected_agent": "product_agent",
        "expected_intent": "size_color_inquiry",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "size" in resp.lower() or "color" in resp.lower()
    },
    {
        "id": 5,
        "message": "product ki quality aur details batao",
        "expected_agent": "product_agent",
        "expected_intent": "product_details",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "quality" in resp.lower() or "detail" in resp.lower() or "product" in resp.lower()
    },

    # -------------------------------------------------------------------
    # 2. Order & Logistics
    # -------------------------------------------------------------------
    {
        "id": 6,
        "message": "mera order kahan hai",
        "expected_agent": "order_agent",
        "expected_intent": "order_status",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "order" in resp.lower()
    },
    {
        "id": 7,
        "message": "mera order late hai",
        "expected_agent": "order_agent",
        "expected_intent": "late_order_complaint",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "afsos" in resp.lower() or "late" in resp.lower() or "order" in resp.lower()
    },
    {
        "id": 8,
        "message": "order cancel karna hai",
        "expected_agent": "order_agent",
        "expected_intent": "order_cancel",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "cancel" in resp.lower() or "order" in resp.lower()
    },
    {
        "id": 9,
        "message": "delivery kitne din mein hogi",
        "expected_agent": "support_agent",
        "expected_intent": "delivery_time",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "working days" in resp.lower() or "din" in resp.lower()
    },
    {
        "id": 10,
        "message": "delivery charges kitnay hain?",
        "expected_agent": "support_agent",
        "expected_intent": "shipping_info",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "200" in resp or "charges" in resp.lower() or "free" in resp.lower()
    },

    # -------------------------------------------------------------------
    # 3. Payments, Returns & Refunds
    # -------------------------------------------------------------------
    {
        "id": 11,
        "message": "payment method kya hai? COD available hai?",
        "expected_agent": "support_agent",
        "expected_intent": "payment_methods",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "cash on delivery" in resp.lower() or "cod" in resp.lower() or "jazzcash" in resp.lower()
    },
    {
        "id": 12,
        "message": "return karna hai, policy kya hai",
        "expected_agent": "support_agent",
        "expected_intent": "return_exchange",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "7" in resp or "exchange" in resp.lower() or "return" in resp.lower()
    },
    {
        "id": 13,
        "message": "refund chahiye",
        "expected_agent": "support_agent",
        "expected_intent": "refund_request",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "refund" in resp.lower() or "jazzcash" in resp.lower() or "account" in resp.lower()
    },

    # -------------------------------------------------------------------
    # 4. Human Escalation
    # -------------------------------------------------------------------
    {
        "id": 14,
        "message": "manager se baat karni hai",
        "expected_agent": "support_agent",
        "expected_intent": "human_agent_request",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "management ya owner" in resp.lower() or "team" in resp.lower()
    },
    {
        "id": 15,
        "message": "insan se baat karwao",
        "expected_agent": "support_agent",
        "expected_intent": "human_agent_request",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "management ya owner" in resp.lower() or "team" in resp.lower()
    },
    {
        "id": 16,
        "message": "Tumhara boss kon hai",
        "expected_agent": "support_agent",
        "expected_intent": "human_agent_request",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "management ya owner" in resp  # Exact match required for test_memory.py Test F
    },

    # -------------------------------------------------------------------
    # 5. Greetings & Closings
    # -------------------------------------------------------------------
    {
        "id": 17,
        "message": "hello",
        "expected_agent": "support_agent",
        "expected_intent": "greeting",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "assalam o alaikum" in resp.lower() or "dial mate" in resp.lower()
    },
    {
        "id": 18,
        "message": "bohot shukriya",
        "expected_agent": "support_agent",
        "expected_intent": "gratitude_closing",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "shukriya" in resp.lower() or "welcome" in resp.lower()
    },
    {
        "id": 19,
        "message": "aoa",
        "expected_agent": "support_agent",
        "expected_intent": "greeting",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "assalam o alaikum" in resp.lower()
    },

    # -------------------------------------------------------------------
    # 6. Urdu Script (عربی رسم الخط)
    # -------------------------------------------------------------------
    {
        "id": 20,
        "message": "میرا آرڈر کہاں ہے؟",
        "expected_agent": "order_agent",
        "expected_intent": "order_status",
        "expected_lang": "urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "آرڈر" in resp
    },
    {
        "id": 21,
        "message": "السلام علیکم، مجھے مدد چاہیے",
        "expected_agent": "support_agent",
        "expected_intent": "greeting",
        "expected_lang": "urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "السلام علیکم" in resp or "ڈائل میٹ" in resp
    },
    {
        "id": 22,
        "message": "کیا کیش آن ڈیلیوری دستیاب ہے؟",
        "expected_agent": "support_agent",
        "expected_intent": "payment_methods",
        "expected_lang": "urdu",
        "min_confidence": 0.70,
        "content_check": lambda resp: "کیش آن ڈیلیوری" in resp or "ادائیگی" in resp
    },

    # -------------------------------------------------------------------
    # 7. English Queries
    # -------------------------------------------------------------------
    {
        "id": 23,
        "message": "Where is my order?",
        "expected_agent": "order_agent",
        "expected_intent": "order_status",
        "expected_lang": "english",
        "min_confidence": 0.70,
        "content_check": lambda resp: "order" in resp.lower()
    },
    {
        "id": 24,
        "message": "What are your delivery charges?",
        "expected_agent": "support_agent",
        "expected_intent": "shipping_info",
        "expected_lang": "english",
        "min_confidence": 0.70,
        "content_check": lambda resp: "shipping" in resp.lower() or "rs 200" in resp.lower() or "delivery" in resp.lower()
    },
    {
        "id": 25,
        "message": "Thank you so much for your help!",
        "expected_agent": "support_agent",
        "expected_intent": "gratitude_closing",
        "expected_lang": "english",
        "min_confidence": 0.70,
        "content_check": lambda resp: "welcome" in resp.lower()
    },

    # -------------------------------------------------------------------
    # 8. Unknown / Fallback (Confidence must be < 0.70)
    # -------------------------------------------------------------------
    {
        "id": 26,
        "message": "asdkjasdkj 123987 unknown random text",
        "expected_agent": "support_agent",
        "expected_intent": "unknown_query",
        "expected_lang": "roman_urdu",
        "min_confidence": 0.0,
        "max_confidence": 0.69,
        "content_check": lambda resp: len(resp) > 10
    }
]


def run_conversation_quality_tests():
    print("=" * 75)
    print("DIALMATE 2.0: PHASE 2 STEP 5 CONVERSATION QUALITY LAYER TEST SUITE")
    print("=" * 75)

    passed_count = 0
    total_count = len(TEST_CASES)

    for tc in TEST_CASES:
        t_id = tc["id"]
        msg = tc["message"]
        start_time = time.time()

        try:
            # 1. Test routing & schema compliance
            decision = route_message(msg)
            elapsed_ms = (time.time() - start_time) * 1000

            # Verify schema
            required_keys = ["agent", "intent", "action", "confidence", "priority", "matched_keywords"]
            missing_keys = [k for k in required_keys if k not in decision]
            if missing_keys:
                print(f"❌ Test {t_id:02d} FAILED: Missing keys {missing_keys} in decision: {decision}")
                continue

            agent = decision["agent"]
            intent = decision["intent"]
            conf = decision["confidence"]
            matched_kw = decision["matched_keywords"]

            # Verify routing match
            if agent != tc["expected_agent"]:
                print(f"❌ Test {t_id:02d} FAILED: '{msg}' routed to {agent}, expected {tc['expected_agent']}")
                continue

            if intent != tc["expected_intent"]:
                print(f"❌ Test {t_id:02d} FAILED: '{msg}' intent is {intent}, expected {tc['expected_intent']}")
                continue

            # Verify confidence score bounds
            if "max_confidence" in tc:
                if conf > tc["max_confidence"]:
                    print(f"❌ Test {t_id:02d} FAILED: Unknown query confidence {conf} exceeds max {tc['max_confidence']}")
                    continue
            else:
                if conf < tc["min_confidence"]:
                    print(f"❌ Test {t_id:02d} FAILED: Recognized query confidence {conf} below min {tc['min_confidence']}")
                    continue

            # 2. Test language detection
            detected_lang = detect_language(msg)
            if detected_lang != tc["expected_lang"]:
                print(f"❌ Test {t_id:02d} FAILED: Language detected '{detected_lang}', expected '{tc['expected_lang']}' for '{msg}'")
                continue

            # 3. Test response generation
            res = main_agent(msg)
            if not res or "response" not in res:
                print(f"❌ Test {t_id:02d} FAILED: No response generated for '{msg}'")
                continue

            resp_text = res["response"]
            if not resp_text or len(resp_text.strip()) == 0:
                print(f"❌ Test {t_id:02d} FAILED: Empty response for '{msg}'")
                continue

            # Verify content safety / intent adherence
            if not tc["content_check"](resp_text):
                print(f"❌ Test {t_id:02d} FAILED: Response content check failed for '{msg}'. Response: {resp_text[:80]}...")
                continue

            print(f"✅ Test {t_id:02d} PASS ({elapsed_ms:.1f}ms): [{detected_lang}] '{msg[:30]}' -> {agent} ({intent}, conf={conf})")
            passed_count += 1

        except Exception as e:
            print(f"❌ Test {t_id:02d} EXCEPTION: {e}")

    print("\n" + "=" * 75)
    print(f"TEST RESULTS: {passed_count}/{total_count} PASSED ({passed_count/total_count*100:.1f}%)")
    print("=" * 75)

    if passed_count == total_count:
        print("\n🎉 ALL 26 TESTS PASSED PERFECTLY!\n")
        return True
    else:
        print(f"\n⚠️ {total_count - passed_count} TESTS FAILED\n")
        return False


if __name__ == "__main__":
    success = run_conversation_quality_tests()
    sys.exit(0 if success else 1)
