"""Automated test script for Phase 3: Ask in Hindi / Marathi / Hinglish (10 sample questions).

Tests:
1. Query classification into whitelisted intent
2. Safe database execution with plain code (NO raw SQL)
3. Phrased response in user's natural language
"""

import asyncio
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from sqlmodel import Session
from app.db import engine, get_shop
from app.services.chat import process_chat_query
from scripts.seed_demo import seed

QUESTIONS = [
    {
        "id": 1,
        "lang": "Hindi",
        "question": "किसने 500 से ज़्यादा उधार लिया है?",
        "expected_intent": "who_owes_more_than",
        "verify_data": lambda d: d.get("count", 0) > 0 and d.get("threshold") == 500,
    },
    {
        "id": 2,
        "lang": "Hindi",
        "question": "आज का कुल उधार कितना है?",
        "expected_intent": "total_udhaar",
        "verify_data": lambda d: d.get("time_period") == "today" and "total_gave" in d,
    },
    {
        "id": 3,
        "lang": "Hindi",
        "question": "इस महीने कितनी उधारी दी गई?",
        "expected_intent": "total_udhaar",
        "verify_data": lambda d: d.get("time_period") == "this_month" and "total_gave" in d,
    },
    {
        "id": 4,
        "lang": "Hindi",
        "question": "रमेश का कितना बाकी है?",
        "expected_intent": "customer_balance",
        "verify_data": lambda d: d.get("found") is True and "Ramesh" in d.get("customer_name", ""),
    },
    {
        "id": 5,
        "lang": "Hindi",
        "question": "दुकान में कौन सा सामान कम है?",
        "expected_intent": "items_running_low",
        "verify_data": lambda d: d.get("count", 0) > 0 and len(d.get("items", [])) > 0,
    },
    {
        "id": 6,
        "lang": "Hindi",
        "question": "सबसे ज़्यादा उधार वाले 5 लोग कौन हैं?",
        "expected_intent": "top_debtors",
        "verify_data": lambda d: len(d.get("debtors", [])) > 0,
    },
    {
        "id": 7,
        "lang": "Marathi",
        "question": "कोणाकडे 1000 पेक्षा जास्त उधारी बाकी आहे?",
        "expected_intent": "who_owes_more_than",
        "verify_data": lambda d: d.get("count", 0) > 0 and d.get("threshold") == 1000,
    },
    {
        "id": 8,
        "lang": "Marathi",
        "question": "या महिन्यात किती उधारी दिली?",
        "expected_intent": "total_udhaar",
        "verify_data": lambda d: d.get("time_period") == "this_month" and "total_gave" in d,
    },
    {
        "id": 9,
        "lang": "Marathi",
        "question": "सुरेशचा किती बाकी आहे?",
        "expected_intent": "customer_balance",
        "verify_data": lambda d: d.get("found") is True and "Suresh" in d.get("customer_name", ""),
    },
    {
        "id": 10,
        "lang": "Hinglish",
        "question": "Konsa stock low chal raha hai?",
        "expected_intent": "items_running_low",
        "verify_data": lambda d: d.get("count", 0) > 0,
    },
]


async def run_tests():
    print("=================================================================")
    print("   HisaabKitaab - Phase 3 Test Suite (10 Multilingual Questions) ")
    print("=================================================================\n")

    seed()
    print("\nRunning test queries...\n")

    passed = 0
    with Session(engine) as session:
        shop = get_shop(session)
        assert shop, "Shop record must exist"

        for item in QUESTIONS:
            qid = item["id"]
            lang = item["lang"]
            q = item["question"]
            exp = item["expected_intent"]

            print(f"[{qid}/10] ({lang}) '{q}'")
            res = await process_chat_query(session, shop.id, q)
            got_intent = res["intent"]
            answer = res["answer"]
            data = res["data"]

            intent_ok = got_intent == exp
            data_ok = item["verify_data"](data)
            answer_ok = len(answer.strip()) > 0

            status = "PASS" if (intent_ok and data_ok and answer_ok) else "FAIL"
            if status == "PASS":
                passed += 1

            print(f"       Intent: {got_intent} (expected: {exp}) -> {'✓' if intent_ok else '✗'}")
            print(f"       Data:   {'✓ Verified' if data_ok else '✗ Unexpected data'}")
            print(f"       Answer: \"{answer[:120]}...\"" if len(answer) > 120 else f"       Answer: \"{answer}\"")
            print(f"       Result: {status}\n")
            await asyncio.sleep(1.5)

    print("=================================================================")
    print(f"   Test Summary: {passed}/{len(QUESTIONS)} Questions Passed")
    print("=================================================================")
    return passed == len(QUESTIONS)


if __name__ == "__main__":
    success = asyncio.run(run_tests())
    exit(0 if success else 1)
