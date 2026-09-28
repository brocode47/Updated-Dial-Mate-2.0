from app.tools.product_tools import search_products


def product_agent(message, history=None):

    text = message.lower()
    if history:
        for msg in reversed(history):
            if msg.get("role") == "customer":
                text += " " + msg["content"].lower()
                break

    products = []

    if "gift" in text or "wife" in text or "biwi" in text:
        products = search_products(
            category="gift",
            max_price=10000
        )


    if products:

        result = "Jee, aap ke liye ye options available hain:\n"

        for p in products:
            result += f"- {p[0]} - Rs {p[2]}\n"

        result += "Agar aap budget batayein to main aur behtar suggest kar sakta hoon."

        return {
            "message": result
        }


    return {
        "message":
        "Jee bilkul, main aap ki help karta hoon. "
        "Aap apna budget bata dein taake main suitable gift suggest kar sakoon."
    }
