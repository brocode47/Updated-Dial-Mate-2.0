"""
DialMate Reusable Response Templates
====================================
Zero-latency templates for Pakistani e-commerce customer support.
Supports:
- Roman Urdu
- Urdu (نستعلیق / عربی رسم الخط)
- English

Tone: Friendly, natural, concise (1-3 sentences), professional, non-robotic.
Safety: Never invent information, never claim order actions without DB confirmation.
"""

TEMPLATES = {
    # ----------------------------------------------------
    # Greetings & Closings
    # ----------------------------------------------------
    "greeting": {
        "roman_urdu": "Assalam o Alaikum! Main Dial Mate AI hoon. Main aap ki kya madad kar sakta hoon?",
        "urdu": "السلام علیکم! میں ڈائل میٹ اے آئی ہوں۔ فرمائیے میں آپ کی کیا مدد کر سکتا ہوں؟",
        "english": "Hello and welcome! I am Dial Mate AI. How may I assist you today?"
    },
    "gratitude_closing": {
        "roman_urdu": "Aap ka bohot shukriya! Agar mazeed koi madad chahiye ho to zaroor batayein. Allah Hafiz!",
        "urdu": "آپ کا بہت شکریہ! اگر مزید کوئی رہنمائی درکار ہو تو ضرور بتائیے گا۔ اللہ حافظ!",
        "english": "You're very welcome! Please feel free to reach out if you have any more questions. Have a wonderful day!"
    },

    # ----------------------------------------------------
    # Product Inquiries (Safety: Never invent stock/price/specs)
    # ----------------------------------------------------
    "product_availability": {
        "roman_urdu": "Jee, hamare paas stock daily update hota hai. Aap baraye meherbani product ka naam ya code bata dein taake main inventory mein check kar ke confirm kar sakoon.",
        "urdu": "جی، ہمارا اسٹاک روزانہ اپڈیٹ ہوتا ہے۔ برائے مہربانی پراڈکٹ کا نام یا کوڈ بتا دیں تاکہ میں انوینٹری میں دیکھ کر تصدیق کر سکوں۔",
        "english": "Yes, our stock is updated daily. Please share the product name or item code so I can verify its availability for you."
    },
    "price_inquiry": {
        "roman_urdu": "Jee bilkul, hamari tamam products ki qeematein market se munasib hain. Aap kis product ki price janna chahte hain? Baraye meherbani naam bata dein.",
        "urdu": "جی بالکل، ہماری تمام پراڈکٹس مناسب قیمتوں پر دستیاب ہیں۔ آپ کس پراڈکٹ کی قیمت معلوم کرنا چاہتے ہیں؟ براہ کرم نام بتا دیں۔",
        "english": "Certainly! We offer very competitive prices. Which specific product's price would you like to know? Please share its name."
    },
    "product_details": {
        "roman_urdu": "Jee zaroor, hamari har product premium quality aur guaranteed hoti hai. Aap kis product ke features ya details janna chahte hain? Naam share karein.",
        "urdu": "جی ضرور، ہماری ہر پراڈکٹ معیاری اور تصدیق شدہ ہوتی ہے۔ آپ کس پراڈکٹ کے بارے میں تفصیلات جاننا چاہتے ہیں؟ نام بتائیے۔",
        "english": "Certainly! All our products are high quality and thoroughly checked. Which item's specifications or details would you like to know?"
    },
    "size_color_inquiry": {
        "roman_urdu": "Jee, mukhtalif products mein standard sizes aur multiple colors available hotay hain. Aap kis product ke size ya color options check karna chahte hain?",
        "urdu": "جی، مختلف اشیاء میں مختلف سائزز اور رنگ دستیاب ہیں۔ آپ کس پراڈکٹ کے سائز یا رنگوں کے بارے میں معلومات چاہتے ہیں؟",
        "english": "Yes, we have multiple size and color options available depending on the item. Which product would you like to check options for?"
    },
    "product_recommendation_ask": {
        "roman_urdu": "Jee bilkul, main aap ki help karta hoon. Aap bata dein gift kis ke liye hai aur aap ka budget kya hai, taake main behtar suggestion de sakoon.",
        "urdu": "جی بالکل، میں آپ کی مدد کرتا ہوں۔ آپ بتا دیں کہ گفٹ کس کے لیے ہے اور آپ کا بجٹ کیا ہے، تاکہ میں بہتر مشورہ دے سکوں۔",
        "english": "I'd be delighted to assist! Could you please share who the gift is for and your approximate budget so I can recommend the best options?"
    },

    # ----------------------------------------------------
    # Order & Delivery Flows
    # ----------------------------------------------------
    "order_not_found": {
        "roman_urdu": "Jee, mujhe aap ka order record nahi mil raha. Baraye meherbani apna Order ID ya registered phone number share karein.",
        "urdu": "جی، مجھے آپ کے آرڈر کا ریکارڈ نہیں مل رہا۔ برائے مہربانی اپنا آرڈر نمبر یا رجسٹرڈ فون نمبر فراہم کریں۔",
        "english": "I couldn't locate an order with those details. Please provide your Order ID or registered phone number so I can look it up."
    },
    "order_cancel_ask_id": {
        "roman_urdu": "Aap ka order cancel karne ke liye baraye meherbani apna Order ID share kar dein taake main system mein status check kar ke cancel kar sakoon.",
        "urdu": "آرڈر منسوخ کرنے کے لیے برائے مہربانی اپنا آرڈر نمبر بتا دیں تاکہ میں سسٹم میں دیکھ کر کینسل کر سکوں۔",
        "english": "To cancel your order, please provide your Order ID so I can verify its status and proceed with cancellation."
    },
    "order_cancelled_success": {
        "roman_urdu": "Theek hai, aap ka order {order_id} cancel kar diya gaya hai.",
        "urdu": "آپ کا آرڈر {order_id} کامیابی سے منسوخ کر دیا گیا ہے۔",
        "english": "Your order {order_id} has been successfully cancelled."
    },
    "late_order_complaint": {
        "roman_urdu": "Humein intehai afsos hai ke aap ka order late hua. Main ne aap ki complaint note kar li hai aur courier team ko urgent follow-up ke liye escalate kar raha hoon. Baraye meherbani apna Order ID share karein.",
        "urdu": "ہمیں معذرت ہے کہ آپ کے آرڈر میں تاخیر ہوئی۔ میں نے آپ کی شکایت درج کر لی ہے اور کوریئر ٹیم کو فوری ترسیل کی ہدایت کر رہا ہوں۔ براہ کرم اپنا آرڈر نمبر بتا دیں۔",
        "english": "We sincerely apologize for the delay. I have registered your complaint and escalated it to our courier partner for urgent delivery. Please share your Order ID."
    },
    "delivery_time": {
        "roman_urdu": "Hamari standard delivery Karachi, Lahore aur Islamabad mein 2 se 3 working days, aur baqi tamam shehron mein 3 se 5 working days mein ho jati hai.",
        "urdu": "ہماری معیاری ترسیل کراچی، لاہور اور اسلام آباد میں 2 سے 3 کام کے دنوں میں اور باقی شہروں میں 3 سے 5 دنوں میں ہو جاتی ہے۔",
        "english": "Our standard delivery takes 2 to 3 business days for major cities (Karachi, Lahore, Islamabad) and 3 to 5 business days for other cities across Pakistan."
    },
    "shipping_info": {
        "roman_urdu": "Hamare delivery charges standard shipping ke liye Rs 200 hain, aur Rs 3,000 se zayed ke orders par Delivery bilkul Free hai. Hum TCS, Leopards aur Trax se delivery karte hain.",
        "urdu": "معیاری ڈیلیوری چارجز 200 روپے ہیں، جبکہ 3000 روپے سے زائد کے آرڈرز پر ڈیلیوری بالکل مفت ہے۔ ہم TCS، Leopards اور Trax کے ذریعے ترسیل کرتے ہیں۔",
        "english": "Standard shipping is Rs 200 nationwide, and delivery is completely FREE on orders over Rs 3,000. We ship securely via TCS, Leopards, and Trax."
    },

    # ----------------------------------------------------
    # Payment & Policies
    # ----------------------------------------------------
    "payment_methods": {
        "roman_urdu": "Hum poore Pakistan mein Cash on Delivery (COD) offer karte hain. Iske ilawa aap JazzCash, EasyPaisa ya Online Bank Transfer ke zariye bhi payment kar sakte hain.",
        "urdu": "ہم پورے پاکستان میں کیش آن ڈیلیوری (COD) فراہم کرتے ہیں۔ اس کے علاوہ آپ جاز کیش، ایزی پیسہ یا بینک ٹرانسفر کے ذریعے بھی ادائیگی کر سکتے ہیں۔",
        "english": "We offer Cash on Delivery (COD) across Pakistan. Additionally, we accept JazzCash, EasyPaisa, and Direct Bank Transfers."
    },
    "return_exchange": {
        "roman_urdu": "Hamari 7-day hassle-free return aur exchange policy hai. Agar product mein koi kharabi ya size issue ho to aap delivery ke 7 din ke andar asani se exchange karwa sakte hain.",
        "urdu": "ہماری 7 دن کی آسان ریٹرن اور تبدیل کرنے کی پالیسی ہے۔ اگر پراڈکٹ میں کوئی مسئلہ ہو تو آپ ڈیلیوری کے 7 دن کے اندر ہم سے رابطہ کر کے تبدیل کروا سکتے ہیں۔",
        "english": "We have a hassle-free 7-day return and exchange policy. If there is any defect or issue, you can easily exchange the item within 7 days of delivery."
    },
    "refund_request": {
        "roman_urdu": "Refund ke liye returned product receive aur inspect hone ke baad 3 se 5 working days mein aap ki payment JazzCash, EasyPaisa ya Bank Account mein transfer kar di jati hai.",
        "urdu": "ریفنڈ کی رقم واپس شدہ پراڈکٹ موصول اور چیک ہونے کے بعد 3 سے 5 کام کے دنوں میں آپ کے جاز کیش، ایزی پیسہ یا بینک اکاؤنٹ میں بھیج دی جاتی ہے۔",
        "english": "Once the returned parcel is received and inspected, refunds are processed within 3 to 5 business days directly to your JazzCash, EasyPaisa, or bank account."
    },

    # ----------------------------------------------------
    # Human Escalation (Preserves exact 'management ya owner' phrasing for Test F)
    # ----------------------------------------------------
    "human_agent_request": {
        "roman_urdu": "Jee, main Dial Mate AI hoon. Main customers ki madad ke liye bana hoon. Agar aap management ya owner se baat karna chahte hain to main aap ki request note kar sakta hoon aur hamari team jald rabta karegi.",
        "urdu": "جی، میں ڈائل میٹ اے آئی ہوں۔ میں آپ کی درخواست نوٹ کر کے مینیجر یا ٹیم کو فارورڈ کر رہا ہوں۔ جلد ہی ہماری ٹیم کا نمائندہ آپ سے رابطہ کرے گا۔",
        "english": "I am Dial Mate AI. If you would like to speak with management or our team, I have logged your request and our representative will connect with you shortly."
    },

    # ----------------------------------------------------
    # Fallback
    # ----------------------------------------------------
    "unknown_query": {
        "roman_urdu": "Jee, main aap ka sawal theek se samajh nahi saka. Kya aap thori mazeed wazahat kar sakte hain taake main behtar madad kar sakoon?",
        "urdu": "معذرت، میں آپ کا سوال پوری طرح سمجھ نہیں پایا۔ برائے مہربانی تھوڑی مزید وضاحت فرما دیں تاکہ میں بہتر رہنمائی کر سکوں۔",
        "english": "I'm sorry, I didn't quite catch that. Could you please provide a few more details so I can assist you accurately?"
    }
}


def get_template(intent: str, lang: str = "roman_urdu", **kwargs) -> str:
    """Retrieve template matching intent and language, formatting with kwargs."""
    intent_data = TEMPLATES.get(intent)
    if not intent_data:
        intent_data = TEMPLATES["unknown_query"]

    text = intent_data.get(lang) or intent_data.get("roman_urdu") or ""
    if kwargs:
        try:
            return text.format(**kwargs)
        except Exception:
            return text
    return text
