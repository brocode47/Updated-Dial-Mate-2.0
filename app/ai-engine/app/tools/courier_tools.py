def get_courier_status(tracking_number):

    # Later connect TCS / Leopards / Trax API here

    if not tracking_number:
        return None

    return {
        "status": "In Transit",
        "location": "Lahore Warehouse",
        "expected_delivery": "2-3 days"
    }
