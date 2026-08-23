import smtplib
import ssl
import os
from email.message import EmailMessage

def send_owner_email(phone: str, course_name: str):
    try:
        sender_email = os.getenv("OWNER_EMAIL")
        password = os.getenv("GMAIL_APP_PASSWORD")

        msg = EmailMessage()
        msg.set_content(f"New Lead Alert!\nPhone: {phone}\nCourse Interested: {course_name}")
        msg["Subject"] = "🔥 New Student Registration Lead!"
        msg["From"] = sender_email
        msg["To"] = sender_email

        # SSL certificate bypass for development
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
            server.login(sender_email, password)
            server.send_message(msg)
        print("[Python Agent] Email sent to Owner successfully!")
    except Exception as e:
        print(f"[Python Agent] Email Error: {e}")