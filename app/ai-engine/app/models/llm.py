from langchain_ollama import ChatOllama
from app.config import AI_MODEL, DIAL_MATE_SYSTEM_PROMPT

llm = ChatOllama(
    model=AI_MODEL,
    temperature=0,
    num_predict=35,
    num_ctx=1024,
    num_thread=4
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
