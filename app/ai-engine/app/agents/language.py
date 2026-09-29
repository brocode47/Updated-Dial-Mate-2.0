"""
DialMate Language Detection Utility
====================================
Detects whether a customer message is in:
- 'urdu'        (Arabic/Urdu script: e.g. میرا آرڈر کہاں ہے؟)
- 'english'     (English: e.g. Where is my order?)
- 'roman_urdu'  (Roman Urdu: e.g. Mera order kahan hai?)

Rules:
- Never translate messages.
- Match customer language in agent response.
- Common Pakistani greetings like 'hello' / 'hi' / 'aoa' default to Roman Urdu
  ('Assalam o Alaikum...') per Pakistani e-commerce customer support standards.
"""
import re

URDU_SCRIPT_REGEX = re.compile(r'[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]')

# Distinctive Roman Urdu markers and stopwords
ROMAN_URDU_WORDS = {
    "hai", "hain", "mera", "meri", "mere", "kahan", "kaha", "kya", "kyun", "kab",
    "kitna", "kitni", "kitne", "kitnay", "mein", "batao", "bata", "dein", "den",
    "karo", "karein", "chahiye", "krna", "karna", "hoga", "hogi", "shukriya",
    "bohot", "bahut", "pasand", "salam", "aoa", "wapis", "wapas", "mil", "mila",
    "milega", "ayega", "aega", "kon", "kaun", "lena", "lene", "mujhe", "aap",
    "tum", "hum", "walay", "wali", "wala", "theek", "acha", "achi", "kuch",
    "koi", "baat", "shukria", "bhejo", "bhej", "pehle", "karwao", "de", "do",
    "toh", "to", "bhi", "yeh", "ye", "woh", "wo", "ka", "ki", "ke", "ko",
    "se", "par", "pe", "kharab", "masla", "shikayat", "rakhein", "bataiye", "hoon"
}

# Strong English indicators
ENGLISH_STOPWORDS = {
    "where", "is", "my", "order", "what", "how", "much", "the", "price",
    "of", "this", "product", "available", "do", "you", "have", "can", "i",
    "get", "cancel", "return", "policy", "refund", "please", "tell", "me",
    "delivery", "charges", "when", "will", "it", "arrive", "shipping", "time",
    "payment", "methods", "cash", "on", "thank", "thanks", "who", "are",
    "manager", "support", "talk", "to", "human", "agent", "late", "delay",
    "so", "very", "much", "help"
}

# Common conversational openers in Pakistan that should trigger Pakistani Roman Urdu greetings
COMMON_PAKISTANI_GREETINGS = {"hello", "hi", "hey", "aoa", "salam", "assalam"}


def detect_language(text: str) -> str:
    """
    Detect the language of the message: 'urdu', 'english', or 'roman_urdu'.
    """
    if not text or not text.strip():
        return "roman_urdu"

    raw = text.strip()

    # 1. Check for Urdu script
    if URDU_SCRIPT_REGEX.search(raw):
        return "urdu"

    # 2. Tokenize Latin text
    clean_text = re.sub(r'[^\w\s]', ' ', raw.lower())
    tokens = clean_text.split()
    if not tokens:
        return "roman_urdu"

    # Single-word common greeting defaults to Roman Urdu ("Assalam o Alaikum...")
    if len(tokens) == 1 and tokens[0] in COMMON_PAKISTANI_GREETINGS:
        return "roman_urdu"

    roman_urdu_count = sum(1 for w in tokens if w in ROMAN_URDU_WORDS)
    english_count = sum(1 for w in tokens if w in ENGLISH_STOPWORDS)

    # If Roman Urdu markers exist, it's Roman Urdu
    if roman_urdu_count > 0:
        return "roman_urdu"

    # If English words dominate and no Roman Urdu words
    if english_count > 0 and roman_urdu_count == 0:
        return "english"

    # Default to roman_urdu for Pakistani e-commerce context
    return "roman_urdu"
