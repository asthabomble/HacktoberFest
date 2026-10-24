"""WhatsApp payment reminders for HisaabKitaab.

Drafts polite payment reminders in the customer's preferred language using Gemma,
with robust multilingual fallback templates and Indian phone number normalization.
"""

import re
import urllib.parse
from typing import Optional

from app.services import gemma

LANGUAGE_NAMES = {
    "hi": "Hindi",
    "mr": "Marathi",
    "en": "English",
}

FALLBACK_TEMPLATES = {
    "hi": "नमस्ते {name} जी, आपके ₹{amount} का हिसाब बाकी है। कृपया समय मिलने पर भुगतान कर दीजिए। धन्यवाद!",
    "mr": "नमस्कार {name} जी, आपले ₹{amount} चे बिल बाकी आहे. कृपया सवडीनुसार जमा करावे. धन्यवाद!",
    "en": "Namaste {name} ji, a gentle reminder that your pending balance of ₹{amount} is due. Please clear it when convenient. Thank you!",
}


def normalize_indian_phone(phone: Optional[str]) -> Optional[str]:
    """Normalize Indian phone numbers to country code 91.

    Valid Indian mobile numbers are 10 digits starting with 6, 7, 8, or 9.
    Accepts:
    - 9876543210 -> 919876543210
    - +91 98765 43210 -> 919876543210
    - 09876543210 -> 919876543210
    - 919876543210 -> 919876543210
    Returns None if missing or not a valid Indian mobile number.
    """
    if not phone:
        return None
    cleaned = re.sub(r"\D", "", str(phone))
    if not cleaned:
        return None

    # Strip leading 0 if 11 digits
    if len(cleaned) == 11 and cleaned.startswith("0"):
        cleaned = cleaned[1:]

    # If 12 digits starting with 91
    if len(cleaned) == 12 and cleaned.startswith("91"):
        local = cleaned[2:]
        if re.match(r"^[6-9]\d{9}$", local):
            return cleaned
        return None

    # If 10 digits starting with 6-9
    if len(cleaned) == 10 and re.match(r"^[6-9]\d{9}$", cleaned):
        return f"91{cleaned}"

    return None


def build_whatsapp_url(phone: Optional[str], message: str) -> Optional[str]:
    """Generate a WhatsApp click-to-chat URL with correctly encoded text."""
    normalized = normalize_indian_phone(phone)
    encoded = urllib.parse.quote(message)
    if normalized:
        return f"https://wa.me/{normalized}?text={encoded}"
    return None


def get_fallback_reminder(name: str, amount: float, language: str = "hi") -> str:
    lang = language.lower() if language else "hi"
    template = FALLBACK_TEMPLATES.get(lang, FALLBACK_TEMPLATES["hi"])
    formatted_amount = f"{amount:,.2f}".rstrip("0").rstrip(".")
    return template.format(name=name, amount=formatted_amount)


async def draft_reminder_message(name: str, amount: float, language: str = "hi") -> tuple[str, bool]:
    """Draft a polite reminder via Gemma, falling back to template on failure.

    Returns (message_text, is_fallback).
    """
    lang_code = language.lower() if language else "hi"
    lang_name = LANGUAGE_NAMES.get(lang_code, "Hindi")
    formatted_amount = f"{amount:,.2f}".rstrip("0").rstrip(".")

    prompt = (
        "You are an assistant helping an Indian small kirana shop owner send a polite WhatsApp payment reminder to a customer.\n"
        f"Customer display name: {name}\n"
        f"Outstanding balance: ₹{formatted_amount}\n"
        f"Language to write in: {lang_name}\n\n"
        "Instructions:\n"
        f"- Write a short (1-2 sentences), warm, and polite payment reminder addressed to {name}.\n"
        f"- Clearly mention the outstanding amount of ₹{formatted_amount}.\n"
        "- Use respectful terms (like 'ji', 'namaste', 'dhanyavaad').\n"
        "- Do NOT threaten, sound aggressive, or add legal disclaimers.\n"
        "- Reply with ONLY the message text. Do not add quotes, explanations, or headings."
    )

    try:
        draft = await gemma.generate_text(prompt)
        text = draft.strip().strip('"').strip("'")
        if text and len(text) >= 10:
            return text, False
    except Exception:
        pass

    return get_fallback_reminder(name, amount, lang_code), True
