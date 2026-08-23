import requests
import os
import re

def send_whatsapp_form(phone: str, course_name: str):
    try:
        # Clean phone number to international format 923...
        clean_phone = re.sub(r'\D', '', phone)
        if clean_phone.startswith('0'):
            clean_phone = '92' + clean_phone[1:]

        phone_id = os.getenv("WHATSAPP_PHONE_ID")
        token = os.getenv("WHATSAPP_TOKEN")

        url = f"https://graph.facebook.com/v18.0/{phone_id}/messages"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        data = {
            "messaging_product": "whatsapp",
            "to": clean_phone,
            "type": "text",
            "text": {
                "body": f"Welcome to Huzaifa Institute!\n\nAapne {course_name} course ke liye enquiry ki thi. Registration form link: https://huzaifainstitute.com/enroll"
            }
        }

        response = requests.post(url, json=data, headers=headers)
        print(f"[Python Agent] WhatsApp Response: {response.json()}")
    except Exception as e:
        print(f"[Python Agent] WhatsApp Error: {e}")