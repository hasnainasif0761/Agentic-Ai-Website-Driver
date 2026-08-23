from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import os

load_dotenv()

from agent_brain import process_agent_logic

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Temporary session memory
user_sessions = {}

class UserInput(BaseModel):
    user_id: str
    text: str

@app.post("/api/agent")
def handle_agent_request(data: UserInput):
    if data.user_id not in user_sessions:
        user_sessions[data.user_id] = {"step": "start"}

    session = user_sessions[data.user_id]
    result = process_agent_logic(data.text, session)
    return result

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)