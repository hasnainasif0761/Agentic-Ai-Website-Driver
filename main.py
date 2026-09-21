import os
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agent_brain import process_agent_logic, set_active_sql_context

app = FastAPI()

# Enable CORS for Node.js backend & frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Input Schema definition
class AgentRequest(BaseModel):
    user_text: str = ""
    query: str = ""
    text: str = ""

class ActiveContextRequest(BaseModel):
    host: str
    port: int = 3306
    user: str
    password: str = ""
    selected_dbs: list
    selected_tables: dict

@app.get("/")
def home():
    return {"message": "Python AI Agent Server is running smoothly!"}

# Endpoint handling Node.js requests (Fixes 404 Error)
@app.post("/api/agent")
async def agent_endpoint(request: AgentRequest):
    try:
        # Extract message regardless of parameter key sent by Node.js
        input_text = request.user_text or request.query or request.text
        
        if not input_text:
            return {"reply": "Aap ka message receive nahi hua."}

        response = process_agent_logic(input_text)
        return response
    except Exception as e:
        print(f"[SERVER ERROR]: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Direct Endpoint to update active context via Python
@app.post("/api/update-active-context")
async def update_context(request: ActiveContextRequest):
    try:
        set_active_sql_context(
            host=request.host,
            port=request.port,
            user=request.user,
            password=request.password,
            selected_dbs=request.selected_dbs,
            selected_tables=request.selected_tables
        )
        return {"status": "success", "message": "Context saved successfully!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)