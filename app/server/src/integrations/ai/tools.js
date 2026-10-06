export const AITools = {
  get_order: {
    name: 'get_order',
    description: 'Fetch the latest status, line items, and details of the current order.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: { type: 'STRING', description: 'The internal database UUID of the order (optional, auto-injected if omitted)' }
      }
    }
  },
  get_customer: {
    name: 'get_customer',
    description: 'Fetch the customer details from Shopify.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customerId: { type: 'STRING', description: 'The Shopify internal ID of the customer' }
      },
      required: ['customerId']
    }
  },
  confirm_order: {
    name: 'confirm_order',
    description: 'Confirm an order and tag it as confirmed in Shopify. Call ONLY when customer gives clear, unambiguous, positive confirmation to dispatch.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: { type: 'STRING', description: 'The internal database UUID of the order (optional, auto-injected if omitted)' }
      }
    }
  },
  cancel_order: {
    name: 'cancel_order',
    description: 'Cancel an order in Shopify if the customer explicitly requests cancellation or reports a wrong number. Do NOT call if customer says not to cancel.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: { type: 'STRING', description: 'The internal database UUID of the order (optional, auto-injected if omitted)' },
        reason: { type: 'STRING', description: 'Reason for cancellation (e.g. customer_requested, wrong_number, duplicate, too_expensive)' }
      },
      required: ['reason']
    }
  },
  add_order_tag: {
    name: 'add_order_tag',
    description: 'Add a custom tag to an order in Shopify.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: { type: 'STRING', description: 'The internal database UUID of the order (optional, auto-injected if omitted)' },
        tag: { type: 'STRING', description: 'The tag to add' }
      },
      required: ['tag']
    }
  },
  schedule_callback: {
    name: 'schedule_callback',
    description: 'Schedule a callback for the customer when they are busy, driving, or request a later call.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'The reason for the callback (e.g. driving, busy, in meeting)' },
        delay_minutes: { type: 'INTEGER', description: 'Delay in minutes until callback (e.g. 15, 30, 60, 180, 1440 for tomorrow)' },
        requestedTime: { type: 'STRING', description: 'Optional human requested time (e.g. kal shaam, tomorrow, 1 hour)' }
      },
      required: ['reason']
    }
  },
  request_human_transfer: {
    name: 'request_human_transfer',
    description: 'Escalate to human support when customer demands a real person, is upset, or disputes order. Notifies human support via WhatsApp and records customer request for prompt follow-up.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Reason for escalating to human support' }
      },
      required: ['reason']
    }
  },
  get_delivery_quote: {
    name: 'get_delivery_quote',
    description: 'Obtain real delivery charges, shipping SLA timeline, and calculate total order price including delivery (e.g. when customer asks "delivery charges?", "shipping kitni hai?", "Karachi delivery?", "iski total price delivery ke sath"). Returns deliveryCharge, currency, estimatedDelivery, and source.',
    parameters: {
      type: 'OBJECT',
      properties: {
        city: { type: 'STRING', description: 'Customer city name if provided (e.g. Karachi, Lahore, Islamabad)' },
        productPrice: { type: 'NUMBER', description: 'Optional product price to calculate total with delivery' }
      }
    }
  },
  search_shopify_products: {
    name: 'search_shopify_products',
    description: 'Search the store Shopify catalog for products when customer asks about products, catalog, or browsing (e.g. "chair protection cover", "leather belt", "kitchen items", "catalog dikhao"). Returns matching product titles, prices, descriptions, and storefront URLs.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Product title, item name, or keywords to search in store catalog' },
        page: { type: 'INTEGER', description: 'Page number for pagination (default: 1)' }
      },
      required: ['query']
    }
  },
  get_shopify_product_details: {
    name: 'get_shopify_product_details',
    description: 'Retrieve authoritative price, availability, variants, description, and direct storefront product URL for a specific single product (e.g. when customer asks "Adhesive wall max ki price batao", "iska link do", "ye available hai").',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Name or keywords of the product (e.g. "Adhesive wall max")' },
        handle: { type: 'STRING', description: 'Product handle if known (e.g. "1-pc-self-adhesive-wall-max")' }
      }
    }
  },
  get_shopify_collections: {
    name: 'get_shopify_collections',
    description: 'Fetch store product collections and their direct storefront links (e.g. when customer asks for "kitchen collection", "mobile accessories", "all products", "catalog link").',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: { type: 'STRING', description: 'Optional category keyword (e.g. "kitchen", "mobile", "women", "all")' }
      }
    }
  },
  get_store_info: {
    name: 'get_store_info',
    description: 'Retrieve general store details including storefront website URL, store name, and delivery policy (e.g. when customer asks "website ka link do", "store ka naam", "delivery charges").',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  end_call: {
    name: 'end_call',
    description: 'Conclude and end the phone call gracefully when the customer or agent says goodbye (e.g. "Allah Hafiz", "Goodbye", "Call cut kar dein", "Thank you bye", "Bas itna hi") and the conversation has naturally concluded.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Reason for ending the call (e.g. customer_goodbye, conversation_completed, customer_requested_disconnect)' }
      },
      required: ['reason']
    }
  }
};

export const tools = Object.values(AITools);

