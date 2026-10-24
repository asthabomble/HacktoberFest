"""Gemma sometimes returns JSON with escapes JSON doesn't allow ("ch\\+tel"). Found by the Phase 7 benchmark."""

import json

import pytest

from app.services.gemma import _extract_json

CASES = [
    (r'{"raw_text": "Rmsh ch\+tel 450"}', "Rmsh ch\\+tel 450"),  # invalid escape -> literal backslash
    (r'{"a": "dash \— here"}', "dash \\— here"),
    (r'{"a": "line\nbreak \"quote\" र path\\dir"}', 'line\nbreak "quote" र path\\dir'),  # valid escapes untouched
    (r'{"a": "already escaped \\+ plus"}', "already escaped \\+ plus"),
    ('Here you go:\n```json\n{"a": "ok"}\n```', "ok"),
    (r'{"a": "\u0938\u0941 cut \u092 short"}', "सु cut \\u092 short"),  # broken \u escape -> literal
]


@pytest.mark.parametrize("raw,expected", CASES)
def test_extract_json_repairs_escapes(raw, expected):
    assert json.loads(_extract_json(raw))["a" if '"a"' in raw else "raw_text"] == expected
