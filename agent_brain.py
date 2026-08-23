import os
import re
import json
import threading
from google import genai
from google.genai import types
from database import courses_col, enrollments_col
from models.schemas import enrollment_helper
from services.email_service import send_owner_email
from services.whatsapp import send_whatsapp_form

# Gemini Client Setup
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client_ai = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

def process_agent_logic(user_text: str, session: dict) -> dict:
    text = user_text.strip()
    
    # 1. Phone Number Detection & Lead Generation Rule
    phone_match = re.search(r'\d{10,11}', text)
    if phone_match or session.get('step') == 'awaiting_phone':
        phone = phone_match.group(0) if phone_match else re.sub(r'\D', '', text)

        if len(phone) >= 10:
            session['step'] = 'completed'
            course = session.get('last_course', 'Web Development')

            # DB Save
            new_lead = enrollment_helper(phone, course)
            enrollments_col.insert_one(new_lead)

            # Trigger Email Alerts
            threading.Thread(target=send_owner_email, args=(phone, course)).start()

            # Trigger WhatsApp Automation (10 sec delay)
            threading.Timer(10.0, send_whatsapp_form, args=(phone, course)).start()

            return {
                "reply": "Shukriya! Aapka registration process complete ho gaya hai. 10 seconds mein aapko WhatsApp par registration form mil jayega. Kya aapka koi aur sawal hai?",
                "step": "completed"
            }

    # 2. Database se Fresh Courses ki Details Fetch Karein
    available_courses = list(courses_col.find({}, {"_id": 0}))
    courses_info = json.dumps(available_courses) if available_courses else "Web Development (4 months), App Development (3 months), AI Agentic Development (6 months)"

    # 3. System Prompt (AI Training / Knowledge Base)
    system_instruction = f"""
    Aap 'Huzaifa Institute' ke ek boht hi friendly, professional aur smart AI Receptionist hain.
    Aapka naam 'Huzaifa AI' hai.
    Aapko natural Roman Urdu (ya Hindi-English mixed) mein baat karni hai jaise Pakistan/India mein log aam tor par chat/voice par karte hain.

    INSTITUTE KNOWLEDGE BASE:
    - Institute Name: Huzaifa Institute
    - Location / Address: Main Campus Block 5, Gulshan-e-Iqbal, Karachi. (Google Maps par search kar sakte hain).
    - Available Courses Data from Database: {courses_info}
    - Admission Process: Jab user kisi course mein interest dikhaye ya enroll hona chahe, toh unse politely unka WhatsApp phone number maangein taake hum unhe form bhej sakein.

    RULES FOR RESPONSE:
    1. Agar user greeting kare (hello, salam), toh warm welcome karein aur puchein ke aap unki kya madad kar sakte hain.
    2. User ke har sawal ka point-to-point aur natural jawab dein. Static/repetitive baatein na karein.
    3. Agar user course join karna chahe, toh unko bolein ke "Boht zabardast! Apka 11 digits ka WhatsApp number share kar dein taake hum registration details bhej sakein."
    4. Apne jawabaat ko zyada lamba na karein (maximum 2-3 short sentences), kyunki yeh voice agent hai taake sunne mein aasan ho.
    """

    # 4. Smart Gemini AI Call
    if client_ai:
        try:
            response = client_ai.models.generate_content(
                model='gemini-2.5-flash',
                contents=f"User History/Step: {session.get('step', 'start')}\nUser Said: {text}",
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.7,
                )
            )
            reply = response.text.strip()
            
            # Smart context tracking
            if "number" in reply.lower() or "whatsapp" in reply.lower():
                session['step'] = 'awaiting_phone'

            return {
                "reply": reply,
                "step": session.get('step', 'active')
            }
        except Exception as e:
            print(f"[Gemini AI Error]: {e}")

    # Fallback response
    return {
        "reply": "Ji, main aapki Huzaifa Institute ke baare mein kya madad kar sakta hoon?",
        "step": session.get('step', 'start')
    }