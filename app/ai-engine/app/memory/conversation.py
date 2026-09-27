class ConversationMemory:

    def __init__(self):
        self.history = []

    def add(self, role, message):
        self.history.append({
            "role": role,
            "message": message
        })

    def get_history(self):
        return self.history


memory = ConversationMemory()
