from fastapi import FastAPI

app = FastAPI(
    title="Dial Mate AI Engine",
    version="1.0.0"
)


@app.get("/")
def home():
    return {
        "status": "running",
        "service": "Dial Mate AI Engine"
    }
