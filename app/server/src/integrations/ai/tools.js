export const AITools = {
  get_order: {
    name: 'get_order',
    description: 'Fetch the latest status and details of an order from Shopify.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: { type: 'STRING', description: 'The Shopify internal ID of the order' }
      },
      required: ['orderId']
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
    description: 'Confirm an order and tag it as confirmed in Shopify.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: { type: 'STRING', description: 'The Shopify internal ID of the order' }
      },
      required: ['orderId']
    }
  },
  cancel_order: {
    name: 'cancel_order',
    description: 'Cancel an order in Shopify if the customer requests it.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: { type: 'STRING', description: 'The Shopify internal ID of the order' },
        reason: { type: 'STRING', description: 'Reason for cancellation (e.g. customer, inventory, fraud, declined, other)' }
      },
      required: ['orderId', 'reason']
    }
  },
  add_order_tag: {
    name: 'add_order_tag',
    description: 'Add a custom tag to an order in Shopify.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: { type: 'STRING', description: 'The Shopify internal ID of the order' },
        tag: { type: 'STRING', description: 'The tag to add' }
      },
      required: ['orderId', 'tag']
    }
  },
  schedule_callback: {
    name: 'schedule_callback',
    description: 'Schedule a callback for the customer.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'The reason for the callback' },
        requestedTime: { type: 'STRING', description: 'Requested time (ISO format) if specified by customer' }
      },
      required: ['reason']
    }
  },
  request_human_transfer: {
    name: 'request_human_transfer',
    description: 'Transfer the conversation to a human agent.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Reason for transferring to human' }
      },
      required: ['reason']
    }
  }
};
