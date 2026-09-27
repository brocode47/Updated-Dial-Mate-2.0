def support_agent(intent, message):

    if intent == "owner_request":

        return {
            "response":
            "Jee, main Dial Mate AI hoon. Main customers ki madad ke liye bana hoon. "
            "Agar aap management ya owner se baat karna chahte hain to main aap ki request note kar sakta hoon."
            ,
            "action": "escalate"
        }


    return {
        "response":
        "Jee, main aap ki madad ke liye hazir hoon. Aap apna masla bata dein.",
        "action": "continue"
    }
