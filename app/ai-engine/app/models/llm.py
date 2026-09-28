from langchain_ollama import ChatOllama
from app.config import AI_MODEL, RESPONSE_MODEL, DIAL_MATE_SYSTEM_PROMPT

# Response LLM — used by agents for generating customer-facing text
# Higher num_predict for natural language, standard context window
llm = ChatOllama(
    model=RESPONSE_MODEL,
    temperature=0,
    num_predict=150,
    num_ctx=1024,
    num_thread=4,
)

# Routing LLM — used ONLY by supervisor for intent classification
# Minimal num_predict (JSON is ~60 tokens), small context, JSON mode
routing_llm = ChatOllama(
    model=AI_MODEL,
    temperature=0,
    num_predict=60,
    num_ctx=512,
    num_thread=4,
    format="json",
)

def ask_ai(message):

    system_prompt = DIAL_MATE_SYSTEM_PROMPT + """

Important:
- Never say "main bana hoon".
- Use natural Pakistani Roman Urdu.
- Do not use Hindi style grammar.
- Keep answers short.
- If asked identity questions, reply:
"Main Dial Mate AI hoon. Main customers ki madad ke liye bana hoon."
"""

    response = llm.invoke(
        [
            ("system", system_prompt),
            ("human", message)
        ]
    )

    return response.content
