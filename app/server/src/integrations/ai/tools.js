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
    description: 'Transfer the conversation or escalate to a human agent when customer is upset, disputes order, or demands human manager.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Reason for transferring to human' }
      },
      required: ['reason']
    }
  }
};

export const tools = Object.values(AITools);

