"""Natural language question answering for Kirana store accounts and stock (Phase 3).

Follows strict rules:
1. Gemma parses the question into a StructuredQuery (validated with Pydantic).
2. Plain code runs the query with whitelisted filters/aggregations only.
   NEVER raw SQL execution of model output.
3. Gemma phrases the final response in the user's natural language (Hindi/Marathi/Hinglish/English).
   Validated with Pydantic, with reliable plain-code fallback.
"""

from datetime import date
from difflib import SequenceMatcher
from enum import Enum
import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field
from sqlmodel import Session, select, func

from app.models import (
    CreditEntry,
    CreditType,
    Customer,
    Product,
    ShelfStatus,
    StockEntry,
)
from app.services import gemma
from app.services.ledger import customer_balances, ledger_with_running_balance


class QueryIntent(str, Enum):
    who_owes_more_than = "who_owes_more_than"
    total_udhaar = "total_udhaar"
    customer_balance = "customer_balance"
    items_running_low = "items_running_low"
    top_debtors = "top_debtors"
    unknown = "unknown"


class TimePeriod(str, Enum):
    today = "today"
    this_month = "this_month"
    all_time = "all_time"


class StructuredQuery(BaseModel):
    intent: QueryIntent = Field(description="The detected intent of the user query")
    threshold: Optional[float] = Field(default=None, description="Numeric threshold amount for queries like who owes > X")
    time_period: Optional[TimePeriod] = Field(default=None, description="today, this_month, or all_time")
    customer_name: Optional[str] = Field(default=None, description="Customer name if inquiring about a specific person")
    limit: Optional[int] = Field(default=5, description="Limit count for top debtor queries")
    language: str = Field(default="hi", description="Detected language: hi (Hindi), mr (Marathi), hinglish, or en")
    confidence: Literal["high", "low"] = Field(default="high", description="Confidence in understanding the query")


class PhrasedAnswer(BaseModel):
    answer: str = Field(description="Natural, respectful response in the user's language")


PARSE_PROMPT = """You are the natural language query parser for "HisaabKitaab", an app for Indian kirana (grocery) shopkeepers.
The shopkeeper is asking a question in Hindi, Marathi, Hinglish, or English.

Classify the question into one of the following intents and extract relevant parameters:

1. "who_owes_more_than":
   - When asking which customers owe more than an amount.
   - Examples: "kisne 500 se zyada udhaar liya?", "किसने 500 से अधिक उधार लिया?", "कोणाकडे 1000 पेक्षा जास्त उधारी बाकी आहे?".
   - Set threshold to the numeric amount in rupees (e.g. 500, 1000). Convert Devanagari digits to standard numbers.

2. "total_udhaar":
   - When asking for total credit given or collected across a timeframe.
   - Examples: "aaj ka kul udhaar kitna hai?", "आज कितना उधार दिया?", "या महिन्यात किती उधारी दिली?", "is mahine ka hisaab", "total udhaar".
   - Set time_period to "today" (aaj, today, आता), "this_month" (is mahine, ya mahinyat, this month), or "all_time" (default if unspecified).

3. "customer_balance":
   - When asking about a specific person's khata, hisaab, balance, or pending money.
   - Examples: "Ramesh ka kitna baaki hai?", "रमेश का हिसाब बताओ", "सुरेशचा किती बाकी आहे?", "Priya balance".
   - Set customer_name to the person's name (strip honorifics like 'ji', 'bhau', 'saab', 'cha', 'ka').

4. "items_running_low":
   - When asking about low stock, out of stock, items to reorder, or what goods are running out.
   - Examples: "kaun sa samaan kam hai?", "दुकान में कौन सा सामान खत्म हो रहा है?", "कोणते सामान कमी आहे?", "low stock items".

5. "top_debtors":
   - When asking who owes the most money, biggest debtors, or top udhaar list.
   - Examples: "sabse zyada udhaar kiska hai?", "top 5 debtors kaun hai?", "सर्वात जास्त उधारी कोणाची आहे?".
   - Set limit to the number requested (default 5).

6. "unknown":
   - If the question does not match any of these intents.

Extract the detected language: 'hi' (Hindi), 'mr' (Marathi), 'hinglish' (Hindi in Latin script), or 'en' (English).

User Question: "{question}"
"""

NAME_TRANSLITERATION = {
    "रमेश": "ramesh",
    "सुरेश": "suresh",
    "प्रिया": "priya",
    "अमित": "amit",
    "सुनीता": "sunita",
    "दीपक": "deepak",
    "गणेश": "ganesh",
    "पाटील": "patil",
    "शर्मा": "sharma",
    "शिंदे": "shinde",
    "वर्मा": "verma",
}

COMMON_HONORIFICS = ["ji", "जी", "bhau", "भाऊ", "bhai", "भाई", "saab", "साब", "sahab", "साहब", "का", "की", "के", "चा", "ची", "चे", "कडे"]


def clean_customer_query_name(name: str) -> str:
    cleaned = name.strip()
    for h in COMMON_HONORIFICS:
        cleaned = re.sub(rf"\b{re.escape(h)}\b", "", cleaned, flags=re.IGNORECASE).strip()
    return cleaned


def find_matching_customer(session: Session, shop_id: int, query_name: str) -> Optional[Customer]:
    if not query_name:
        return None
    cleaned = clean_customer_query_name(query_name).lower()
    customers = session.exec(select(Customer).where(Customer.shop_id == shop_id)).all()

    # 1. Exact case-insensitive match
    for c in customers:
        if c.name.lower() == cleaned:
            return c

    # 2. Check transliteration dictionary
    transliterated = NAME_TRANSLITERATION.get(cleaned, cleaned)
    for c in customers:
        if transliterated in c.name.lower() or c.name.lower() in transliterated:
            return c

    # 3. Substring match
    for c in customers:
        if cleaned in c.name.lower() or c.name.lower() in cleaned:
            return c

    # 4. Fuzzy SequenceMatcher match
    best_match = None
    best_score = 0.0
    for c in customers:
        score = SequenceMatcher(None, cleaned, c.name.lower()).ratio()
        if score > best_score and score >= 0.6:
            best_score = score
            best_match = c

    return best_match


# Whitelisted query executions (Plain code, safe, deterministic)

def execute_who_owes_more_than(session: Session, shop_id: int, threshold: Optional[float]) -> dict[str, Any]:
    thresh = float(threshold) if threshold is not None else 0.0
    all_balances = customer_balances(session, shop_id)
    matched = [c for c in all_balances if c["balance"] > thresh]
    return {
        "threshold": thresh,
        "count": len(matched),
        "customers": [
            {"id": c["id"], "name": c["name"], "balance": c["balance"], "phone": c.get("phone")}
            for c in matched
        ],
    }


def execute_total_udhaar(session: Session, shop_id: int, time_period: Optional[TimePeriod]) -> dict[str, Any]:
    today = date.today()
    period = time_period or TimePeriod.today

    query = select(CreditEntry).where(CreditEntry.shop_id == shop_id, CreditEntry.confirmed == True)  # noqa: E712
    if period == TimePeriod.today:
        query = query.where(CreditEntry.entry_date == today)
    elif period == TimePeriod.this_month:
        first_of_month = today.replace(day=1)
        query = query.where(CreditEntry.entry_date >= first_of_month)

    entries = session.exec(query).all()
    total_gave = sum(e.amount for e in entries if e.type == CreditType.gave)
    total_got = sum(e.amount for e in entries if e.type == CreditType.got)
    net_credit = total_gave - total_got

    return {
        "time_period": period.value,
        "total_gave": round(total_gave, 2),
        "total_got": round(total_got, 2),
        "net_credit": round(net_credit, 2),
        "entry_count": len(entries),
    }


def execute_customer_balance(session: Session, shop_id: int, customer_name: Optional[str]) -> dict[str, Any]:
    if not customer_name:
        return {"found": False, "message": "Customer name not specified"}

    cust = find_matching_customer(session, shop_id, customer_name)
    if not cust:
        all_customers = session.exec(select(Customer.name).where(Customer.shop_id == shop_id)).all()
        return {
            "found": False,
            "searched_for": customer_name,
            "message": f"Customer '{customer_name}' not found",
            "available_customers": all_customers[:5],
        }

    ledger_entries = ledger_with_running_balance(session, cust.id)
    current_balance = ledger_entries[-1]["running_balance"] if ledger_entries else 0.0
    recent = [
        {
            "amount": e["amount"],
            "type": e["type"],
            "date": str(e["entry_date"]),
            "raw_text": e.get("raw_text") or "",
        }
        for e in ledger_entries[-3:]
    ]

    return {
        "found": True,
        "customer_id": cust.id,
        "customer_name": cust.name,
        "phone": cust.phone,
        "balance": round(current_balance, 2),
        "recent_entries": recent,
    }


def execute_items_running_low(session: Session, shop_id: int) -> dict[str, Any]:
    products = session.exec(select(Product).where(Product.shop_id == shop_id)).all()
    low_stock_items = []

    for p in products:
        stock_sum = session.exec(
            select(func.coalesce(func.sum(StockEntry.qty_change), 0.0)).where(
                StockEntry.product_id == p.id, StockEntry.confirmed == True  # noqa: E712
            )
        ).one()

        latest_shelf = session.exec(
            select(StockEntry.shelf_status)
            .where(StockEntry.product_id == p.id, StockEntry.shelf_status != None)  # noqa: E711
            .order_by(StockEntry.created_at.desc())
        ).first()

        current_qty = round(float(stock_sum), 2)
        is_low = (current_qty <= p.low_stock_threshold) or (latest_shelf == ShelfStatus.low)

        if is_low:
            low_stock_items.append(
                {
                    "id": p.id,
                    "name": p.name,
                    "current_stock": current_qty,
                    "unit": p.unit,
                    "threshold": p.low_stock_threshold,
                    "shelf_status": latest_shelf.value if latest_shelf else None,
                }
            )

    return {
        "count": len(low_stock_items),
        "items": sorted(low_stock_items, key=lambda x: x["current_stock"]),
    }


def execute_top_debtors(session: Session, shop_id: int, limit: Optional[int]) -> dict[str, Any]:
    lim = limit or 5
    all_balances = customer_balances(session, shop_id)
    debtors = [c for c in all_balances if c["balance"] > 0][:lim]
    return {
        "limit": lim,
        "total_debtors_found": len(debtors),
        "debtors": [
            {"id": c["id"], "name": c["name"], "balance": c["balance"], "phone": c.get("phone")}
            for c in debtors
        ],
    }


def execute_structured_query(session: Session, shop_id: int, q: StructuredQuery) -> dict[str, Any]:
    if q.intent == QueryIntent.who_owes_more_than:
        return execute_who_owes_more_than(session, shop_id, q.threshold)
    elif q.intent == QueryIntent.total_udhaar:
        return execute_total_udhaar(session, shop_id, q.time_period)
    elif q.intent == QueryIntent.customer_balance:
        return execute_customer_balance(session, shop_id, q.customer_name)
    elif q.intent == QueryIntent.items_running_low:
        return execute_items_running_low(session, shop_id)
    elif q.intent == QueryIntent.top_debtors:
        return execute_top_debtors(session, shop_id, q.limit)
    else:
        return {"message": "Unsupported or unrecognized query intent"}


# Fallback phraser in plain code if LLM is unavailable or times out
def fallback_phrase(q: StructuredQuery, data: dict[str, Any]) -> str:
    lang = q.language.lower()
    intent = q.intent

    if intent == QueryIntent.who_owes_more_than:
        custs = data.get("customers", [])
        thresh = data.get("threshold", 0)
        if not custs:
            if "mr" in lang:
                return f"₹{thresh:,.0f} पेक्षा जास्त उधारी असलेला एकही ग्राहक नाही."
            return f"₹{thresh:,.0f} से अधिक बकाया वाला कोई ग्राहक नहीं है।"
        names = ", ".join(f"{c['name']} (₹{c['balance']:,.0f})" for c in custs)
        if "mr" in lang:
            return f"₹{thresh:,.0f} पेक्षा जास्त उधारी असलेले ग्राहक: {names}."
        return f"₹{thresh:,.0f} से ज़्यादा उधार वाले ग्राहक: {names}।"

    elif intent == QueryIntent.total_udhaar:
        gave = data.get("total_gave", 0)
        got = data.get("total_got", 0)
        period = "आज" if data.get("time_period") == "today" else "इस महीने"
        if "mr" in lang:
            period_mr = "आज" if data.get("time_period") == "today" else "या महिन्यात"
            return f"{period_mr} एकूण दिलेली उधारी ₹{gave:,.0f} आणि जमा ₹{got:,.0f} झाली आहे."
        return f"{period} कुल दिया गया उधार ₹{gave:,.0f} और जमा ₹{got:,.0f} हुआ है।"

    elif intent == QueryIntent.customer_balance:
        if not data.get("found"):
            return data.get("message", "Customer not found")
        name = data.get("customer_name")
        bal = data.get("balance", 0)
        if "mr" in lang:
            return f"{name} यांच्याकडे ₹{bal:,.0f} बाकी आहेत."
        return f"{name} का कुल बकाया ₹{bal:,.0f} है।"

    elif intent == QueryIntent.items_running_low:
        items = data.get("items", [])
        if not items:
            if "mr" in lang:
                return "सध्या दुकानात सर्व मालाचा साठा पुरेसा आहे."
            return "दुकान में सभी सामान का स्टॉक अभी ठीक है।"
        item_str = ", ".join(f"{i['name']} ({i['current_stock']} {i['unit']})" for i in items)
        if "mr" in lang:
            return f"कमी साठा असलेले सामान: {item_str}."
        return f"दुकान में यह सामान कम है: {item_str}।"

    elif intent == QueryIntent.top_debtors:
        debtors = data.get("debtors", [])
        if not debtors:
            return "कोई बकाया उधार नहीं है।"
        top_str = ", ".join(f"{d['name']} (₹{d['balance']:,.0f})" for d in debtors)
        if "mr" in lang:
            return f"सर्वात जास्त उधारी असलेले ग्राहक: {top_str}."
        return f"सबसे ज़्यादा उधार वाले ग्राहक: {top_str}।"

    return "कृपया प्रश्न स्पष्ट विचारा / कृपया अपना प्रश्न दोबारा पूछें।"


PHRASE_PROMPT = """You are "HisaabKitaab", an intelligent kirana store voice/chat assistant for Indian shopkeepers.
The shopkeeper asked: "{question}"

The backend executed a structured database query and retrieved this real data:
{data}

Detected Intent: {intent}
Language to reply in: {language}

Instructions:
1. Answer in the requested language:
   - If 'mr' (Marathi): Write in natural, polite Marathi (Devanagari script). Example: "सुरेश पाटील यांच्याकडे ₹3,200 बाकी आहेत."
   - If 'hi' (Hindi): Write in natural, polite Hindi (Devanagari script). Example: "सुरेश पाटिल का कुल ₹3,200 बकाया है।"
   - If 'hinglish': Write in friendly conversational Hinglish. Example: "Ramesh ji ka total ₹1,450 baaki hai."
   - If 'en': Write in polite English.
2. State the numbers accurately according to the data provided. Do NOT invent or change any figures.
3. Be brief, warm, and helpful (1-3 sentences).
"""


def fallback_parse_query(question: str) -> StructuredQuery:
    q = question.lower().strip()
    digits = re.findall(r"\d+", q)

    # 1. Top debtors (superlative: सबसे / सर्वात / top)
    if any(k in q for k in ["sabse zyada", "sabse jyada", "top debtor", "top 5", "sarvat jast", "सर्वात जास्त", "सबसे ज़्यादा", "सबसे ज्यादा", "सबसे अधिक", "बकायेदार", "टॉप"]):
        lim = int(digits[0]) if digits else 5
        lang = "mr" if "सर्वात" in q else "hi"
        return StructuredQuery(intent=QueryIntent.top_debtors, limit=lim, language=lang)

    # 2. Who owes > X (comparative: से ज़्यादा / पेक्षा जास्त)
    if any(k in q for k in ["se zyada", "se jyada", "se adhik", "पेक्षा जास्त", "पेक्षा अधिक", "से ज़्यादा", "से ज्यादा", "से अधिक", "जास्त उधारी", "more than", ">"]):
        thresh = float(digits[0]) if digits else 500.0
        lang = "mr" if any(k in q for k in ["पेक्षा", "उधारी", "कोणाकडे"]) else "hi"
        return StructuredQuery(intent=QueryIntent.who_owes_more_than, threshold=thresh, language=lang)

    # 3. Total udhaar
    if any(k in q for k in ["aaj", "आज", "today"]):
        lang = "mr" if "उधारी" in q and ("दिली" in q or "आज" in q) else "hi"
        return StructuredQuery(intent=QueryIntent.total_udhaar, time_period=TimePeriod.today, language=lang)
    if any(k in q for k in ["mahine", "mahinyat", "महिना", "महीने", "महिने", "महिन्यात", "month"]):
        lang = "mr" if "महिन्यात" in q else "hi"
        return StructuredQuery(intent=QueryIntent.total_udhaar, time_period=TimePeriod.this_month, language=lang)
    if any(k in q for k in ["total udhaar", "kul udhaar", "ekun udhari", "उधारी दी", "उधारी दिली"]):
        lang = "mr" if "एकूण" in q or "दिली" in q else "hi"
        return StructuredQuery(intent=QueryIntent.total_udhaar, time_period=TimePeriod.today, language=lang)

    # 4. Items running low
    if any(k in q for k in ["samaan kam", "stock low", "कम है", "कमी आहे", "माल संपत", "सामान कम", "कमी सामान", "stock"]):
        lang = "mr" if any(k in q for k in ["कमी", "माल", "आहे"]) else "hi"
        return StructuredQuery(intent=QueryIntent.items_running_low, language=lang)

    # 5. Customer balance
    names = ["ramesh", "suresh", "priya", "amit", "sunita", "deepak", "ganesh", "रमेश", "सुरेश", "प्रिया", "अमित", "सुनीता", "दीपक", "गणेश"]
    for n in names:
        if n in q:
            lang = "mr" if any(k in q for k in ["चा", "ची", "चे", "आहे"]) else "hi"
            return StructuredQuery(intent=QueryIntent.customer_balance, customer_name=n, language=lang)

    return StructuredQuery(intent=QueryIntent.unknown, language="hi", confidence="low")


async def process_chat_query(session: Session, shop_id: int, question: str) -> dict[str, Any]:
    """Complete Phase 3 pipeline: Parse question -> Execute structured query -> Phrase answer."""
    question_clean = question.strip()

    # Step 1: Parse user question into strict StructuredQuery
    structured_query = None
    try:
        structured_query = await gemma.generate_json(
            PARSE_PROMPT.format(question=question_clean),
            StructuredQuery,
        )
    except Exception:
        structured_query = None

    if not structured_query or structured_query.intent == QueryIntent.unknown:
        fallback = fallback_parse_query(question_clean)
        if fallback.intent != QueryIntent.unknown or not structured_query:
            structured_query = fallback

    # Step 2: Execute query with pure code against SQLite database
    result_data = execute_structured_query(session, shop_id, structured_query)

    # Step 3: Phrase answer in shopkeeper's language with Gemma
    answer_text = ""
    try:
        phrased = await gemma.generate_json(
            PHRASE_PROMPT.format(
                question=question_clean,
                data=result_data,
                intent=structured_query.intent.value,
                language=structured_query.language,
            ),
            PhrasedAnswer,
        )
        answer_text = phrased.answer
    except Exception:
        # Fall back gracefully to deterministic phrasing
        answer_text = fallback_phrase(structured_query, result_data)

    return {
        "query": question_clean,
        "intent": structured_query.intent.value,
        "structured_query": structured_query.model_dump(),
        "data": result_data,
        "answer": answer_text,
    }
