export const AITools = {
  get_order_status: {
    name: 'get_order_status',
    description: 'Fetch the latest status and details of an order from Shopify.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: {
          type: 'STRING',
          description: 'The internal ID of the order'
        }
      },
      required: ['orderId']
    }
  },
  confirm_cod_order: {
    name: 'confirm_cod_order',
    description: 'Confirm a Cash on Delivery order and tag it as confirmed in Shopify.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: {
          type: 'STRING',
          description: 'The internal ID of the order'
        }
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
        orderId: {
          type: 'STRING',
          description: 'The internal ID of the order'
        },
        reason: {
          type: 'STRING',
          description: 'Reason for cancellation (e.g. customer_changed_mind, found_better_price)'
        }
      },
      required: ['orderId', 'reason']
    }
  },
  transfer_to_human: {
    name: 'transfer_to_human',
    description: 'Transfer the conversation to a human agent when the AI cannot resolve the issue.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: {
          type: 'STRING',
          description: 'Reason for transferring to human'
        }
      },
      required: ['reason']
    }
  }
};
