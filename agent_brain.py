import os
import json
import re
import threading
import mysql.connector
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
CONFIG_FILE = "active_sql_context.json"

if GROQ_API_KEY:
    print("[INIT] Groq API Key successfully detected.")
    client_ai = Groq(api_key=GROQ_API_KEY)
else:
    print("[ERROR] GROQ_API_KEY is missing in .env file!")
    client_ai = None

# Save context to persistent JSON file
def set_active_sql_context(host, port, user, password, selected_dbs, selected_tables):
    config_data = {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "selected_dbs": selected_dbs,
        "selected_tables": selected_tables
    }
    with open(CONFIG_FILE, "w") as f:
        json.dump(config_data, f, indent=4)
    print(f"[ACTIVE CONTEXT SAVED] DBs: {selected_dbs}, Tables: {selected_tables}")

# Read active context dynamically
def load_active_sql_context():
    if not os.path.exists(CONFIG_FILE):
        return {
            "host": "", "port": 3306, "user": "", "password": "",
            "selected_dbs": [], "selected_tables": {}
        }
    try:
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"[CONFIG LOAD ERROR]: {e}")
        return {
            "host": "", "port": 3306, "user": "", "password": "",
            "selected_dbs": [], "selected_tables": {}
        }

def get_db_data_and_schema():
    """Reads saved configuration and fetches schema & top 5 rows dynamically"""
    config = load_active_sql_context()
    
    if not config["host"] or not config["selected_dbs"]:
        return "Abhi koi MySQL Database select/train nahi kiya gaya dashboard se."

    context_info = []
    
    try:
        for db in config["selected_dbs"]:
            context_info.append(f"\nDATABASE: {db}")
            tables = config["selected_tables"].get(db, [])
            
            if not tables:
                context_info.append("  (Poora database selection active hai, lekin koi specific table check nahi hai)")
                continue

            conn = mysql.connector.connect(
                host=config["host"],
                port=config["port"],
                user=config["user"],
                password=config["password"],
                database=db
            )
            cursor = conn.cursor(dictionary=True)
            
            for tbl in tables:
                # 1. Fetch Columns
                cursor.execute(f"DESCRIBE `{tbl}`;")
                cols = [row['Field'] for row in cursor.fetchall()]
                context_info.append(f"  - Table '{tbl}' Columns: {', '.join(cols)}")
                
                # 2. Fetch Sample Data Rows
                cursor.execute(f"SELECT * FROM `{tbl}` LIMIT 5;")
                rows = cursor.fetchall()
                if rows:
                    context_info.append(f"    Data Samples (Rows): {rows}")
                else:
                    context_info.append("    Data Samples: (Table empty hai)")
                
            conn.close()
    except Exception as e:
        print(f"[SQL FETCH ERROR]: {e}")
        return f"Database details fetch karne mein error aaya: {str(e)}"

    return "\n".join(context_info)

def clean_response(text: str) -> str:
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    if "Draft:" in text:
        text = text.split("Draft:")[-1]
    elif "Response:" in text:
        text = text.split("Response:")[-1]
    elif "Final Output:" in text:
        text = text.split("Final Output:")[-1]
    
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    cleaned_lines = [line for line in lines if not (line.startswith('-') or line.startswith('*') or 'Check constraints' in line or 'Acknowledge' in line)]
        
    final_text = " ".join(cleaned_lines) if cleaned_lines else text
    return final_text.replace('"', '').replace('**', '').strip()

def process_agent_logic(user_text: str, session: dict = None) -> dict:
    text = user_text.strip()
    
    # Live Active Schema + Sample Data Injection
    active_context_str = get_db_data_and_schema()

    system_instruction = f"""
    You are 'Huzaifa Institute' Smart AI Data Assistant.
    Respond in friendly Roman Urdu / English.

    CURRENT CHECKED DATABASES & TABLES DATA FROM DASHBOARD:
    {active_context_str}

    STRICT OUTPUT FORMAT RULES:
    1. Direct Output ONLY. DO NOT write internal thinking, planning steps, bullet points, or analysis.
    2. Respond directly to the user in 2-3 short, friendly sentences.
    3. If asked about active databases/tables/data, answer based on the provided context above.
    """

    if client_ai:
        try:
            chat_completion = client_ai.chat.completions.create(
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": text}
                ],
                model="openai/gpt-oss-20b",
                temperature=0.5,
                max_tokens=200
            )
            
            raw_reply = chat_completion.choices[0].message.content.strip()
            reply = clean_response(raw_reply)
            return {"reply": reply, "step": "active"}

        except Exception as e:
            print(f"[Groq Execution Error]: {e}")
            return {"reply": f"Groq Query Error: {str(e)}", "step": "active"}

    return {"reply": "GROQ_API_KEY configure nahi hui hai (.env file check karein)."}