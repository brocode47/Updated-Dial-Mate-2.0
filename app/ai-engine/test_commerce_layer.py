"""
DialMate 2.0: Phase 3 Step 2 Commerce Service Layer Test Suite
Validates:
1. Product Service (search, price inquiry, unavailable product, size/color filtering)
2. Inventory Service (deterministic stock > 0 vs stock == 0 checks)
3. Order Service (lookup by phone, lookup by ID, item extraction, cancellation rules)
4. Multi-Tenant Security (Shop A cannot access Shop B products/orders, shop_id enforcement)
"""

import sys
import os
import json
import unittest
from unittest.mock import MagicMock, patch

# Ensure app is importable
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app.services.product_service import search_products, get_product_by_id
from app.services.inventory_service import check_inventory, get_stock_status
from app.services.order_service import (
    get_order_by_phone,
    get_order_by_id,
    cancel_order,
    parse_order_payload
)
from app.agents.product_agent import product_agent
from app.agents.order_agent import order_agent


# ==============================================================================
# In-Memory Multi-Tenant Commerce Mock Fixture
# ==============================================================================

class MockCommerceDB:
    def __init__(self):
        self.products = [
            # Shop A Products
            {
                "id": "prod-a-001",
                "shopId": "shop-alpha",
                "name": "Black Cotton Shirt",
                "description": "Premium 100% combed cotton black casual shirt",
                "category": "Apparel",
                "price": 2500.0,
                "stock": 10,
                "currency": "PKR",
                "variants": json.dumps([
                    {"title": "Black / M", "stock": 5},
                    {"title": "Black / L", "stock": 5}
                ]),
                "images": json.dumps(["https://img.example.com/black-shirt.jpg"])
            },
            {
                "id": "prod-a-002",
                "shopId": "shop-alpha",
                "name": "White Formal Shirt",
                "description": "Slim fit formal white dress shirt",
                "category": "Apparel",
                "price": 3200.0,
                "stock": 0,  # OUT OF STOCK
                "currency": "PKR",
                "variants": json.dumps([
                    {"title": "White / M", "stock": 0}
                ]),
                "images": json.dumps(["https://img.example.com/white-shirt.jpg"])
            },
            {
                "id": "prod-a-003",
                "shopId": "shop-alpha",
                "name": "Leather Bi-Fold Wallet",
                "description": "Genuine cowhide leather men's wallet with coin pocket",
                "category": "Accessories",
                "price": 1800.0,
                "stock": 15,
                "currency": "PKR",
                "variants": None,
                "images": "https://img.example.com/wallet.jpg"
            },
            # Shop B Products
            {
                "id": "prod-b-001",
                "shopId": "shop-beta",
                "name": "Blue Denim Jeans",
                "description": "Regular fit stretchable denim jeans",
                "category": "Apparel",
                "price": 4500.0,
                "stock": 8,
                "currency": "PKR",
                "variants": None,
                "images": None
            }
        ]

        self.orders = [
            # Shop A Orders
            {
                "id": "ord-a-1001",
                "shopId": "shop-alpha",
                "orderNumber": "1001",
                "customerId": "cust-a-1",
                "customerPhone": "03001234567",
                "status": "Processing",  # Cancellable
                "totalAmount": 2500.0,
                "courierName": "Trax Logistics",
                "trackingNumber": "TRX-778899",
                "trackingStatus": "Booked",
                "trackingLocation": "Lahore Hub",
                "expectedDelivery": "2026-10-02",
                "payload": json.dumps({
                    "line_items": [
                        {"title": "Black Cotton Shirt", "quantity": 1, "price": 2500.0}
                    ],
                    "courier": "Trax Logistics",
                    "tracking_number": "TRX-778899",
                    "customer": {"phone": "03001234567", "first_name": "Ali", "last_name": "Khan"}
                })
            },
            {
                "id": "ord-a-1002",
                "shopId": "shop-alpha",
                "orderNumber": "1002",
                "customerId": "cust-a-2",
                "customerPhone": "03119876543",
                "status": "Delivered",  # Non-cancellable
                "totalAmount": 1800.0,
                "courierName": "TCS Express",
                "trackingNumber": "TCS-334455",
                "trackingStatus": "Delivered",
                "trackingLocation": "Karachi",
                "expectedDelivery": "2026-09-28",
                "payload": json.dumps({
                    "line_items": [
                        {"title": "Leather Bi-Fold Wallet", "quantity": 1, "price": 1800.0}
                    ],
                    "courier": "TCS Express",
                    "tracking_number": "TCS-334455",
                    "customer": {"phone": "03119876543"}
                })
            },
            # Shop B Orders
            {
                "id": "ord-b-2001",
                "shopId": "shop-beta",
                "orderNumber": "2001",
                "customerId": "cust-b-1",
                "customerPhone": "03215556677",
                "status": "Pending Confirmation",
                "totalAmount": 4500.0,
                "courierName": None,
                "trackingNumber": None,
                "trackingStatus": None,
                "trackingLocation": None,
                "expectedDelivery": None,
                "payload": json.dumps({
                    "line_items": [
                        {"title": "Blue Denim Jeans", "quantity": 1, "price": 4500.0}
                    ],
                    "customer": {"phone": "03215556677"}
                })
            }
        ]

    def create_mock_cursor(self):
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        def execute_side_effect(sql, params=None):
            sql_clean = " ".join(sql.split())
            mock_cur._last_sql = sql_clean
            mock_cur._last_params = params or []

            # 1. information_schema query
            if "information_schema.columns" in sql:
                mock_cur._rows = [("currency",), ("variants",), ("images",)]
                return

            # 2. SELECT FROM "Product"
            if 'FROM "Product"' in sql:
                shop_id = params[0]
                matching = [p for p in self.products if p["shopId"] == shop_id]

                # Filter by ID
                if 'id = %s' in sql:
                    prod_id = params[1]
                    matching = [p for p in matching if p["id"] == prod_id]
                else:
                    # Query / search filter
                    if 'ILIKE %s' in sql:
                        # Iterate through params to check text filters
                        for p_val in params[1:]:
                            if isinstance(p_val, str) and p_val.startswith("%") and p_val.endswith("%"):
                                search_term = p_val.strip("%").lower()
                                if search_term:
                                    matching = [
                                        p for p in matching
                                        if (search_term in p["name"].lower()
                                            or search_term in (p["description"] or "").lower()
                                            or search_term in (p["category"] or "").lower()
                                            or search_term in (p["variants"] or "").lower())
                                    ]

                    if 'price >=' in sql:
                        for p_val in params:
                            if isinstance(p_val, float):
                                matching = [p for p in matching if p["price"] >= p_val]
                                break

                    if 'price <=' in sql:
                        for p_val in reversed(params):
                            if isinstance(p_val, float):
                                matching = [p for p in matching if p["price"] <= p_val]
                                break

                    if 'stock > 0' in sql:
                        matching = [p for p in matching if p["stock"] > 0]

                rows = []
                for p in matching:
                    rows.append((
                        p["id"],
                        p["name"],
                        p["description"],
                        p["price"],
                        p["stock"],
                        p["currency"],
                        p["variants"],
                        p["images"]
                    ))
                mock_cur._rows = rows
                return

            # 3. SELECT FROM "Order"
            if 'FROM "Order"' in sql:
                shop_id = params[0]
                matching_orders = [o for o in self.orders if o["shopId"] == shop_id]

                where_part = sql.split('WHERE', 1)[1] if 'WHERE' in sql else ''

                if 'c.phone' in where_part or 'payload LIKE' in where_part:
                    phone_target = params[1]
                    matching_orders = [
                        o for o in matching_orders
                        if o["customerPhone"] == phone_target or (phone_target and phone_target in o["payload"])
                    ]
                elif 'id = %s' in where_part or '"orderNumber" = %s' in where_part:
                    target_id = params[1]
                    matching_orders = [
                        o for o in matching_orders
                        if o["id"] == target_id or o["orderNumber"] == target_id
                    ]

                rows = []
                for o in matching_orders:
                    rows.append((
                        o["id"],
                        o["orderNumber"],
                        o["status"],
                        o["totalAmount"],
                        o["courierName"],
                        o["trackingNumber"],
                        o["trackingStatus"],
                        o["trackingLocation"],
                        o["expectedDelivery"],
                        o["payload"]
                    ))
                mock_cur._rows = rows
                return

            # 4. UPDATE "Order"
            if 'UPDATE "Order"' in sql:
                new_status = params[0]
                shop_id = params[1]
                target_id = params[2]
                for o in self.orders:
                    if o["shopId"] == shop_id and (o["id"] == target_id or o["orderNumber"] == target_id):
                        o["status"] = new_status
                mock_cur._rows = []
                return

            mock_cur._rows = []

        mock_cur.execute.side_effect = execute_side_effect
        mock_cur.fetchall.side_effect = lambda: getattr(mock_cur, "_rows", [])
        mock_cur.fetchone.side_effect = lambda: (getattr(mock_cur, "_rows", [])[0] if getattr(mock_cur, "_rows", []) else None)
        return mock_conn, mock_cur


# ==============================================================================
# Test Cases
# ==============================================================================

class TestCommerceLayer(unittest.TestCase):

    def setUp(self):
        self.mock_db = MockCommerceDB()
        self.mock_conn, self.mock_cur = self.mock_db.create_mock_cursor()

        # Patch get_connection across services
        self.patcher = patch("app.memory.db_memory.get_connection", return_value=self.mock_conn)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()

    # --------------------------------------------------------------------------
    # 1. Product Service Tests
    # --------------------------------------------------------------------------

    def test_01_search_product_by_query_and_category(self):
        """Test product search with text query and category filtering."""
        results = search_products("shop-alpha", query="shirt", category="Apparel")
        self.assertTrue(len(results) >= 1)
        names = [p["name"] for p in results]
        self.assertIn("Black Cotton Shirt", names)

    def test_02_search_product_price_range(self):
        """Test product search with min/max price range."""
        results = search_products("shop-alpha", min_price=2000.0, max_price=3000.0)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["name"], "Black Cotton Shirt")
        self.assertEqual(results[0]["price"], 2500.0)

    def test_03_price_inquiry_structured_response(self):
        """Test product price inquiry returns normalized currency and price."""
        product = get_product_by_id("shop-alpha", "prod-a-001")
        self.assertIsNotNone(product)
        self.assertEqual(product["price"], 2500.0)
        self.assertEqual(product["currency"], "PKR")
        self.assertEqual(product["stock_status"], "IN_STOCK")

    def test_04_unavailable_product_returns_empty(self):
        """Test searching for non-existent product in shop catalog returns empty list."""
        results = search_products("shop-alpha", query="Gaming Laptop")
        self.assertEqual(len(results), 0)

    def test_05_size_and_color_filtering(self):
        """Test product search filtering by color and size in variants."""
        results = search_products("shop-alpha", color="black", size="M")
        self.assertTrue(len(results) >= 1)
        self.assertEqual(results[0]["name"], "Black Cotton Shirt")
        # Ensure variants were parsed from JSON
        self.assertIsInstance(results[0]["variants"], list)
        self.assertEqual(len(results[0]["variants"]), 2)

    # --------------------------------------------------------------------------
    # 2. Inventory Service Tests (Deterministic checks, no LLM guessing)
    # --------------------------------------------------------------------------

    def test_06_inventory_available_stock(self):
        """Customer: 'black shirt available hai?' -> stock > 0: 'Jee black shirt available hai.'"""
        res = check_inventory("shop-alpha", product_name_or_query="black shirt available hai?")
        self.assertTrue(res["found"])
        self.assertGreater(res["stock"], 0)
        self.assertIn(res["stock_status"], ["IN_STOCK", "LOW_STOCK"])
        self.assertIn("available hai", res["message"])
        self.assertNotIn("nahi hai", res["message"])

    def test_07_inventory_zero_stock(self):
        """Customer: 'white shirt available hai?' -> stock = 0: 'Jee filhal white color available nahi hai.'"""
        res = check_inventory("shop-alpha", product_name_or_query="white shirt available hai?")
        self.assertTrue(res["found"])
        self.assertEqual(res["stock"], 0)
        self.assertEqual(res["stock_status"], "OUT_OF_STOCK")
        self.assertIn("available nahi hai", res["message"])

    def test_08_inventory_unmatched_item(self):
        """Inventory check for an item not sold by this shop."""
        res = check_inventory("shop-alpha", product_name_or_query="PlayStation 5")
        self.assertFalse(res["found"])
        self.assertEqual(res["stock_status"], "NOT_FOUND")
        self.assertIn("available nahi hai", res["message"])

    # --------------------------------------------------------------------------
    # 3. Order Service Tests
    # --------------------------------------------------------------------------

    def test_09_order_lookup_by_phone(self):
        """Test retrieving customer's order by phone number."""
        order = get_order_by_phone("shop-alpha", "03001234567")
        self.assertIsNotNone(order)
        self.assertEqual(order["order_number"], "1001")
        self.assertEqual(order["status"], "Processing")
        self.assertEqual(order["courier"], "Trax Logistics")

    def test_10_order_lookup_by_id(self):
        """Test retrieving order by ID or order number."""
        order = get_order_by_id("shop-alpha", "1001")
        self.assertIsNotNone(order)
        self.assertEqual(order["id"], "ord-a-1001")
        self.assertEqual(order["total_amount"], 2500.0)

    def test_11_order_item_extraction_from_payload(self):
        """Test parsing line items, quantities, and prices from JSON payload."""
        order = get_order_by_id("shop-alpha", "1001")
        self.assertIsNotNone(order)
        items = order["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["name"], "Black Cotton Shirt")
        self.assertEqual(items[0]["quantity"], 1)
        self.assertEqual(items[0]["price"], 2500.0)
        self.assertEqual(order["tracking_number"], "TRX-778899")

    def test_12_order_cancellation_allowed_when_processing(self):
        """Test order in 'Processing' state is cancellable and status updates to 'Cancelled'."""
        cancel_res = cancel_order("shop-alpha", "1001")
        self.assertTrue(cancel_res["success"])
        self.assertIsNone(cancel_res["reason"])
        self.assertIn("cancel kar diya gaya hai", cancel_res["message"])

    def test_13_order_cancellation_rejected_when_delivered_or_shipped(self):
        """Test order in 'Delivered' or 'Shipped' state CANNOT be cancelled."""
        cancel_res = cancel_order("shop-alpha", "1002")
        self.assertFalse(cancel_res["success"])
        self.assertEqual(cancel_res["reason"], "already_dispatched")
        self.assertIn("already dispatch ho chuka hai", cancel_res["message"])

    # --------------------------------------------------------------------------
    # 4. Multi-Tenant Security Isolation Tests
    # --------------------------------------------------------------------------

    def test_14_security_shop_a_cannot_access_shop_b_products(self):
        """Shop A must NEVER be able to view or search Shop B's catalog."""
        # Blue Jeans belongs exclusively to shop-beta
        results_from_alpha = search_products("shop-alpha", query="Blue Denim Jeans")
        self.assertEqual(len(results_from_alpha), 0)

        # Should be found when querying with shop-beta
        results_from_beta = search_products("shop-beta", query="Blue Denim Jeans")
        self.assertEqual(len(results_from_beta), 1)
        self.assertEqual(results_from_beta[0]["name"], "Blue Denim Jeans")

    def test_15_security_shop_a_cannot_access_shop_b_orders(self):
        """Shop A must NEVER be able to view or cancel Shop B's orders."""
        # Order 2001 belongs to shop-beta
        order_from_alpha = get_order_by_id("shop-alpha", "2001")
        self.assertIsNone(order_from_alpha)

        # Lookup by phone belonging to shop-beta customer
        phone_from_alpha = get_order_by_phone("shop-alpha", "03215556677")
        self.assertIsNone(phone_from_alpha)

        # Unauthorized cancellation attempt across tenants
        cancel_attempt = cancel_order("shop-alpha", "2001")
        self.assertFalse(cancel_attempt["success"])
        self.assertEqual(cancel_attempt["reason"], "not_found")

    def test_16_security_missing_shop_id_raises_value_error(self):
        """All service queries must strictly enforce presence of shop_id."""
        with self.assertRaises(ValueError):
            search_products(None)

        with self.assertRaises(ValueError):
            get_product_by_id("", "prod-a-001")

        with self.assertRaises(ValueError):
            check_inventory(None, "shirt")

        with self.assertRaises(ValueError):
            get_order_by_id(None, "1001")

        with self.assertRaises(ValueError):
            get_order_by_phone("", "03001234567")

        with self.assertRaises(ValueError):
            cancel_order(None, "1001")

    # --------------------------------------------------------------------------
    # 5. Agent Integration with Service Layer Tests
    # --------------------------------------------------------------------------

    def test_17_product_agent_uses_inventory_service_for_live_stock(self):
        """Verify product_agent returns live deterministic stock for availability queries."""
        ctx = {"shop_id": "shop-alpha", "history": [], "customer_memory": {}}
        res = product_agent("black shirt available hai?", context=ctx, intent="product_availability")
        self.assertIn("message", res)
        self.assertIn("available hai", res["message"])

    def test_18_order_agent_uses_order_service_for_status_and_items(self):
        """Verify order_agent formats items and tracking accurately from order_service."""
        ctx = {"shop_id": "shop-alpha", "phone": "03001234567"}
        res = order_agent("order_status", order_id="1001", context=ctx)
        self.assertEqual(res["action"], "status")
        self.assertIn("Black Cotton Shirt", res["message"])
        self.assertIn("Trax Logistics", res["message"])


def run_tests():
    print("=" * 75)
    print("DIALMATE 2.0: PHASE 3 STEP 2 COMMERCE SERVICE LAYER TEST SUITE")
    print("=" * 75)

    suite = unittest.TestLoader().loadTestsFromTestCase(TestCommerceLayer)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    print("\n" + "=" * 75)
    if result.wasSuccessful():
        print(f"TEST RESULTS: {result.testsRun}/{result.testsRun} PASSED (100.0%)")
        print("ALL COMMERCE LAYER & SECURITY TESTS PASSED PERFECTLY!")
        print("=" * 75)
        return True
    else:
        print(f"FAILED: {len(result.failures)} failures, {len(result.errors)} errors")
        print("=" * 75)
        return False


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
