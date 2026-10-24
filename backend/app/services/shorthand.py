"""Per-shop learned shorthand (ShorthandMap): "Rmsh" -> "Ramesh bhau", "ch" -> "Cheeni".

Learned from the shopkeeper's corrections on the confirm screens, then fed back
into extraction prompts and used to resolve names in plain code.
"""

from sqlmodel import Session, select

from app.models import Customer, Product, ShorthandKind, ShorthandMap
from app.services.matching import normalize_text

MAX_PROMPT_ITEMS = 150  # keep prompts small


def learn(session: Session, shop_id: int, token: str, meaning: str, kind: ShorthandKind) -> bool:
    """Remember token -> meaning. Returns True if something new was learned (no commit)."""
    token, meaning = token.strip(), meaning.strip()
    if not token or not meaning or normalize_text(token) == normalize_text(meaning):
        return False
    key = normalize_text(token)
    for existing in session.exec(
        select(ShorthandMap).where(ShorthandMap.shop_id == shop_id, ShorthandMap.kind == kind)
    ).all():
        if normalize_text(existing.token) == key:
            if existing.meaning == meaning:
                return False
            existing.meaning = meaning  # the shopkeeper corrected it again: latest wins
            session.add(existing)
            return True
    session.add(ShorthandMap(shop_id=shop_id, token=token, meaning=meaning, kind=kind))
    return True


def lookup(session: Session, shop_id: int, kind: ShorthandKind) -> dict[str, str]:
    """{normalized token: meaning} for one kind."""
    rows = session.exec(select(ShorthandMap).where(ShorthandMap.shop_id == shop_id, ShorthandMap.kind == kind)).all()
    return {normalize_text(r.token): r.meaning for r in rows}


def rename_meaning(session: Session, shop_id: int, old: str, new: str) -> None:
    """After merging customers, point shorthand for the old name at the new one."""
    for r in session.exec(select(ShorthandMap).where(ShorthandMap.shop_id == shop_id, ShorthandMap.meaning == old)).all():
        r.meaning = new
        session.add(r)


def _shorthand_lines(session: Session, shop_id: int, kind: ShorthandKind) -> list[str]:
    rows = session.exec(
        select(ShorthandMap)
        .where(ShorthandMap.shop_id == shop_id, ShorthandMap.kind == kind)
        .order_by(ShorthandMap.created_at.desc())
        .limit(MAX_PROMPT_ITEMS)
    ).all()
    return [f'  "{r.token}" = {r.meaning}' for r in rows]


def khata_context(session: Session, shop_id: int) -> str:
    """Shop-specific hints appended to the khata extraction prompt."""
    names = session.exec(select(Customer.name).where(Customer.shop_id == shop_id).limit(MAX_PROMPT_ITEMS)).all()
    parts = []
    if names:
        parts.append("This shop's existing customers:\n" + "\n".join(f"  {n}" for n in names))
    customer_sh = _shorthand_lines(session, shop_id, ShorthandKind.customer)
    if customer_sh:
        parts.append("This shopkeeper's name shorthand (written = customer):\n" + "\n".join(customer_sh))
    item_sh = _shorthand_lines(session, shop_id, ShorthandKind.product) + _shorthand_lines(session, shop_id, ShorthandKind.other)
    if item_sh:
        parts.append("This shopkeeper's item shorthand (written = item):\n" + "\n".join(item_sh))
    return "\n\n".join(parts)


def bill_context(session: Session, shop_id: int) -> str:
    """Shop-specific hints appended to the supplier-bill prompt."""
    names = session.exec(select(Product.name).where(Product.shop_id == shop_id).limit(MAX_PROMPT_ITEMS)).all()
    parts = []
    if names:
        parts.append("This shop's existing products:\n" + "\n".join(f"  {n}" for n in names))
    item_sh = _shorthand_lines(session, shop_id, ShorthandKind.product)
    if item_sh:
        parts.append("This shop's item shorthand (written = product):\n" + "\n".join(item_sh))
    return "\n\n".join(parts)
