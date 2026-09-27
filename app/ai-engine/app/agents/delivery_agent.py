from app.tools.delivery import get_delivery_status


def delivery_agent(order_id):

    result = get_delivery_status(order_id)

    return {
        "message": f"Jee, aap ke order {result['order_id']} ka status hai: {result['status']}"
    }
