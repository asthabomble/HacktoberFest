"""Chat / Poocho router for conversational questions in Hindi, Marathi, Hinglish (Phase 3)."""

from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.db import get_session, get_shop
from app.services.chat import process_chat_query
from app.services.ledger import customer_summaries

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500, description="Question in Hindi, Marathi, Hinglish, or English")
    language: Optional[str] = Field(default=None, description="Optional preferred language override")


class ChatResponse(BaseModel):
    query: str
    intent: str
    structured_query: dict[str, Any]
    data: dict[str, Any]
    answer: str


SAMPLE_QUESTIONS = [
    {
        "category": "उधार सीमा",
        "lang": "hi",
        "label": "किसने ₹500 से ज़्यादा उधार लिया?",
        "query": "किसने 500 से ज़्यादा उधार लिया है?",
        "intent": "who_owes_more_than",
    },
    {
        "category": "आज का हिसाब",
        "lang": "hi",
        "label": "आज का कुल उधार कितना है?",
        "query": "आज का कुल उधार कितना है?",
        "intent": "total_udhaar",
    },
    {
        "category": "महीने का हिसाब",
        "lang": "hi",
        "label": "इस महीने कितनी उधारी दी गई?",
        "query": "इस महीने कितनी उधारी दी गई?",
        "intent": "total_udhaar",
    },
    {
        "category": "ग्राहक खाता",
        "lang": "hi",
        "label": "रमेश का कितना बाकी है?",
        "query": "रमेश का कितना बाकी है?",
        "intent": "customer_balance",
    },
    {
        "category": "स्टॉक अलर्ट",
        "lang": "hi",
        "label": "दुकान में कौन सा सामान कम है?",
        "query": "दुकान में कौन सा सामान कम है?",
        "intent": "items_running_low",
    },
    {
        "category": "टॉप बकायेदार",
        "lang": "hi",
        "label": "सबसे ज़्यादा उधार वाले 5 लोग कौन हैं?",
        "query": "सबसे ज़्यादा उधार वाले 5 लोग कौन हैं?",
        "intent": "top_debtors",
    },
    {
        "category": "मराठी उधारी",
        "lang": "mr",
        "label": "कोणाकडे ₹1000 पेक्षा जास्त उधारी आहे?",
        "query": "कोणाकडे 1000 पेक्षा जास्त उधारी बाकी आहे?",
        "intent": "who_owes_more_than",
    },
    {
        "category": "मराठी महिना",
        "lang": "mr",
        "label": "या महिन्यात किती उधारी दिली?",
        "query": "या महिन्यात किती उधारी दिली?",
        "intent": "total_udhaar",
    },
    {
        "category": "मराठी ग्राहक",
        "lang": "mr",
        "label": "सुरेशचा किती बाकी आहे?",
        "query": "सुरेशचा किती बाकी आहे?",
        "intent": "customer_balance",
    },
    {
        "category": "Hinglish Stock",
        "lang": "hinglish",
        "label": "Konsa stock low hai aur top debtors kaun?",
        "query": "Konsa stock low chal raha hai aur top debtors kaun hai?",
        "intent": "items_running_low",
    },
]


@router.post("", response_model=ChatResponse)
async def ask_question(req: ChatRequest, session: Session = Depends(get_session)):
    shop = get_shop(session)
    if not shop:
        raise HTTPException(status_code=500, detail="Shop record not initialized")

    result = await process_chat_query(session, shop.id, req.query)
    return result


# Customer-balance questions are filled with this shop's real customers instead of fixed names
BALANCE_TEMPLATES = {
    "hi": ("ग्राहक खाता", "{name} का कितना बाकी है?"),
    "mr": ("मराठी ग्राहक", "{name} यांचा किती बाकी आहे?"),
}


@router.get("/samples")
def get_sample_questions(session: Session = Depends(get_session)):
    """Curated questions in Hindi, Marathi and Hinglish for the UI chips, using real customer names."""
    debtors = [c["name"] for c in customer_summaries(session, get_shop(session).id) if c["balance"] > 0]
    samples = []
    for sample in SAMPLE_QUESTIONS:
        if sample["intent"] != "customer_balance":
            samples.append(sample)
            continue
        if not debtors:
            continue  # no customers yet: skip questions about a specific person
        name = debtors.pop(0)
        category, template = BALANCE_TEMPLATES.get(sample["lang"], BALANCE_TEMPLATES["hi"])
        question = template.format(name=name)
        samples.append({**sample, "category": category, "label": question, "query": question})
    return {"samples": samples}
