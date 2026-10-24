"""Fuzzy customer-name matching. Plain code, explainable scores 0.0–1.0.

Handles the ways one person shows up in a khata:
  "Ramesh" / "Ramesh bhau" / "ramesh  Bhau"  -> honorifics and spacing ignored
  "Rmsh"                                     -> consonant skeleton matches "Ramesh"
  "Pappu (dhaba)" / "Pappu"                  -> first name matches
Cross-script names ("रमेश" vs "Ramesh") are left to the model + learned shorthand.
"""

import difflib
import re

from app.services.matching import normalize_text

# Respect words written after (or before) a name; they don't identify the person
HONORIFICS = {
    "bhau", "bhai", "bhaiya", "bhaiyya", "tai", "didi", "di", "ji", "chacha", "chachi", "kaka", "kaki",
    "mama", "mami", "mausi", "seth", "sheth", "sahab", "saheb", "sir", "madam", "aunty", "uncle", "anna",
    "akka", "dada", "behen", "bai", "shri", "smt", "mr", "mrs",
    "भाऊ", "भाई", "भैया", "ताई", "दीदी", "जी", "चाचा", "काका", "काकी", "मामा", "मामी", "सेठ", "साहब", "दादा", "बाई", "श्री",
}

AUTO_MATCH = 0.8  # suggest a customer automatically at or above this score
MIN_MARGIN = 0.1  # ...and only if the runner-up is clearly behind (avoids Ramesh Patil vs Ramesh Kumar)


def name_key(name: str) -> str:
    """Normalized name without honorifics: "Ramesh  Bhau" -> "ramesh"."""
    tokens = [t for t in normalize_text(name).split() if t not in HONORIFICS]
    return " ".join(tokens) or normalize_text(name)


def skeleton(word: str) -> str:
    """Consonants only, no repeats: "ramesh" -> "rmsh", "pappu" -> "pp" -> "p"."""
    s = re.sub(r"[aeiou\s]", "", word)
    return re.sub(r"(.)\1+", r"\1", s)


def is_latin(text: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9 ]+", text))


def name_score(a: str, b: str) -> float:
    ka, kb = name_key(a), name_key(b)
    if not ka or not kb:
        return 0.0
    if ka == kb:
        return 1.0

    scores = [difflib.SequenceMatcher(None, ka, kb).ratio()]
    first_a, first_b = ka.split()[0], kb.split()[0]
    if first_a == first_b:
        scores.append(0.85)  # same first name, different extra words
    if is_latin(first_a) and is_latin(first_b):
        sa, sb = skeleton(first_a), skeleton(first_b)
        # Abbreviation like "Rmsh": written consonants equal the full name's consonants
        if len(sa) >= 3 and sa == sb:
            scores.append(0.9)
    return round(min(max(scores), 0.99), 2)


def best_match(name: str, candidates: list[str]) -> tuple[str | None, float]:
    """Best candidate if it clears AUTO_MATCH with a clear margin over the runner-up."""
    ranked = sorted(((name_score(name, c), c) for c in candidates), reverse=True)
    if not ranked or ranked[0][0] < AUTO_MATCH:
        return None, ranked[0][0] if ranked else 0.0
    if len(ranked) > 1 and ranked[0][0] - ranked[1][0] < MIN_MARGIN:
        return None, ranked[0][0]  # ambiguous: let the shopkeeper choose
    return ranked[0][1], ranked[0][0]
