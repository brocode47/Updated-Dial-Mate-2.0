def faq_agent(message):

    text = message.lower()


    # Simple identity question only
    if (
        text.strip() in [
            "tum kon ho",
            "who are you",
            "aap kon ho",
            "what are you"
        ]
    ):
        return (
            "Main Dial Mate AI hoon. "
            "Main customers ki madad ke liye bana hoon."
        )


    # Greeting
    if text in [
        "hello",
        "hi",
        "salam",
        "assalam o alaikum",
        "aoa"
    ]:
        return (
            "Assalam o Alaikum. "
            "Main Dial Mate AI hoon. "
            "Aap batayein main aap ki kya help kar sakta hoon."
        )


    return None
