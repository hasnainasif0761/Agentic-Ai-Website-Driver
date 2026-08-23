from datetime import datetime

# Enrollment Data Structure Format
def enrollment_helper(phone: str, course_name: str) -> dict:
    return {
        "phone": phone,
        "courseName": course_name,
        "status": "pending",
        "createdAt": datetime.utcnow()
    }

# Course Response Format
def course_helper(course) -> dict:
    return {
        "id": str(course["_id"]),
        "name": course.get("name", ""),
        "duration": course.get("duration", ""),
        "isAvailable": course.get("isAvailable", True)
    }